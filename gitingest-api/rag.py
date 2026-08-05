"""
rag.py — RAG Pipeline for Git Analyzer
=======================================
Flow:
  1. Receive raw repository content (from GitIngest)
  2. Parse into individual file sections
  3. Chunk each file with overlap (LangChain RecursiveCharacterTextSplitter)
  4. Embed each chunk using HuggingFace sentence-transformers (local, no API key)
  5. Store vectors in FAISS index (in-memory, per repo)
  6. On query: embed query → similarity search → retrieve top-k chunks
  7. Build a grounded prompt → send to Gemini → return answer

One RAGPipeline instance is created per repo and cached in memory.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ── Lazy imports (heavy libs loaded once on first use) ────────────────────────
_embedder = None
_splitter = None


def _get_embedder():
    """Load the HuggingFace embedding model once and reuse."""
    global _embedder
    if _embedder is None:
        logger.info("[RAG] Loading HuggingFace embedding model (first time ~30s)...")
        from sentence_transformers import SentenceTransformer
        # all-MiniLM-L6-v2: fast, 384-dim, great for code/text similarity
        _embedder = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("[RAG] Embedding model loaded.")
    return _embedder


def _get_splitter():
    """Create a LangChain text splitter tuned for source code."""
    global _splitter
    if _splitter is None:
        from langchain_text_splitters import RecursiveCharacterTextSplitter
        _splitter = RecursiveCharacterTextSplitter(
            chunk_size=800,        # ~800 chars per chunk
            chunk_overlap=120,     # 120-char overlap keeps context across boundaries
            separators=[
                "\n\ndef ",        # Python/JS function boundaries
                "\n\nclass ",      # Class boundaries
                "\n\n",            # Paragraph/block boundaries
                "\n",              # Line boundaries
                " ",               # Word boundaries
                "",                # Character fallback
            ],
        )
        logger.info("[RAG] Text splitter ready.")
    return _splitter


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class Chunk:
    """A single chunk of text with its source file metadata."""
    text: str
    file_path: str
    chunk_index: int


@dataclass
class RAGPipeline:
    """
    One instance per repository.
    Holds the FAISS index + all chunks for that repo.
    """
    repo_key: str                          # e.g. "facebook/react"
    chunks: list[Chunk] = field(default_factory=list)
    index: Optional[object] = None         # faiss.IndexFlatIP
    built_at: float = field(default_factory=time.time)
    tree: str = ""
    summary: str = ""

    # ── Step 1: Parse raw GitIngest content into file sections ────────────────
    def parse_content(self, raw_content: str) -> dict[str, str]:
        """
        GitIngest returns content like:
            ================================================
            File: src/App.tsx
            ================================================
            <code here>

        This method splits that into { "src/App.tsx": "<code>" }
        """
        file_sections: dict[str, str] = {}

        # Match the separator pattern GitIngest uses
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
            # Fallback: treat entire content as one block
            if raw_content.strip():
                file_sections["repository_content"] = raw_content.strip()

        logger.info(f"[RAG] Parsed {len(file_sections)} file sections.")
        return file_sections

    # ── Step 2: Chunk all file sections ──────────────────────────────────────
    def build_chunks(self, file_sections: dict[str, str]) -> list[Chunk]:
        """Split each file into overlapping chunks."""
        splitter = _get_splitter()
        all_chunks: list[Chunk] = []

        for file_path, code in file_sections.items():
            # Prepend file path to each chunk so AI knows where it came from
            texts = splitter.split_text(code)
            for i, text in enumerate(texts):
                all_chunks.append(Chunk(
                    text=f"[File: {file_path}]\n{text}",
                    file_path=file_path,
                    chunk_index=i,
                ))

        logger.info(f"[RAG] Built {len(all_chunks)} chunks from {len(file_sections)} files.")
        return all_chunks

    # ── Step 3: Embed chunks + build FAISS index ──────────────────────────────
    def build_index(self, chunks: list[Chunk]) -> None:
        """
        Embed every chunk with HuggingFace and store in FAISS IndexFlatIP.
        IndexFlatIP = Inner Product (cosine similarity when vectors are normalised).
        """
        import faiss

        embedder = _get_embedder()

        texts = [c.text for c in chunks]
        logger.info(f"[RAG] Embedding {len(texts)} chunks...")

        # Batch embed — sentence-transformers handles batching internally
        embeddings = embedder.encode(
            texts,
            batch_size=64,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True,   # normalise for cosine similarity
        ).astype(np.float32)

        dim = embeddings.shape[1]  # 384 for all-MiniLM-L6-v2
        index = faiss.IndexFlatIP(dim)
        index.add(embeddings)

        self.chunks = chunks
        self.index = index
        logger.info(f"[RAG] FAISS index built. Dimensions={dim}, Vectors={index.ntotal}.")

    # ── Step 4: Query — embed → search → return top-k chunks ─────────────────
    def retrieve(self, query: str, top_k: int = 5) -> list[Chunk]:
        """
        Embed the user query, run FAISS similarity search,
        return the top_k most relevant chunks.
        """
        if self.index is None or not self.chunks:
            logger.warning("[RAG] Index not built yet.")
            return []

        import faiss  # noqa: F401

        embedder = _get_embedder()

        query_vec = embedder.encode(
            [query],
            convert_to_numpy=True,
            normalize_embeddings=True,
        ).astype(np.float32)

        # D = distances (inner products), I = indices
        distances, indices = self.index.search(query_vec, top_k)

        results: list[Chunk] = []
        for idx in indices[0]:
            if idx != -1 and idx < len(self.chunks):
                results.append(self.chunks[idx])

        logger.info(f"[RAG] Retrieved {len(results)} chunks for query: '{query[:60]}...'")
        return results

    # ── Step 5: Build grounded Gemini prompt ──────────────────────────────────
    def build_prompt(
        self,
        query: str,
        retrieved_chunks: list[Chunk],
        history: list[dict],
    ) -> str:
        """
        Assemble the final prompt:
        - System instruction
        - Repository context (retrieved chunks only — not full codebase)
        - Conversation history
        - User question
        """
        context_text = "\n\n---\n\n".join(c.text for c in retrieved_chunks)

        history_text = ""
        if history:
            history_text = "\n\nCONVERSATION HISTORY:\n" + "\n".join(
                f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
                for m in history[-6:]  # last 6 messages to stay within token limits
            )

        return f"""You are an expert code assistant for the GitHub repository: {self.repo_key}

REPOSITORY STRUCTURE:
{self.tree[:2000]}

RELEVANT CODE CONTEXT (retrieved via semantic search):
{context_text}
{history_text}

QUESTION: {query}

Instructions:
- Answer based ONLY on the code context provided above
- Reference specific file paths when relevant (e.g. "In src/App.tsx...")
- Use markdown with fenced code blocks (with language tags) when showing code
- If the answer is not in the provided context, say so honestly
- Be concise but complete"""


# ── In-memory pipeline cache (repo_key → RAGPipeline) ────────────────────────
# Avoids re-embedding the same repo on every question
_pipeline_cache: dict[str, RAGPipeline] = {}
_CACHE_MAX_AGE = 3 * 60 * 60  # 3 hours


def get_cached_pipeline(repo_key: str) -> Optional[RAGPipeline]:
    pipeline = _pipeline_cache.get(repo_key)
    if pipeline is None:
        return None
    age = time.time() - pipeline.built_at
    if age > _CACHE_MAX_AGE:
        logger.info(f"[RAG] Cache expired for {repo_key} (age={age:.0f}s).")
        del _pipeline_cache[repo_key]
        return None
    return pipeline


def cache_pipeline(pipeline: RAGPipeline) -> None:
    _pipeline_cache[pipeline.repo_key] = pipeline
    logger.info(f"[RAG] Cached pipeline for {pipeline.repo_key}.")


# ── Top-level helper called from main.py ─────────────────────────────────────

async def build_rag_pipeline(
    repo_key: str,
    raw_content: str,
    tree: str,
    summary: str,
) -> RAGPipeline:
    """
    Full ingestion pipeline (runs in a thread pool via asyncio.to_thread
    because embedding is CPU-bound).
    """
    import asyncio

    def _build():
        pipeline = RAGPipeline(repo_key=repo_key, tree=tree, summary=summary)
        file_sections = pipeline.parse_content(raw_content)
        chunks = pipeline.build_chunks(file_sections)
        pipeline.build_index(chunks)
        return pipeline

    pipeline = await asyncio.to_thread(_build)
    cache_pipeline(pipeline)
    return pipeline


async def rag_query(
    pipeline: RAGPipeline,
    query: str,
    history: list[dict],
    top_k: int = 5,
) -> str:
    """
    Retrieve relevant chunks and build the grounded prompt.
    Returns the prompt string — caller sends it to Gemini.
    """
    import asyncio

    def _retrieve():
        return pipeline.retrieve(query, top_k=top_k)

    chunks = await asyncio.to_thread(_retrieve)
    return pipeline.build_prompt(query, chunks, history)
