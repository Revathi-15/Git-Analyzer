# vector_store.py — FAISS vector index and pipeline cache
# builds and manages the in-memory FAISS index for each repo
# caches RAGPipeline objects for 3 hours so re-indexing is not needed on every question

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Optional

from src.chunking.chunker import Chunk, build_chunks
from src.embeddings.embedder import embed_texts

logger = logging.getLogger(__name__)

# pipeline cache lives for 3 hours — after that, re-index on next request
_CACHE_MAX_AGE = 3 * 60 * 60

# in-memory dict: { "facebook/react": RAGPipeline }
# one pipeline per repo, shared across all user requests for that repo
_pipeline_cache: dict[str, "RAGPipeline"] = {}


# RAGPipeline — holds everything needed to answer questions about one repo
@dataclass
class RAGPipeline:
    repo_key: str                        # e.g. "torvalds/linux"
    chunks: list[Chunk] = field(default_factory=list)  # all text chunks from the repo
    index: Optional[object] = None       # FAISS index — stores chunk vectors for search
    built_at: float = field(default_factory=time.time)  # timestamp — used to check TTL
    tree: str = ""                       # plain-text file tree — added to LLM prompt
    summary: str = ""                    # repo description + star count

    def parse_content(self, raw_content: str) -> dict[str, str]:
        # raw_content comes from GitHub API in this format:
        #   ==================================================
        #   File: src/App.tsx
        #   ==================================================
        #   <code here>
        # this method splits it into { "src/App.tsx": "<code>" }

        file_sections: dict[str, str] = {}

        # regex matches the separator pattern and captures filepath + code
        pattern = re.compile(
            r"={10,}\s*\nFile:\s*(.+?)\s*\n={10,}\s*\n(.*?)(?=\n={10,}|\Z)",
            re.DOTALL,
        )
        matches = pattern.findall(raw_content)

        if matches:
            for file_path, code in matches:
                file_path = file_path.strip()
                code = code.strip()
                if code:  # skip empty files
                    file_sections[file_path] = code
        else:
            # fallback: if content doesn't match the pattern, treat it as one block
            if raw_content.strip():
                file_sections["repository_content"] = raw_content.strip()

        logger.info(f"[VectorStore] Parsed {len(file_sections)} file sections.")
        return file_sections


def build_index(pipeline: RAGPipeline, chunks: list[Chunk]) -> None:
    # step 1: get the text from every chunk
    # step 2: embed all texts into vectors using HuggingFace model
    # step 3: store vectors in FAISS for fast similarity search

    import faiss  # imported here to avoid slow startup if FAISS is not needed

    texts = [c.text for c in chunks]
    logger.info(f"[VectorStore] Embedding {len(texts)} chunks...")

    embeddings = embed_texts(texts)
    dim = embeddings.shape[1]  # 384 — matches all-MiniLM-L6-v2 output size

    # IndexFlatIP — exact inner product search
    # "exact" means it checks every vector (no approximation)
    # inner product on L2-normalised vectors == cosine similarity
    index = faiss.IndexFlatIP(dim)
    index.add(embeddings)  # load all chunk vectors into the index

    # attach chunks + index to the pipeline so retriever can use them
    pipeline.chunks = chunks
    pipeline.index = index

    logger.info(f"[VectorStore] FAISS index built. dim={dim}, vectors={index.ntotal}")


def get_cached_pipeline(repo_key: str) -> Optional[RAGPipeline]:
    # check if we already built a pipeline for this repo recently
    pipeline = _pipeline_cache.get(repo_key)
    if pipeline is None:
        return None  # never indexed

    # check if cache has expired (older than 3 hours)
    age = time.time() - pipeline.built_at
    if age > _CACHE_MAX_AGE:
        logger.info(f"[VectorStore] Cache expired for {repo_key} (age={age:.0f}s).")
        del _pipeline_cache[repo_key]
        return None  # expired — caller will re-index

    return pipeline  # cache hit — ready to use


def cache_pipeline(pipeline: RAGPipeline) -> None:
    # save pipeline to in-memory dict so next request for same repo is instant
    _pipeline_cache[pipeline.repo_key] = pipeline
    logger.info(f"[VectorStore] Cached pipeline for {pipeline.repo_key}.")
