# system_routes.py — system / utility endpoints
# handles health checks, rate limit status, and the legacy Gemini endpoint
# APIs:
#   GET      /api/rate-limit — returns request count and reset time for calling IP
#   GET      /api/health     — deployment health check (used by Render, Railway etc)
#   GET|HEAD /ping           — liveness probe (HEAD = no body, just 200 status)
#   POST     /api/gemini     — legacy endpoint kept for backward compatibility

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from src.utils.helpers import check_rate_limit, get_client_ip, increment_rate
from src.vectordb.vector_store import get_cached_pipeline
from src.retrieval.retriever import retrieve
from src.prompts.prompt_templates import build_prompt
from src.llm.llm_client import call_gemini

logger = logging.getLogger(__name__)
router = APIRouter()
# read token at call time in health endpoint — not at module level


# --- GET /api/rate-limit ---
# returns current request count and reset time for the calling IP
@router.get("/api/rate-limit")
async def rate_limit_status(request: Request) -> dict:
    ip = get_client_ip(request)
    rl = check_rate_limit(ip)
    return {"success": True, **rl}


# --- GET /api/health ---
# deployment platforms (Render, Railway) call this to check if the server is alive
@router.get("/api/health")
async def health() -> dict:
    return {
        "ok": True,
        "openrouter": bool(os.getenv("OPENROUTER_API_KEY", "").strip()),
        "github": bool(os.getenv("GITHUB_TOKEN", "").strip()),
        "rag": True,
    }


# --- GET|HEAD /ping ---
# lightweight liveness probe — HEAD means no response body, just status 200
@router.api_route("/ping", methods=["GET", "HEAD"])
async def ping():
    return JSONResponse(content={"message": "pong"})


# --- POST /api/gemini ---
# legacy endpoint — kept for backward compatibility only
# prefer /api/chat or /api/chat-stream for new code
@router.post("/api/gemini")
async def gemini_legacy(payload: dict, request: Request) -> dict:
    ip = get_client_ip(request)
    rl = check_rate_limit(ip)
    if not rl["allowed"]:
        return {
            "success": False,
            "rateLimited": True,
            "error": f"Daily limit of {rl['limit']} requests reached.",
            "rateLimit": rl,
        }

    query    = payload.get("query", "") or "this repository"
    username = payload.get("username", "")
    repo     = payload.get("repo", "")
    history  = payload.get("history", [])
    repo_key = f"{username}/{repo}"

    pipeline = get_cached_pipeline(repo_key)
    if pipeline:
        # use RAG grounding if index is available
        chunks = retrieve(pipeline, query)
        prompt = build_prompt(repo_key, pipeline.tree, query, chunks, history)
    else:
        # no index — answer from general knowledge only
        prompt = f"Answer briefly about this repository query: {query}"

    try:
        text = await call_gemini(prompt)
    except (ValueError, Exception) as exc:
        return {"success": False, "error": str(exc), "rateLimited": False}

    increment_rate(ip)
    return {"success": True, "response": text, "rateLimit": check_rate_limit(ip)}
