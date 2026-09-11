# embedder.py — text embedding model
# loads HuggingFace all-MiniLM-L6-v2 locally and converts text into 384-dim vectors
# runs on CPU, no API key needed, vectors used for FAISS similarity search

from __future__ import annotations

import logging
import numpy as np

logger = logging.getLogger(__name__)

# holds the model instance — loaded once into memory, reused for every request
_embedder = None


def get_embedder():
    # lazy load — heavy model (~22MB), only load when first embedding request arrives
    global _embedder
    if _embedder is None:
        logger.info("[Embedder] Loading HuggingFace all-MiniLM-L6-v2 (first time ~30s)...")

        from sentence_transformers import SentenceTransformer

        # all-MiniLM-L6-v2 — converts text into 384-dimensional vectors
        # runs fully locally on CPU, no API key needed
        # designed for semantic similarity — similar meaning = similar vectors
        _embedder = SentenceTransformer("all-MiniLM-L6-v2")

        logger.info("[Embedder] Model loaded. Output dimensions = 384.")
    return _embedder


def embed_texts(texts: list[str]) -> np.ndarray:
    # converts a list of text strings into a 2D numpy array of float32 vectors
    # output shape: (number of texts, 384)

    embedder = get_embedder()

    vectors = embedder.encode(
        texts,
        batch_size=128,             # increased from 64 — embeds more chunks per CPU pass
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,  # L2-normalise so inner product = cosine similarity
    ).astype(np.float32)            # FAISS requires float32

    logger.info(f"[Embedder] Embedded {len(texts)} texts → shape {vectors.shape}")
    return vectors


def embed_query(query: str) -> np.ndarray:
    # wraps a single query string into embed_texts
    # returns shape (1, 384) — ready to pass into FAISS index.search()
    return embed_texts([query])
