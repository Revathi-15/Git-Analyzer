# chat_routes.py — AI chat endpoints
# handles RAG-powered question answering, both streaming and non-streaming
# APIs:
#   POST /api/chat        — full response returned at once (non-streaming)
#   POST /api/chat-stream — tokens streamed via SSE as LLM generates them (ChatGPT effect)

from __future__ import annotations

import asyncio
import logging
import time

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from src.api.pipeline import build_pipeline
from src.llm.llm_client import _sse, call_gemini, stream_llm
from src.prompts.prompt_templates import build_prompt
from src.retrieval.retriever import retrieve
from src.utils.helpers import (
    ChatRequest, check_rate_limit, get_client_ip, increment_rate,
)
from src.vectordb.vector_store import get_cached_pipeline

logger = logging.getLogger(__name__)
router = APIRouter()


# --- POST /api/chat ---
# non-streaming RAG chat — waits for full LLM response, then returns it all at once
@router.post("/api/chat")
async def chat(req: ChatRequest, request: Request) -> dict:
    ip = get_client_ip(request)
    rl = check_rate_limit(ip)

    # block if user exceeded 100 requests in the last 24 hours
    if not rl["allowed"]:
        return {
            "success": False,
            "rateLimited": True,
            "error": f"Daily limit of {rl['limit']} requests reached. Resets in {int((rl['resetAt'] - time.time()) / 3600)}h.",
            "rateLimit": rl,
        }

    repo_key = f"{req.username}/{req.repo}"

    # auto-index if not cached yet — happens transparently before answering
    pipeline = get_cached_pipeline(repo_key)
    if pipeline is None:
        logger.info(f"[ChatRoutes] No index for {repo_key} — auto-ingesting...")
        try:
            pipeline = await build_pipeline(req.username, req.repo)
        except asyncio.TimeoutError:
            # indexing timed out — fall back to answering without code context
            prompt = f"Answer this question about GitHub repo {repo_key}:\n\n{req.query}\n\nNote: Code context unavailable."
            response_text = await call_gemini(prompt)
            increment_rate(ip)
            return {
                "success": True,
                "response": response_text,
                "sources": [],
                "rag_used": False,
                "rateLimit": check_rate_limit(ip),
            }

    # step 1: embed query → FAISS search → top-k relevant chunks
    chunks = retrieve(pipeline, req.query, req.top_k)

    # step 2: build grounded prompt = repo tree + chunks + history + question
    grounded_prompt = build_prompt(repo_key, pipeline.tree, req.query, chunks, req.history)

    # step 3: send to LLM and wait for full response
    try:
        response_text = await call_gemini(grounded_prompt)
    except (ValueError, Exception) as exc:
        return {"success": False, "error": str(exc), "rateLimited": False}

    increment_rate(ip)
    # dict.fromkeys removes duplicate file paths while preserving order
    sources = list(dict.fromkeys(c.file_path for c in chunks))
    return {
        "success": True,
        "response": response_text,
        "sources": sources,   # which files were used to answer
        "rag_used": True,
        "rateLimit": check_rate_limit(ip),
    }


# --- POST /api/chat-stream ---
# streaming RAG chat using Server-Sent Events (SSE)
# sends tokens one-by-one as the LLM generates them — creates ChatGPT typing effect in UI
@router.post("/api/chat-stream")
async def chat_stream(req: ChatRequest, request: Request):
    ip = get_client_ip(request)
    rl = check_rate_limit(ip)

    async def event_stream():
        # check rate limit first — send error SSE event and stop if exceeded
        if not rl["allowed"]:
            yield _sse({
                "type": "error",
                "rateLimited": True,
                "message": f"Daily limit of {rl['limit']} requests reached. Resets in {int((rl['resetAt'] - time.time()) / 3600)}h.",
                "rateLimit": rl,
            })
            return

        repo_key = f"{req.username}/{req.repo}"

        # auto-index if not cached — sends progress event so UI shows a spinner
        pipeline = get_cached_pipeline(repo_key)
        if pipeline is None:
            yield _sse({"type": "progress", "message": "Indexing repository (first time)..."})
            try:
                pipeline = await build_pipeline(req.username, req.repo)
            except Exception as exc:
                yield _sse({"type": "error", "message": f"Failed to index repo: {exc}"})
                return

        # run FAISS search in thread pool — CPU-bound, keeps event loop free
        total_chunks = len(pipeline.chunks)
        yield _sse({"type": "progress", "message": f"Searching through {total_chunks} chunks..."})
        retrieved_chunks = await asyncio.to_thread(retrieve, pipeline, req.query, req.top_k)

        # emit one progress event per retrieved chunk so UI shows which files are being read
        for i, chunk in enumerate(retrieved_chunks, 1):
            short_path = chunk.file_path.split("/")[-1]
            yield _sse({
                "type": "progress",
                "message": f"Reading chunk {i}/{len(retrieved_chunks)} — {short_path}",
                "chunk_file": chunk.file_path,
                "chunk_index": chunk.chunk_index,
            })
            await asyncio.sleep(0.05)  # tiny pause so UI renders each step visually

        # build grounded prompt and start streaming tokens from LLM
        yield _sse({"type": "progress", "message": "Assembling context, querying AI..."})
        grounded_prompt = build_prompt(repo_key, pipeline.tree, req.query, retrieved_chunks, req.history)

        # stream_llm yields SSE strings — each one is a token, progress, or error event
        async for sse_event in stream_llm(grounded_prompt):
            yield sse_event

        # "done" event signals the frontend to stop appending tokens and show sources
        increment_rate(ip)
        sources = list(dict.fromkeys(c.file_path for c in retrieved_chunks))
        yield _sse({"type": "done", "sources": sources, "rateLimit": check_rate_limit(ip)})

    # StreamingResponse keeps HTTP connection open while event_stream() is running
    # no-cache + no-buffering ensures tokens reach browser immediately
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
