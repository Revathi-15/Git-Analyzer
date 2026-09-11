# helpers.py — shared utilities
# IP normalisation, in-memory rate limiter (100 req/24hr per IP), Pydantic request models

from __future__ import annotations

import time
from pydantic import BaseModel, field_validator

# max requests allowed per IP in one window
RATE_LIMIT  = 100
RATE_WINDOW = 24 * 60 * 60  # 24 hours in seconds

# in-memory store: { "192.168.1.1": { "count": 5, "reset_at": 1700000000 } }
# resets automatically when the window expires — no Redis needed
_rate_store: dict[str, dict] = {}


def normalize_ip(ip: str) -> str:
    # IPv6 loopback (::1) and IPv4-mapped (::ffff:127.0.0.1) both mean localhost
    # normalise all of them to "127.0.0.1" so they share one rate-limit bucket
    if ip in ("::1", "::ffff:127.0.0.1", "0:0:0:0:0:0:0:1"):
        return "127.0.0.1"
    if ip.startswith("::ffff:"):
        return ip[7:]  # strip IPv6 prefix to get plain IPv4
    return ip


def _get_rate_entry(ip: str) -> dict:
    # get or create the rate limit entry for this IP
    # if the window has expired, reset count to 0 and set a new reset time
    ip = normalize_ip(ip)
    now = time.time()
    entry = _rate_store.get(ip)
    if not entry or now > entry["reset_at"]:
        _rate_store[ip] = {"count": 0, "reset_at": now + RATE_WINDOW}
    return _rate_store[ip]


def check_rate_limit(ip: str) -> dict:
    # returns the current rate limit status for an IP
    # "allowed": True means the request should proceed
    ip = normalize_ip(ip)
    entry = _get_rate_entry(ip)
    remaining = max(0, RATE_LIMIT - entry["count"])
    return {
        "allowed": entry["count"] < RATE_LIMIT,
        "remaining": remaining,
        "limit": RATE_LIMIT,
        "resetAt": int(entry["reset_at"]),  # unix timestamp — frontend shows countdown
    }


def increment_rate(ip: str) -> None:
    # call this after a successful request — increments the counter for this IP
    ip = normalize_ip(ip)
    entry = _get_rate_entry(ip)
    entry["count"] += 1


def get_client_ip(request) -> str:
    # x-forwarded-for header is set by proxies/load balancers with the real client IP
    # fall back to direct connection IP if header is missing
    raw = (
        request.headers.get("x-forwarded-for", "")
        or (request.client.host if request.client else "unknown")
    )
    # x-forwarded-for can be a comma-separated list — first IP is the original client
    return normalize_ip(raw.split(",")[0].strip())


# --- Pydantic request models ---
# FastAPI automatically validates incoming JSON against these models
# if the request body doesn't match, FastAPI returns a 422 error before the handler runs


class IngestRequest(BaseModel):
    # used by POST /ingest/ — raw GitIngest endpoint
    github_link: str
    max_file_size: int = 50 * 1024 * 1024  # default 50MB max per file

    @field_validator("github_link")
    @classmethod
    def validate_github_link(cls, v: str) -> str:
        # reject non-GitHub URLs early to avoid pointless API calls
        if not v.startswith("https://github.com/"):
            raise ValueError("URL must start with https://github.com/")
        return v


class IngestRAGRequest(BaseModel):
    # used by POST /api/ingest-rag — triggers chunking + embedding + FAISS build
    username: str
    repo: str
    force: bool = False  # if True, re-index even if already cached


class ChatRequest(BaseModel):
    # used by POST /api/chat and POST /api/chat-stream
    username: str
    repo: str
    query: str             # the user's question
    history: list[dict] = []  # previous messages for follow-up context
    top_k: int = 5         # how many chunks to retrieve from FAISS
