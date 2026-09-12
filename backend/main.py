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
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.on_event("startup")
async def warmup():
    # pre-load the HuggingFace embedding model in a background thread at startup
    # without this, the first /api/ingest-rag or /api/chat call takes ~30-60s
    # to load the model — warmup makes it instant for the user
    logger.info("[Warmup] Pre-loading embedding model in background...")

    def _load():
        from src.embeddings.embedder import get_embedder
        get_embedder()  # loads all-MiniLM-L6-v2 into memory
        logger.info("[Warmup] Embedding model ready.")

    # run in thread so it doesn't block the server from accepting requests
    asyncio.get_event_loop().run_in_executor(None, _load)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
