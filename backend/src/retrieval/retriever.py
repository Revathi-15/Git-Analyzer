# retriever.py — FAISS similarity search
# embeds the user query and searches the FAISS index for the top-k most relevant chunks

from __future__ import annotations

import logging

from src.chunking.chunker import Chunk
from src.embeddings.embedder import embed_query
from src.vectordb.vector_store import RAGPipeline

logger = logging.getLogger(__name__)


def retrieve(pipeline: RAGPipeline, query: str, top_k: int = 5) -> list[Chunk]:
    # takes the user's question and finds the most relevant code chunks
    # using FAISS vector similarity search

    # safety check — index must be built before we can search
    if pipeline.index is None or not pipeline.chunks:
        logger.warning("[Retriever] Index not built — returning empty results.")
        return []

    # step 1: convert the user's question into the same 384-dim vector space
    # as the stored chunks — this is how we compare meaning, not keywords
    query_vec = embed_query(query)  # shape: (1, 384)

    # step 2: FAISS searches all stored chunk vectors for the closest matches
    # distances = similarity scores (higher = more similar)
    # indices   = positions in pipeline.chunks list
    distances, indices = pipeline.index.search(query_vec, top_k)

    # step 3: collect the actual Chunk objects using the returned indices
    results: list[Chunk] = []
    for idx in indices[0]:
        # FAISS returns -1 for empty slots when fewer results than top_k exist
        if idx != -1 and idx < len(pipeline.chunks):
            results.append(pipeline.chunks[idx])

    logger.info(f"[Retriever] Retrieved {len(results)} chunks for: '{query[:60]}...'")
    return results
