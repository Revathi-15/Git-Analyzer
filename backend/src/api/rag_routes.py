# rag_routes.py — RAG indexing endpoints
# handles building the FAISS vector index for a repo and checking its status
# APIs:
#   POST /api/ingest-rag  — fetch repo → chunk → embed → build FAISS index → cache
#   GET  /api/rag-status  — check if a repo is already indexed (shows Ready/Index button in UI)

from __future__ import annotations

import logging
import time

from fastapi import APIRouter

from src.api.pipeline import build_pipeline
from src.utils.helpers import IngestRAGRequest
from src.vectordb.vector_store import get_cached_pipeline

logger = logging.getLogger(__name__)
router = APIRouter()


# --- POST /api/ingest-rag ---
# step 1 of RAG flow — called when user clicks "Index Repo"
# fetches repo → chunks → embeds → builds FAISS index → caches for 3 hours
@router.post("/api/ingest-rag")
async def ingest_rag(req: IngestRAGRequest) -> dict:
    repo_key = f"{req.username}/{req.repo}"

    # skip re-indexing if already cached and force=False (default)
    if not req.force:
        cached = get_cached_pipeline(repo_key)
        if cached:
            logger.info(f"[RAGRoutes] Cache hit for {repo_key}")
            return {
                "success": True,
                "repo_key": repo_key,
                "chunks_count": len(cached.chunks),
                "files_count": len({c.file_path for c in cached.chunks}),
                "cached": True,
                "message": f"Already indexed ({len(cached.chunks)} chunks). Ready for chat.",
            }

    try:
        pipeline = await build_pipeline(req.username, req.repo)
    except Exception as exc:
        logger.warning(f"[RAGRoutes] ingest-rag failed for {repo_key}: {exc}")
        return {"success": False, "error": str(exc), "repo_key": repo_key}

    # set() deduplicates — counts unique source files, not total chunks
    unique_files = len({c.file_path for c in pipeline.chunks})
    return {
        "success": True,
        "repo_key": repo_key,
        "chunks_count": len(pipeline.chunks),
        "files_count": unique_files,
        "cached": False,
        "message": f"Indexed {len(pipeline.chunks)} chunks from {unique_files} files. Ready for RAG-powered chat.",
    }


# --- GET /api/rag-status ---
# frontend calls this on load to check if "Index Repo" button should show "Ready" or not
@router.get("/api/rag-status")
async def rag_status(username: str, repo: str) -> dict:
    repo_key = f"{username}/{repo}"
    pipeline = get_cached_pipeline(repo_key)
    if pipeline:
        return {
            "indexed": True,
            "repo_key": repo_key,
            "chunks_count": len(pipeline.chunks),
            "files_count": len({c.file_path for c in pipeline.chunks}),
            "age_seconds": int(time.time() - pipeline.built_at),  # how long ago it was indexed
        }
    return {"indexed": False, "repo_key": repo_key}
