# llm_client.py — OpenRouter LLM communication
# handles all calls to OpenRouter API with automatic fallback across 4 free models
# supports both full response (call_llm) and token streaming (stream_llm) via SSE

from __future__ import annotations

import json
import logging
import os

import httpx

logger = logging.getLogger(__name__)

# loaded from .env — one key for all models via OpenRouter
# NOTE: read inside functions (not at module level) so load_dotenv() in main.py runs first
# reading os.getenv at import time gives empty string because .env hasn't loaded yet

# free models tried in this order — updated August 2026
# source: openrouter.ai/models — these are confirmed available on the free tier
LLM_MODELS = [
    "openrouter/free",                            # OpenRouter auto-router — picks best available free model
    "nvidia/nemotron-3-ultra-550b-a55b:free",    # largest free model — 550B, 1M context
    "openai/gpt-oss-20b:free",                   # OpenAI open-weight, 131K context
    "google/gemma-4-31b-it:free",                # Google Gemma 4, vision capable
    "nvidia/nemotron-nano-9b-v2:free",           # lightweight fallback, always available
    "poolside/laguna-m.1:free",                  # strong coding model, high token volume
]

# base headers sent with every OpenRouter request
_HEADERS = {
    "Content-Type": "application/json",
    "HTTP-Referer": "https://github.com/git-analyzer",
    "X-Title": "Git Analyzer",
}


def _auth_headers() -> dict:
    # read key at call time — ensures .env is already loaded by the time this runs
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    return {**_HEADERS, "Authorization": f"Bearer {api_key}"}


async def call_llm(prompt: str) -> str:
    # sends prompt to OpenRouter and returns the full response as a string
    # tries each model in LLM_MODELS — moves to next if 404 (not found) or 429 (rate limited)

    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY is not set. Add it to the .env file.")

    last_error = ""
    async with httpx.AsyncClient(timeout=60.0) as client:
        for model in LLM_MODELS:
            response = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=_auth_headers(),
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 1024,   # cap response length
                    "temperature": 0.3,   # low = more factual, high = more creative
                },
            )

            if response.status_code == 200:
                data = response.json()
                try:
                    # OpenAI-compatible response format — answer is here
                    return data["choices"][0]["message"]["content"]
                except (KeyError, IndexError):
                    continue  # malformed response — try next model

            elif response.status_code in (404, 429, 402, 503):
                # 404 = model not on free tier, 429 = rate limited,
                # 402 = negative balance, 503 = model temporarily down
                last_error = f"{model}: HTTP {response.status_code}"
                logger.warning(f"[LLM] {model} unavailable ({response.status_code}), trying next...")
                continue

            else:
                # unexpected error — don't retry
                raise ValueError(f"OpenRouter error {response.status_code}: {response.text[:300]}")

    raise ValueError(f"All free models unavailable. Last error: {last_error}")


# call_gemini kept as alias so existing call sites don't need to change
call_gemini = call_llm


async def stream_llm(prompt: str):
    # async generator — yields SSE-formatted strings one by one as tokens arrive
    # used by /api/chat-stream to create the ChatGPT-style typing effect in the UI

    if not os.getenv("OPENROUTER_API_KEY", "").strip():
        yield _sse({"type": "error", "message": "OPENROUTER_API_KEY is not set."})
        return

    # short connect timeout — if model doesn't respond quickly, skip to next
    # long read timeout — give model enough time to finish generating
    timeout = httpx.Timeout(connect=8.0, read=60.0, write=10.0, pool=5.0)

    for model in LLM_MODELS:
        model_short = model.split("/")[1].split(":")[0]  # e.g. "gpt-oss-20b"
        yield _sse({"type": "progress", "message": f"Connecting to {model_short}..."})

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                # stream=True keeps the connection open and yields tokens as they arrive
                async with client.stream(
                    "POST",
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers=_auth_headers(),
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 1024,
                        "temperature": 0.3,
                        "stream": True,  # tells OpenRouter to stream tokens
                    },
                ) as resp:
                    if resp.status_code in (404, 429, 402, 503):
                        logger.warning(f"[LLM] {model} unavailable ({resp.status_code}), trying next...")
                        continue

                    if resp.status_code != 200:
                        logger.warning(f"[LLM] {model} error {resp.status_code}, trying next...")
                        continue

                    # read the SSE stream line by line
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue  # skip blank lines and headers

                        payload_str = line[5:].strip()  # strip "data: " prefix

                        if payload_str == "[DONE]":
                            return  # OpenRouter signals end of stream

                        try:
                            chunk_data = json.loads(payload_str)
                            # extract the actual text token from the delta
                            token = chunk_data["choices"][0]["delta"].get("content", "")
                            if token:
                                yield _sse({"type": "token", "text": token})
                        except Exception:
                            continue  # skip malformed chunks

                    return  # stream finished successfully — don't try next model

        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout):
            logger.warning(f"[LLM] {model} timed out, trying next...")
            continue

        except Exception as exc:
            logger.exception(f"[LLM] Unexpected error with {model}")
            yield _sse({"type": "error", "message": str(exc)})
            return

    # all 4 models failed
    yield _sse({"type": "error", "message": "All free models are currently unavailable. Try again in a moment."})


def _sse(data: dict) -> str:
    # format a dict as a Server-Sent Event string
    # SSE format: "data: <json>\n\n"  — browser reads this via EventSource / fetch stream
    return f"data: {json.dumps(data)}\n\n"
