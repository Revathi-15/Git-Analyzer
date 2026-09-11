# loader.py — GitHub repository fetcher
# handles all GitHub API communication to get repo file tree and file contents
# no git clone needed — uses GitHub REST API directly (faster, works on Windows)

from __future__ import annotations

import asyncio
import base64
import logging
import os

import httpx
from fastapi import HTTPException
from gitingest import ingest_async

logger = logging.getLogger(__name__)

# read from .env — if set, GitHub allows 5000 req/hr instead of 60 unauthenticated
# NOTE: read inside functions, not at module level — same reason as llm_client.py
# module-level os.getenv runs before load_dotenv() in main.py, always returns empty string

def _github_headers() -> dict:
    # build GitHub API headers — read token at call time so .env is already loaded
    token = os.getenv("GITHUB_TOKEN", "").strip()
    h = {"Accept": "application/vnd.github+json"}
    if token:
        h["Authorization"] = f"token {token}"
    return h
TEXT_EXTS = {
    "py", "js", "jsx", "ts", "tsx", "css", "html", "json", "md", "txt",
    "yaml", "yml", "toml", "ini", "cfg", "sh", "env", "gitignore",
    "dockerfile", "java", "go", "rs", "cpp", "c", "h", "php", "rb",
    "swift", "kt", "scala", "vue", "svelte", "sql",
}

# skip these folders entirely — they contain generated/vendor code, not source
SKIP_DIRS = {
    "node_modules", "dist", "build", ".git", "__pycache__",
    ".cache", "coverage", "vendor",
}


async def fetch_via_github_api(username: str, repo: str) -> dict:
    # fetches the full repo without cloning — uses GitHub REST API directly
    # much faster than git clone, works on Windows without git installed
    # returns: { summary, tree (text), content (all file code), files (nested tree) }

    headers = _github_headers()  # read token at call time, not import time

    async with httpx.AsyncClient(timeout=30.0) as client:

        # get repo metadata — we need the default branch name and description
        r = await client.get(
            f"https://api.github.com/repos/{username}/{repo}", headers=headers
        )
        r.raise_for_status()
        repo_info = r.json()
        branch = repo_info.get("default_branch", "main")
        description = repo_info.get("description") or repo
        stars = repo_info.get("stargazers_count", 0)

        # get the full file tree in one API call (recursive=1 flattens all subfolders)
        r = await client.get(
            f"https://api.github.com/repos/{username}/{repo}/git/trees/{branch}",
            params={"recursive": "1"},
            headers=headers,
        )
        r.raise_for_status()
        tree_data = r.json()

    # tree_data["tree"] is a flat list of all files and folders in the repo
    items = tree_data.get("tree", [])

    # build a plain-text list of all paths — used in the LLM prompt so it knows the structure
    tree_text = "\n".join(
        item["path"] for item in items if item.get("type") in ("blob", "tree")
    )

    # filter down to only text files we care about
    # blob = file, tree = folder — we only want files (blobs)
    blob_paths = [
        item["path"]
        for item in items
        if item.get("type") == "blob"
        and not any(part in SKIP_DIRS for part in item["path"].split("/"))  # skip noisy dirs
        and item["path"].split(".")[-1].lower() in TEXT_EXTS                # only text files
        and item.get("size", 0) < 200_000                                   # skip large/minified files
    ]  # no cap — index the whole repo

    # fetch file contents — 25 files at a time in parallel for speed
    content_parts: list[str] = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        for i in range(0, len(blob_paths), 25):
            batch = blob_paths[i : i + 25]

            # fire all 10 requests at the same time
            tasks = [
                client.get(
                    f"https://api.github.com/repos/{username}/{repo}/contents/{path}",
                    headers=headers,
                )
                for path in batch
            ]
            # return_exceptions=True means one failure doesn't cancel the whole batch
            responses = await asyncio.gather(*tasks, return_exceptions=True)

            for path, resp in zip(batch, responses):
                if isinstance(resp, Exception):
                    continue  # skip files that failed to fetch
                try:
                    data = resp.json()
                    if "content" not in data:
                        continue
                    # GitHub returns file content as base64 — decode it to plain text
                    text = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
                    # format each file with a clear separator so parse_content() can split them
                    content_parts.append(f"{'=' * 50}\nFile: {path}\n{'=' * 50}\n{text}")
                except Exception:
                    continue

    full_content = "\n\n".join(content_parts)
    summary = f"{description} — {stars} stars | {len(blob_paths)} files indexed"

    # build nested file tree for the left panel (FileExplorer component in React)
    nested_files = _build_file_tree(items)

    logger.info(f"[Loader] Fetched {len(blob_paths)} files, {len(full_content)} chars for {username}/{repo}")
    return {
        "summary": summary,
        "tree": tree_text,       # plain text — goes into LLM prompt
        "content": full_content, # all file code — goes into RAG chunker
        "files": nested_files,   # nested JSON — rendered by React FileExplorer
    }


def _build_file_tree(items: list) -> list:
    # GitHub gives a flat list: [{ path: "src/components/App.tsx", type: "blob" }, ...]
    # React's FileExplorer needs a nested tree: src → components → App.tsx
    # this function converts flat → nested

    root: list = []
    dir_map: dict = {}  # { "src/components": node_dict } — lookup to find parent nodes

    # sort alphabetically so parent folders always appear before their children
    for item in sorted(items, key=lambda x: x.get("path", "")):
        path = item.get("path", "")
        if not path:
            continue

        parts = path.split("/")
        name = parts[-1]  # last part is the file/folder name
        is_dir = item.get("type") == "tree"

        node: dict = {
            "name": name,
            "path": path,
            "type": "directory" if is_dir else "file",
        }
        if is_dir:
            node["children"] = []  # folders have children, files don't

        if len(parts) == 1:
            # top-level item — goes directly into root
            root.append(node)
        else:
            # find the parent folder node and add this as a child
            parent = dir_map.get("/".join(parts[:-1]))
            if parent is not None:
                parent["children"].append(node)

        if is_dir:
            dir_map[path] = node  # register so its children can find it later

    return root


async def fetch_github_content(github_link: str, max_file_size: int) -> dict:
    # uses gitingest library to clone + extract repo content
    # used by the raw /ingest/ endpoint (not the main RAG flow)
    try:
        summary, tree, content = await ingest_async(
            source=github_link,
            max_file_size=max_file_size,
        )
        logger.info(f"[Loader] GitIngest done for {github_link} — {len(content)} chars")
        return {"summary": summary, "tree": tree, "content": content}
    except Exception as exc:
        logger.error(f"[Loader] GitIngest failed for {github_link}: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to ingest repository: {exc}") from exc
