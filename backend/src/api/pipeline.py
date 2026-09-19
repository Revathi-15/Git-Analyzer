# pipeline.py — shared RAG pipeline builder
# used by both rag_routes (ingest-rag) and chat_routes (auto-ingest on chat)
# handles: GitHub API fetch → parse → chunk → embed → build FAISS index → cache

from __future__ import annotations

import asyncio
import logging
import time

from src.chunking.chunker import build_chunks
from src.ingestion.loader import fetch_via_github_api
from src.vectordb.vector_store import (
    RAGPipeline, build_index, cache_pipeline, get_cached_pipeline,
)

logger = logging.getLogger(__name__)

# tracks in-progress builds: { "user/repo": asyncio.Future }
_in_progress: dict[str, asyncio.Future] = {}

# short-lived ingest data cache: { "user/repo": (timestamp, data) }
# collect-repo-data and ingest-rag often fire at the same time (parallel from frontend)
# whichever arrives first fetches from GitHub; the second reuses the cached result
# TTL is 60s — just long enough to cover a parallel frontend fetch
_ingest_cache: dict[str, tuple[float, dict]] = {}
_INGEST_TTL = 60.0


async def _fetch_or_cached(username: str, repo: str) -> dict:
    """Return ingest data from short-lived cache, or fetch fresh from GitHub."""
    repo_key = f"{username}/{repo}"
    entry = _ingest_cache.get(repo_key)
    if entry and (time.time() - entry[0]) < _INGEST_TTL:
        logger.info(f"[Pipeline] Reusing cached ingest data for {repo_key}")
        return entry[1]
    data = await fetch_via_github_api(username, repo)
    _ingest_cache[repo_key] = (time.time(), data)
    return data


def _build_pipeline_sync(username: str, repo: str, ingest_data: dict) -> RAGPipeline:
    # runs in a thread pool — embedding is CPU-bound and blocks the async event loop
    repo_key = f"{username}/{repo}"

    pipeline = RAGPipeline(
        repo_key=repo_key,
        tree=ingest_data["tree"],
        summary=ingest_data["summary"],
    )
    # step 1: parse raw content into { filepath: code } dict
    file_sections = pipeline.parse_content(ingest_data["content"])

    # step 2: split each file into overlapping 800-char chunks
    chunks = build_chunks(file_sections)

    # step 3: embed all chunks + store in FAISS index
    build_index(pipeline, chunks)

    return pipeline


async def build_pipeline(username: str, repo: str) -> RAGPipeline:
    # full ingest flow: GitHub API fetch → parse → chunk → embed → FAISS → cache
    # if a build is already in progress for this repo, wait for it instead of starting a new one
    # this prevents the race condition where user sends a message while auto-index is still running

    repo_key = f"{username}/{repo}"

    # return from cache immediately if already built
    cached = get_cached_pipeline(repo_key)
    if cached:
        return cached

    # if another coroutine is already building this pipeline, wait for it
    if repo_key in _in_progress:
        logger.info(f"[Pipeline] Build already in progress for {repo_key} — waiting...")
        return await _in_progress[repo_key]

    # start a new build and register the future so others can wait for it
    loop = asyncio.get_event_loop()
    future: asyncio.Future = loop.create_future()
    _in_progress[repo_key] = future

    try:
        ingest_data = await _fetch_or_cached(username, repo)
        pipeline = await asyncio.to_thread(_build_pipeline_sync, username, repo, ingest_data)
        cache_pipeline(pipeline)
        future.set_result(pipeline)
        return pipeline
    except Exception as exc:
        future.set_exception(exc)
        raise
    finally:
        # always remove from in-progress when done (success or failure)
        _in_progress.pop(repo_key, None)
