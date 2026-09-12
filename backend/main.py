import asyncio
import logging
import logging.handlers
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import router

# load API keys from .env — must happen before any module reads os.getenv()
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

# create logs/ folder if it doesn't exist yet
os.makedirs(os.path.join(os.path.dirname(__file__), "logs"), exist_ok=True)

# logging — writes to terminal + rotating file (5MB, keeps last 3)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.handlers.RotatingFileHandler(
            os.path.join(os.path.dirname(__file__), "logs", "app.log"),
            maxBytes=5 * 1024 * 1024,
            backupCount=3,
        ),
    ],
)

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Git Analyzer API",
    version="2.0.0",
    description="RAG-powered GitHub repository analysis API",
)

# CORS — allows React frontend (port 5173) to call this API (port 8001)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://*.vercel.app",
        "https://git-analyzer-azure.vercel.app",
        "https://git-analyzer-revathi-15s-projects.vercel.app",
        "https://git-analyzer-et07.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.on_event("startup")
async def warmup():
    # Skip pre-loading on free tier to avoid OOM crash
    # Model loads lazily on first request instead
    logger.info("[Warmup] Skipping model pre-load (free tier RAM limit).")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
