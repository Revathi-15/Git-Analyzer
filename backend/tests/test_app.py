"""
tests/test_app.py
==================
Basic smoke tests for the Git Analyzer FastAPI app.
Run with:  python -m pytest tests/ -v
"""

import pytest
from fastapi.testclient import TestClient

# ── Import app ────────────────────────────────────────────────────────────────
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from main import app

client = TestClient(app)


# ── Health / liveness ─────────────────────────────────────────────────────────

def test_ping():
    response = client.get("/ping")
    assert response.status_code == 200
    assert response.json() == {"message": "pong"}


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert "ok" in data
    assert data["ok"] is True


def test_rate_limit_endpoint():
    response = client.get("/api/rate-limit")
    assert response.status_code == 200
    data = response.json()
    assert "allowed" in data
    assert "remaining" in data
    assert "limit" in data


# ── collect-repo-data ─────────────────────────────────────────────────────────

def test_collect_repo_data_missing_fields():
    """Should return 400 if username or repo is missing."""
    response = client.post("/api/collect-repo-data", json={})
    assert response.status_code == 400


def test_collect_repo_data_valid(monkeypatch):
    """Should return success with mocked GitHub API response."""
    from src.ingestion import loader

    async def mock_fetch(username, repo):
        return {
            "summary": "test repo",
            "tree": "src/\n  App.tsx",
            "content": "==================================================\nFile: src/App.tsx\n==================================================\nconst App = () => <div>Hello</div>;",
            "files": [{"name": "src", "path": "src", "type": "directory", "children": []}],
        }

    monkeypatch.setattr(loader, "fetch_via_github_api", mock_fetch)

    response = client.post(
        "/api/collect-repo-data",
        json={"username": "test", "repo": "repo"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "files" in data["data"]


# ── rag-status ────────────────────────────────────────────────────────────────

def test_rag_status_not_indexed():
    response = client.get("/api/rag-status?username=nobody&repo=nothing")
    assert response.status_code == 200
    data = response.json()
    assert data["indexed"] is False


# ── Helpers unit tests ────────────────────────────────────────────────────────

def test_normalize_ip():
    from src.utils.helpers import normalize_ip
    assert normalize_ip("::1") == "127.0.0.1"
    assert normalize_ip("::ffff:127.0.0.1") == "127.0.0.1"
    assert normalize_ip("192.168.1.1") == "192.168.1.1"


def test_rate_limit_increments():
    from src.utils.helpers import check_rate_limit, increment_rate
    ip = "10.0.0.99"
    before = check_rate_limit(ip)["remaining"]
    increment_rate(ip)
    after = check_rate_limit(ip)["remaining"]
    assert after == before - 1


# ── Chunker unit test ─────────────────────────────────────────────────────────

def test_build_chunks():
    from src.chunking.chunker import build_chunks
    sections = {"src/App.tsx": "const App = () => <div>Hello World</div>;\nexport default App;"}
    chunks = build_chunks(sections)
    assert len(chunks) >= 1
    assert chunks[0].file_path == "src/App.tsx"
    assert "[File: src/App.tsx]" in chunks[0].text


# ── Prompt builder unit test ──────────────────────────────────────────────────

def test_build_prompt():
    from src.chunking.chunker import Chunk
    from src.prompts.prompt_templates import build_prompt

    chunks = [Chunk(text="[File: src/App.tsx]\nconst App = () => {};", file_path="src/App.tsx", chunk_index=0)]
    prompt = build_prompt("user/repo", "src/\n  App.tsx", "What does App do?", chunks, [])

    assert "user/repo" in prompt
    assert "What does App do?" in prompt
    assert "src/App.tsx" in prompt
