# repo_routes.py — GitHub repository data endpoints
# handles fetching repo file tree, file contents, and raw GitIngest ingestion
# APIs:
#   POST /ingest/               — raw repo fetch via gitingest library
#   POST /api/collect-repo-data — fetch file tree + all file contents (powers FileExplorer)
#   GET  /api/file-content      — fetch a single file when user clicks it in the explorer

from __future__ import annotations

import base64
import logging
import os

import httpx
from fastapi import APIRouter, HTTPException

from src.ingestion.loader import fetch_github_content, fetch_via_github_api, _github_headers
from src.utils.helpers import IngestRequest
from src.api.pipeline import _fetch_or_cached

logger = logging.getLogger(__name__)
router = APIRouter()


# --- POST /ingest/ ---
# raw GitIngest endpoint — fetches and returns full repo content via gitingest library
@router.post("/ingest/")
async def ingest_github_link(ingest_request: IngestRequest) -> dict:
    return await fetch_github_content(
        ingest_request.github_link,
        ingest_request.max_file_size,
    )


# --- POST /api/collect-repo-data ---
# called when user navigates to /:username/:repo
# fetches file tree + all file contents — powers the left panel (FileExplorer)
@router.post("/api/collect-repo-data")
async def collect_repo_data(payload: dict) -> dict:
    username = payload.get("username", "")
    repo = payload.get("repo", "")
    if not username or not repo:
        raise HTTPException(status_code=400, detail="username and repo are required")

    try:
        data = await _fetch_or_cached(username, repo)
        return {"success": True, "data": data}
    except Exception as exc:
        logger.warning(f"[RepoRoutes] collect-repo-data failed: {exc} — returning fallback")
        # return empty fallback so the page still renders even if GitHub API is slow
        return {
            "success": True,
            "data": {
                "summary": f"Repository {username}/{repo}",
                "tree": "",
                "content": "",
                "files": [],
            },
        }


# --- GET /api/file-content ---
# called when user clicks a file in the FileExplorer
# returns raw file content — text files decoded from base64, binary files kept as base64
@router.get("/api/file-content")
async def get_file_content(username: str, repo: str, path: str) -> dict:
    headers = _github_headers()  # read token at call time

    url = f"https://api.github.com/repos/{username}/{repo}/contents/{path}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(url, headers=headers)
            if r.status_code == 404:
                raise HTTPException(status_code=404, detail="File not found")
            r.raise_for_status()
            data = r.json()

        if isinstance(data, list):
            raise HTTPException(status_code=400, detail="Path is a directory")

        ext = path.split(".")[-1].lower() if "." in path else ""
        # images and PDFs are kept as base64 — frontend renders them directly
        is_binary = ext in {"jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ico", "pdf"}
        raw = data.get("content", "")
        # GitHub returns all content as base64 — decode text files to readable UTF-8
        content = raw if is_binary else base64.b64decode(raw).decode("utf-8", errors="replace")
        return {"content": content, "isBinary": is_binary}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"[RepoRoutes] file-content error: {exc}")
        return {"content": f"# {path}\n\nCould not load file content.", "isBinary": False}
