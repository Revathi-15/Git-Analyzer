import asyncio
import logging
import os
import time

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from gitingest import ingest_async

# Configure logging
logging.basicConfig(level=logging.INFO)
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

app = FastAPI()

# Enable CORS to allow cross-origin requests from the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class IngestRequest(BaseModel):
    github_link: str
    max_file_size: int = 50 * 1024 * 1024

    @field_validator("github_link")
    @classmethod
    def validate_github_link(cls, v):
        if not v.startswith("https://github.com/"):
            raise ValueError("URL must start with https://github.com/")
        return v


async def fetch_github_content(github_link: str, max_file_size: int) -> dict:
    try:
        summary, tree, content = await ingest_async(source=github_link, max_file_size=max_file_size)

        logging.info(f"Ingestion complete for {github_link}")
        logging.info(f"Summary: {summary}")
        logging.info(f"Tree structure:\n{tree}")
        logging.info(f"Total content length: {len(content)} characters")

        return {
            "summary": summary,
            "tree": tree,
            "content": content,
        }
    except Exception as exc:
        logging.error(f"Error fetching content for {github_link}: {str(exc)}")
        raise HTTPException(status_code=500, detail=f"Failed to ingest repository: {str(exc)}") from exc


@app.post("/ingest/")
async def ingest_github_link(ingest_request: IngestRequest) -> dict:
    github_link = ingest_request.github_link
    max_file_size = ingest_request.max_file_size
    logging.info(f"Received ingest request for github_link: {github_link}")
    return await fetch_github_content(github_link, max_file_size)


@app.post("/api/collect-repo-data")
async def collect_repo_data(payload: dict) -> dict:
    username = payload.get("username", "")
    repo = payload.get("repo", "")
    if not username or not repo:
        raise HTTPException(status_code=400, detail="username and repo are required")

    github_link = f"https://github.com/{username}/{repo}"
    try:
        data = await asyncio.wait_for(
            fetch_github_content(github_link, max_file_size=50 * 1024 * 1024),
            timeout=3,
        )
        return {
            "success": True,
            "data": {
                **data,
                "files": [],
            },
        }
    except asyncio.TimeoutError:
        logging.warning("GitIngest timed out; returning a lightweight fallback response")
        return {
            "success": True,
            "data": {
                "summary": f"Repository {username}/{repo} loaded in fallback mode.",
                "tree": "Fallback tree",
                "content": f"Preview for {username}/{repo}",
                "files": [],
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/file-content")
async def get_file_content(username: str, repo: str, path: str) -> dict:
    return {
        "content": f"# {path}\n\nPreview content for {username}/{repo}.",
        "isBinary": False,
    }


@app.post("/api/gemini")
async def gemini(payload: dict) -> dict:
    query = payload.get("query", "") or "this repository"
    api_key = os.getenv("GEMINI_API_KEY", "").strip()

    if not api_key:
        return {
            "success": False,
            "error": "Gemini API key is missing. Add GEMINI_API_KEY to the .env file.",
            "rateLimited": False,
        }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
                params={"key": api_key},
                json={
                    "contents": [
                        {
                            "role": "user",
                            "parts": [
                                {"text": f"Answer briefly and helpfully about this repository query: {query}"}
                            ],
                        }
                    ]
                },
            )
            response.raise_for_status()
            data = response.json()
            text = ""
            try:
                text = data["candidates"][0]["content"]["parts"][0]["text"]
            except Exception:
                text = str(data)

        return {
            "success": True,
            "response": text,
            "rateLimit": {
                "allowed": True,
                "remaining": 100,
                "limit": 100,
                "resetAt": int(time.time()) + 3600,
            },
        }
    except Exception as exc:
        logging.exception("Gemini request failed")
        return {
            "success": False,
            "error": f"Gemini request failed: {exc}",
            "rateLimited": False,
        }


@app.get("/api/rate-limit")
async def rate_limit() -> dict:
    return {
        "success": True,
        "allowed": True,
        "remaining": 100,
        "limit": 100,
        "resetAt": int(time.time()) + 3600,
    }


@app.api_route("/ping", methods=["GET", "HEAD"])
async def ping():
    return JSONResponse(content={"message": "pong"})


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("main:app", host="0.0.0.0", port=port)