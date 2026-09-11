# routes.py — API router aggregator
# collects all sub-routers and mounts them into one router
# this single router is imported by main.py → app.include_router(router)
#
# repo_routes    → POST /ingest/, POST /api/collect-repo-data, GET /api/file-content
# rag_routes     → POST /api/ingest-rag, GET /api/rag-status
# chat_routes    → POST /api/chat, POST /api/chat-stream
# system_routes  → GET /api/rate-limit, GET /api/health, GET /ping, POST /api/gemini

from fastapi import APIRouter

from src.api.repo_routes   import router as repo_router
from src.api.rag_routes    import router as rag_router
from src.api.chat_routes   import router as chat_router
from src.api.system_routes import router as system_router

router = APIRouter()
router.include_router(repo_router)
router.include_router(rag_router)
router.include_router(chat_router)
router.include_router(system_router)
