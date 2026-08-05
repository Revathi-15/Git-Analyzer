"""
main.py — Git Analyzer FastAPI Backend
=======================================
Endpoints:
  Existing (unchanged):
    POST /ingest/               — raw GitIngest call
    POST /api/collect-repo-data — fetch repo tree + content (with fallback)
    GET  /api/file-content      — single file preview
    GET  /api/rate-limit        — rate limit status
    GET|HEAD /ping              — health check

  New RAG endpoints:
    POST /api/ingest-rag  — ingest repo → chunk → embed → FAISS index
    POST /api/chat        — query → retrieve chunks → Gemini grounded answer
    GET  /api/rag-status  — check if a repo is already indexed
"""

import asyncio
import json
import logging
import os
import time

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, field_validator

from gitingest import ingest_async
from rag import RAGPipeline, build_rag_pipeline, get_cached_pipeline, rag_query

# ── Setup ─────────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

app = FastAPI(title="Git Analyzer API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
GITHUB_TOKEN       = os.getenv("GITHUB_TOKEN", "").strip()

# OpenRouter free models — picked for speed + reliability
LLM_MODEL = "openai/gpt-oss-20b:free"

# ── In-memory rate limiter (per IP, 100 requests / 24 hours) ─────────────────
RATE_LIMIT   = 100
RATE_WINDOW  = 24 * 60 * 60  # 24 hours in seconds

_rate_store: dict[str, dict] = {}  # { ip: { count, reset_at } }

def _normalize_ip(ip: str) -> str:
    """Normalise IPv6 loopback (::1) and IPv4-mapped (::ffff:127.0.0.1) to '127.0.0.1'
    so that all local requests share the same rate-limit bucket."""
    if ip in ("::1", "::ffff:127.0.0.1", "0:0:0:0:0:0:0:1"):
        return "127.0.0.1"
    if ip.startswith("::ffff:"):
        return ip[7:]
    return ip

def _get_rate_data(ip: str) -> dict:
    ip = _normalize_ip(ip)
    now = time.time()
    entry = _rate_store.get(ip)
    if not entry or now > entry["reset_at"]:
        _rate_store[ip] = {"count": 0, "reset_at": now + RATE_WINDOW}
    return _rate_store[ip]

def check_rate_limit(ip: str) -> dict:
    ip = _normalize_ip(ip)
    entry = _get_rate_data(ip)
    remaining = max(0, RATE_LIMIT - entry["count"])
    return {
        "allowed": entry["count"] < RATE_LIMIT,
        "remaining": remaining,
        "limit": RATE_LIMIT,
        "resetAt": int(entry["reset_at"]),
    }

def increment_rate(ip: str) -> None:
    ip = _normalize_ip(ip)
    entry = _get_rate_data(ip)
    entry["count"] += 1


# ── Pydantic models ───────────────────────────────────────────────────────────

class IngestRequest(BaseModel):
    github_link: str
    max_file_size: int = 50 * 1024 * 1024

    @field_validator("github_link")
    @classmethod
    def validate_github_link(cls, v):
        if not v.startswith("https://github.com/"):
            raise ValueError("URL must start with https://github.com/")
        return v


class IngestRAGRequest(BaseModel):
    """Request body for POST /api/ingest-rag"""
    username: str
    repo: str
    force: bool = False  # force re-ingestion even if already cached


class ChatRequest(BaseModel):
    """Request body for POST /api/chat"""
    username: str
    repo: str
    query: str
    history: list[dict] = []   # [{ "role": "user"|"assistant", "content": "..." }]
    top_k: int = 5             # number of chunks to retrieve


# ── Shared helper: call LLM via OpenRouter ───────────────────────────────────

async def call_llm(prompt: str) -> str:
    """Send a prompt to OpenRouter with automatic model fallback."""
    if not OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY is not set. Add it to the .env file.")

    # Try models in order — first available free model wins
    models_to_try = [
        "openai/gpt-oss-20b:free",
        "deepseek/deepseek-r1-0528:free",
        "google/gemma-3-27b-it:free",
        "mistralai/mistral-7b-instruct:free",
    ]

    last_error = ""
    async with httpx.AsyncClient(timeout=60.0) as client:
        for model in models_to_try:
            response = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://github.com/git-analyzer",
                    "X-Title": "Git Analyzer",
                },
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 1024,
                    "temperature": 0.3,
                },
            )
            if response.status_code == 200:
                data = response.json()
                try:
                    return data["choices"][0]["message"]["content"]
                except (KeyError, IndexError):
                    continue
            elif response.status_code in (404, 429):
                # Model unavailable or rate limited — try next
                last_error = f"{model}: {response.text[:100]}"
                logging.warning(f"[LLM] {model} failed ({response.status_code}), trying next...")
                continue
            else:
                raise ValueError(f"OpenRouter error {response.status_code}: {response.text[:300]}")

    raise ValueError(f"All free models unavailable. Last error: {last_error}")

# Keep old name as alias so all existing call sites work
call_gemini = call_llm


# ── Shared helper: GitIngest fetch ────────────────────────────────────────────

async def fetch_github_content(github_link: str, max_file_size: int) -> dict:
    try:
        summary, tree, content = await ingest_async(
            source=github_link,
            max_file_size=max_file_size,
        )
        logging.info(f"[Ingest] Done for {github_link} — {len(content)} chars")
        return {"summary": summary, "tree": tree, "content": content}
    except Exception as exc:
        logging.error(f"[Ingest] Failed for {github_link}: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to ingest repository: {exc}") from exc


async def fetch_via_github_api(username: str, repo: str) -> dict:
    """
    Fetch repository content via GitHub REST API — no git clone needed.
    Much faster than GitIngest on Windows. Fetches file tree + text file contents.
    """
    headers = {"Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Get repo info + default branch
        r = await client.get(f"https://api.github.com/repos/{username}/{repo}", headers=headers)
        r.raise_for_status()
        repo_info = r.json()
        branch = repo_info.get("default_branch", "main")
        description = repo_info.get("description") or repo
        stars = repo_info.get("stargazers_count", 0)

        # Get full recursive file tree
        r = await client.get(
            f"https://api.github.com/repos/{username}/{repo}/git/trees/{branch}",
            params={"recursive": "1"},
            headers=headers,
        )
        r.raise_for_status()
        tree_data = r.json()

    items = tree_data.get("tree", [])

    # Build text tree
    tree_text = "\n".join(
        item["path"] for item in items if item.get("type") in ("blob", "tree")
    )

    # Text file extensions we want to fetch
    TEXT_EXTS = {
        "py","js","jsx","ts","tsx","css","html","json","md","txt","yaml","yml",
        "toml","ini","cfg","sh","env","gitignore","dockerfile","java","go","rs",
        "cpp","c","h","php","rb","swift","kt","scala","vue","svelte","sql",
    }

    # Collect blob paths for text files — skip node_modules, dist, build folders
    SKIP_DIRS = {"node_modules", "dist", "build", ".git", "__pycache__", ".cache", "coverage", "vendor"}

    blob_paths = [
        item["path"] for item in items
        if item.get("type") == "blob"
        and not any(part in SKIP_DIRS for part in item["path"].split("/"))
        and item["path"].split(".")[-1].lower() in TEXT_EXTS
        and item.get("size", 0) < 200_000
    ][:80]

    # Fetch file contents concurrently (batches of 10)
    import base64
    content_parts = []

    async with httpx.AsyncClient(timeout=20.0) as client:
        for i in range(0, len(blob_paths), 10):
            batch = blob_paths[i:i+10]
            tasks = [
                client.get(
                    f"https://api.github.com/repos/{username}/{repo}/contents/{path}",
                    headers=headers,
                )
                for path in batch
            ]
            responses = await asyncio.gather(*tasks, return_exceptions=True)
            for path, resp in zip(batch, responses):
                if isinstance(resp, Exception):
                    continue
                try:
                    data = resp.json()
                    if "content" not in data:
                        continue
                    text = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
                    content_parts.append(
                        f"{'='*50}\nFile: {path}\n{'='*50}\n{text}"
                    )
                except Exception:
                    continue

    full_content = "\n\n".join(content_parts)
    summary = f"{description} — {stars} stars | {len(blob_paths)} files fetched"

    logging.info(f"[GitHub API] Fetched {len(blob_paths)} files, {len(full_content)} chars for {username}/{repo}")
    return {"summary": summary, "tree": tree_text, "content": full_content}


# ════════════════════════════════════════════════════════════════════════════
# ── NEW RAG ENDPOINTS ────────────────────────────────────────────────────────
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/ingest-rag")
async def ingest_rag(req: IngestRAGRequest) -> dict:
    """
    Step 1 of RAG flow:
      1. Fetch full repo content via GitIngest
      2. Parse into file sections
      3. Chunk with RecursiveCharacterTextSplitter
      4. Embed with HuggingFace all-MiniLM-L6-v2
      5. Build FAISS index
      6. Cache pipeline in memory (3 hours)

    Returns: { success, repo_key, chunks_count, files_count, cached }
    """
    repo_key = f"{req.username}/{req.repo}"

    # Return cached pipeline if available and not forced
    if not req.force:
        cached = get_cached_pipeline(repo_key)
        if cached:
            logging.info(f"[RAG] Cache hit for {repo_key}")
            return {
                "success": True,
                "repo_key": repo_key,
                "chunks_count": len(cached.chunks),
                "files_count": len({c.file_path for c in cached.chunks}),
                "cached": True,
                "message": f"Repository already indexed ({len(cached.chunks)} chunks). Ready for chat.",
            }

    github_link = f"https://github.com/{repo_key}"

    logging.info(f"[RAG] Starting ingestion for {repo_key}...")

    try:
        # Use GitHub API directly — much faster than git clone on Windows
        ingest_data = await fetch_via_github_api(req.username, req.repo)
    except Exception as exc:
        logging.warning(f"[RAG] GitHub API fetch failed for {repo_key}: {exc}")
        return {
            "success": False,
            "error": f"Failed to fetch repository: {exc}",
            "repo_key": repo_key,
        }

    # Build pipeline (CPU-bound — runs in thread pool via asyncio.to_thread)
    pipeline = await build_rag_pipeline(
        repo_key=repo_key,
        raw_content=ingest_data["content"],
        tree=ingest_data["tree"],
        summary=ingest_data["summary"],
    )

    unique_files = len({c.file_path for c in pipeline.chunks})

    logging.info(
        f"[RAG] Pipeline ready for {repo_key}: "
        f"{len(pipeline.chunks)} chunks from {unique_files} files."
    )

    return {
        "success": True,
        "repo_key": repo_key,
        "chunks_count": len(pipeline.chunks),
        "files_count": unique_files,
        "cached": False,
        "message": (
            f"Repository indexed successfully. "
            f"{len(pipeline.chunks)} chunks from {unique_files} files. "
            f"Ready for RAG-powered chat."
        ),
    }


@app.post("/api/chat")
async def chat(req: ChatRequest, request: Request) -> dict:
    ip = _normalize_ip(request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown").split(",")[0].strip())
    rl = check_rate_limit(ip)
    if not rl["allowed"]:
        return {
            "success": False,
            "rateLimited": True,
            "error": f"Daily limit of {RATE_LIMIT} requests reached. Resets in {int((rl['resetAt'] - time.time()) / 3600)}h.",
            "rateLimit": rl,
        }
    """
    Step 2 of RAG flow:
      1. Check pipeline cache for this repo
      2. Embed user query with same HuggingFace model
      3. FAISS similarity search → top-k relevant chunks
      4. Build grounded prompt (context + history + question)
      5. Send to Gemini → return answer

    Returns: { success, response, sources, rateLimit }
    """
    repo_key = f"{req.username}/{req.repo}"

    # Get cached pipeline — must have called /api/ingest-rag first
    pipeline = get_cached_pipeline(repo_key)

    if pipeline is None:
        # Auto-trigger ingestion if not yet indexed
        logging.info(f"[RAG] No index for {repo_key} — triggering auto-ingest...")
        try:
            ingest_data = await fetch_via_github_api(req.username, req.repo)
            pipeline = await build_rag_pipeline(
                repo_key=repo_key,
                raw_content=ingest_data["content"],
                tree=ingest_data["tree"],
                summary=ingest_data["summary"],
            )
        except asyncio.TimeoutError:
            # Graceful fallback: answer without RAG context
            logging.warning(f"[RAG] Auto-ingest timed out for {repo_key}. Falling back.")
            prompt = (
                f"You are a code assistant. Answer this question about the GitHub repo "
                f"{repo_key}:\n\n{req.query}\n\n"
                f"Note: Code context is not available — answer from general knowledge."
            )
            response_text = await call_gemini(prompt)
            # Count this fallback request too
            increment_rate(ip)
            rl = check_rate_limit(ip)
            return {
                "success": True,
                "response": response_text,
                "sources": [],
                "rag_used": False,
                "rateLimit": rl,
            }

    # Build RAG prompt: retrieve top-k chunks + assemble context
    grounded_prompt = await rag_query(
        pipeline=pipeline,
        query=req.query,
        history=req.history,
        top_k=req.top_k,
    )

    try:
        response_text = await call_gemini(grounded_prompt)
    except ValueError as e:
        return {"success": False, "error": str(e), "rateLimited": False}
    except Exception as e:
        logging.exception("[chat] Gemini call failed")
        return {"success": False, "error": f"AI request failed: {e}", "rateLimited": False}

    # Count this request
    increment_rate(ip)
    rl = check_rate_limit(ip)

    # Collect source file paths for transparency
    retrieved_chunks = pipeline.retrieve(req.query, top_k=req.top_k)
    sources = list(dict.fromkeys(c.file_path for c in retrieved_chunks))

    return {
        "success": True,
        "response": response_text,
        "sources": sources,
        "rag_used": True,
        "rateLimit": rl,
    }




# ── Streaming chat endpoint ──────────────────────────────────────────────────

def _sse(data: dict) -> str:
    """Format a dict as a Server-Sent Event line."""
    return f"data: {json.dumps(data)}\n\n"


@app.post("/api/chat-stream")
async def chat_stream(req: ChatRequest, request: Request):
    """
    Streaming version of /api/chat using Server-Sent Events (SSE).
    Emits:
      {"type":"progress","message":"...","chunk_file":"..."}  — search progress
      {"type":"token","text":"..."}                            — LLM token
      {"type":"done","sources":[...],"rateLimit":{...}}        — finished
      {"type":"error","message":"..."}                         — error
    """
    raw_ip = request.headers.get(
        "x-forwarded-for", request.client.host if request.client else "unknown"
    ).split(",")[0].strip()
    ip = _normalize_ip(raw_ip)
    rl = check_rate_limit(ip)

    async def event_stream():
        # 1. Rate limit check
        if not rl["allowed"]:
            yield _sse({"type": "error", "rateLimited": True,
                        "message": f"Daily limit of {RATE_LIMIT} requests reached. "
                                   f"Resets in {int((rl['resetAt'] - time.time()) / 3600)}h.",
                        "rateLimit": rl})
            return

        repo_key = f"{req.username}/{req.repo}"

        # 2. Get or build pipeline
        pipeline = get_cached_pipeline(repo_key)
        if pipeline is None:
            yield _sse({"type": "progress", "message": "Indexing repository (first time)..."})
            try:
                ingest_data = await fetch_via_github_api(req.username, req.repo)
                pipeline = await build_rag_pipeline(
                    repo_key=repo_key,
                    raw_content=ingest_data["content"],
                    tree=ingest_data["tree"],
                    summary=ingest_data["summary"],
                )
            except Exception as exc:
                yield _sse({"type": "error", "message": f"Failed to index repo: {exc}"})
                return

        # 3. Retrieve chunks with per-chunk progress events
        total_chunks = len(pipeline.chunks)
        top_k = req.top_k
        yield _sse({"type": "progress", "message": f"Searching through {total_chunks} chunks..."})

        def _retrieve():
            return pipeline.retrieve(req.query, top_k=top_k)

        retrieved_chunks = await asyncio.to_thread(_retrieve)
        total_retrieved = len(retrieved_chunks)

        for i, chunk in enumerate(retrieved_chunks, 1):
            short_path = chunk.file_path.split("/")[-1] if "/" in chunk.file_path else chunk.file_path
            yield _sse({
                "type": "progress",
                "message": f"Reading chunk {i}/{total_retrieved} — {short_path}",
                "chunk_file": chunk.file_path,
                "chunk_index": chunk.chunk_index,
            })
            await asyncio.sleep(0.05)  # small delay so UI can render each step

        # 4. Build grounded prompt
        yield _sse({"type": "progress", "message": "Assembling context, querying AI..."})
        grounded_prompt = pipeline.build_prompt(req.query, retrieved_chunks, req.history)

        # 5. Stream LLM tokens from OpenRouter
        if not OPENROUTER_API_KEY:
            yield _sse({"type": "error", "message": "OPENROUTER_API_KEY is not set."})
            return

        # Models ordered by speed. connect_timeout is short so a dead model is
        # skipped fast; read_timeout is generous for the actual token stream.
        models_to_try = [
            "openai/gpt-oss-20b:free",
            "deepseek/deepseek-r1-0528:free",
            "google/gemma-3-27b-it:free",
            "mistralai/mistral-7b-instruct:free",
        ]

        streamed_ok = False
        for model in models_to_try:
            yield _sse({"type": "progress", "message": f"Connecting to {model.split('/')[1].split(':')[0]}..."})
            try:
                timeout = httpx.Timeout(connect=8.0, read=60.0, write=10.0, pool=5.0)
                async with httpx.AsyncClient(timeout=timeout) as client:
                    async with client.stream(
                        "POST",
                        "https://openrouter.ai/api/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                            "Content-Type": "application/json",
                            "HTTP-Referer": "https://github.com/git-analyzer",
                            "X-Title": "Git Analyzer",
                        },
                        json={
                            "model": model,
                            "messages": [{"role": "user", "content": grounded_prompt}],
                            "max_tokens": 1024,
                            "temperature": 0.3,
                            "stream": True,
                        },
                    ) as resp:
                        if resp.status_code in (404, 429):
                            logging.warning(f"[Stream] {model} unavailable ({resp.status_code}), trying next...")
                            continue
                        if resp.status_code != 200:
                            body = await resp.aread()
                            logging.warning(f"[Stream] {model} error {resp.status_code}, trying next...")
                            continue  # try next model instead of hard-failing

                        async for line in resp.aiter_lines():
                            if not line.startswith("data:"):
                                continue
                            payload_str = line[5:].strip()
                            if payload_str == "[DONE]":
                                break
                            try:
                                chunk_data = json.loads(payload_str)
                                delta = chunk_data["choices"][0]["delta"]
                                token = delta.get("content", "")
                                if token:
                                    yield _sse({"type": "token", "text": token})
                            except Exception:
                                continue

                        streamed_ok = True
                        break
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout):
                logging.warning(f"[Stream] {model} timed out, trying next...")
                continue
            except Exception as exc:
                logging.exception(f"[Stream] Unexpected error with {model}")
                yield _sse({"type": "error", "message": str(exc)})
                return

        if not streamed_ok:
            yield _sse({"type": "error",
                        "message": "All free models are currently unavailable. Try again in a moment."})
            return

        # 6. Count request and emit done
        increment_rate(ip)
        rl_final = check_rate_limit(ip)
        sources = list(dict.fromkeys(c.file_path for c in retrieved_chunks))
        yield _sse({"type": "done", "sources": sources, "rateLimit": rl_final})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/rag-status")
async def rag_status(username: str, repo: str) -> dict:
    """Check whether a repo has already been indexed."""
    repo_key = f"{username}/{repo}"
    pipeline = get_cached_pipeline(repo_key)
    if pipeline:
        return {
            "indexed": True,
            "repo_key": repo_key,
            "chunks_count": len(pipeline.chunks),
            "files_count": len({c.file_path for c in pipeline.chunks}),
            "age_seconds": int(time.time() - pipeline.built_at),
        }
    return {"indexed": False, "repo_key": repo_key}


# ════════════════════════════════════════════════════════════════════════════
# ── EXISTING ENDPOINTS (unchanged) ──────────────────────────────────────────
# ════════════════════════════════════════════════════════════════════════════

@app.post("/ingest/")
async def ingest_github_link(ingest_request: IngestRequest) -> dict:
    return await fetch_github_content(
        ingest_request.github_link,
        ingest_request.max_file_size,
    )


@app.post("/api/collect-repo-data")
async def collect_repo_data(payload: dict) -> dict:
    username = payload.get("username", "")
    repo     = payload.get("repo", "")
    if not username or not repo:
        raise HTTPException(status_code=400, detail="username and repo are required")

    try:
        # Use fast GitHub API — returns file tree in ~2s
        data = await fetch_via_github_api(username, repo)
        return {"success": True, "data": {**data, "files": []}}
    except Exception as exc:
        logging.warning(f"collect-repo-data failed: {exc} — returning fallback")
        return {
            "success": True,
            "data": {
                "summary": f"Repository {username}/{repo}",
                "tree": "",
                "content": "",
                "files": [],
            },
        }


@app.get("/api/file-content")
async def get_file_content(username: str, repo: str, path: str) -> dict:
    """
    Fetch a single file from GitHub using the raw content API.
    Falls back to a placeholder if the token is not set.
    """
    headers = {}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"

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

        import base64
        ext = path.split(".")[-1].lower() if "." in path else ""
        binary_exts = {"jpg","jpeg","png","gif","svg","webp","bmp","ico","pdf"}
        is_binary = ext in binary_exts

        raw = data.get("content", "")
        if is_binary:
            content = raw  # keep base64
        else:
            content = base64.b64decode(raw).decode("utf-8", errors="replace")

        return {"content": content, "isBinary": is_binary}

    except HTTPException:
        raise
    except Exception as exc:
        logging.error(f"[file-content] {exc}")
        # Graceful fallback
        return {
            "content": f"# {path}\n\nCould not load file content.",
            "isBinary": False,
        }


@app.post("/api/gemini")
async def gemini_legacy(payload: dict, request: Request) -> dict:
    """
    Legacy endpoint — kept for backwards compatibility with the Express proxy.
    For new code, use POST /api/chat instead (RAG-powered).
    """
    ip = _normalize_ip(request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown").split(",")[0].strip())
    rl = check_rate_limit(ip)
    if not rl["allowed"]:
        return {
            "success": False,
            "rateLimited": True,
            "error": f"Daily limit of {RATE_LIMIT} requests reached.",
            "rateLimit": rl,
        }

    query = payload.get("query", "") or "this repository"
    username = payload.get("username", "")
    repo = payload.get("repo", "")
    history = payload.get("history", [])

    repo_key = f"{username}/{repo}"
    pipeline = get_cached_pipeline(repo_key)

    if pipeline:
        grounded_prompt = await rag_query(pipeline, query, history)
        try:
            text = await call_gemini(grounded_prompt)
        except (ValueError, Exception) as e:
            return {"success": False, "error": str(e), "rateLimited": False}
    else:
        prompt = f"Answer briefly and helpfully about this repository query: {query}"
        try:
            text = await call_gemini(prompt)
        except (ValueError, Exception) as e:
            return {"success": False, "error": str(e), "rateLimited": False}

    increment_rate(ip)
    rl = check_rate_limit(ip)

    return {
        "success": True,
        "response": text,
        "rateLimit": rl,
    }


@app.get("/api/rate-limit")
async def rate_limit(request: Request) -> dict:
    ip = _normalize_ip(request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown").split(",")[0].strip())
    rl = check_rate_limit(ip)
    return {"success": True, **rl}


@app.api_route("/ping", methods=["GET", "HEAD"])
async def ping():
    return JSONResponse(content={"message": "pong"})


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "openrouter": bool(OPENROUTER_API_KEY),
        "github": bool(GITHUB_TOKEN),
        "rag": True,
        "model": LLM_MODEL,
    }


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
