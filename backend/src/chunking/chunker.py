# chunker.py — code text splitter
# splits raw file content into overlapping chunks ready for embedding
# uses LangChain RecursiveCharacterTextSplitter with code-aware separators

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# holds the splitter instance — created once, reused for every repo
_splitter = None


def get_splitter():
    # lazy init — we don't want to import LangChain at startup, only when first needed
    global _splitter
    if _splitter is None:

        # RecursiveCharacterTextSplitter — splits code into smaller pieces
        # tries separators in order: function → class → paragraph → line → word → char
        # this ensures splits happen at natural code boundaries, not mid-statement
        from langchain_text_splitters import RecursiveCharacterTextSplitter

        _splitter = RecursiveCharacterTextSplitter(
            chunk_size=1200,    # increased from 800 — larger chunks = fewer total chunks = faster embedding
            chunk_overlap=150,  # slightly more overlap to preserve boundary context
            separators=[
                "\n\ndef ",     # split at Python/JS function definitions first
                "\n\nclass ",   # then at class definitions
                "\n\n",         # then at blank lines (paragraph breaks)
                "\n",           # then at single line breaks
                " ",            # then at word boundaries
                "",             # last resort — split anywhere
            ],
        )
        logger.info("[Chunker] Text splitter ready.")
    return _splitter


# Chunk — one piece of a file with metadata about where it came from
@dataclass
class Chunk:
    text: str         # actual code text (prefixed with file path)
    file_path: str    # e.g. "src/App.tsx" — used for source citations in AI answers
    chunk_index: int  # position of this chunk within its file (0, 1, 2 ...)


def build_chunks(file_sections: dict[str, str]) -> list[Chunk]:
    # file_sections = { "src/App.tsx": "<full file code>", ... }
    # returns a flat list of Chunk objects across all files

    splitter = get_splitter()
    all_chunks: list[Chunk] = []

    for file_path, code in file_sections.items():

        # split the file's code into overlapping text pieces
        texts = splitter.split_text(code)

        for i, text in enumerate(texts):
            all_chunks.append(
                Chunk(
                    # prefix each chunk with its file path
                    # so the LLM knows which file this code came from when answering
                    text=f"[File: {file_path}]\n{text}",
                    file_path=file_path,
                    chunk_index=i,
                )
            )

    logger.info(f"[Chunker] Built {len(all_chunks)} chunks from {len(file_sections)} files.")
    return all_chunks
