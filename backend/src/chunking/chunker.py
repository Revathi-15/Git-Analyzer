# chunker.py — code text splitter
# uses language-aware splitting for code files (Python, JS, TS, Java, Go, etc.)
# falls back to generic RecursiveCharacterTextSplitter for unknown file types (yaml, json, md)

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache

logger = logging.getLogger(__name__)

CHUNK_SIZE    = 1200  # max chars per chunk (~300 tokens) — fits well in LLM context
CHUNK_OVERLAP = 150   # overlap so concepts at chunk boundaries aren't lost


# maps file extension → LangChain Language enum
# language-aware splitters use language-specific separators (def, class, {}, etc.)
# instead of generic character boundaries — much better for code retrieval
_EXT_TO_LANG: dict[str, str] = {
    "py":    "python",
    "js":    "js",
    "jsx":   "js",
    "ts":    "ts",
    "tsx":   "ts",
    "java":  "java",
    "go":    "go",
    "cpp":   "cpp",
    "cc":    "cpp",
    "c":     "c",
    "rb":    "ruby",
    "rs":    "rust",
    "scala": "scala",
    "swift": "swift",
    "kt":    "kotlin",
    "php":   "php",
    "cs":    "csharp",
    "sol":   "sol",
    "html":  "html",
    "md":    "markdown",
}


@lru_cache(maxsize=20)
def _get_lang_splitter(lang: str):
    # cached per language — created once, reused for every file of that type
    from langchain_text_splitters import Language, RecursiveCharacterTextSplitter

    # map our string keys to LangChain Language enum values
    lang_map = {
        "python":   Language.PYTHON,
        "js":       Language.JS,
        "ts":       Language.TS,
        "java":     Language.JAVA,
        "go":       Language.GO,
        "cpp":      Language.CPP,
        "c":        Language.C,
        "ruby":     Language.RUBY,
        "rust":     Language.RUST,
        "scala":    Language.SCALA,
        "swift":    Language.SWIFT,
        "kotlin":   Language.KOTLIN,
        "php":      Language.PHP,
        "csharp":   Language.CSHARP,
        "sol":      Language.SOL,
        "html":     Language.HTML,
        "markdown": Language.MARKDOWN,
    }

    language_enum = lang_map.get(lang)
    if language_enum is None:
        return _get_generic_splitter()

    return RecursiveCharacterTextSplitter.from_language(
        language=language_enum,
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )


_generic_splitter = None

def _get_generic_splitter():
    # fallback for file types without a dedicated language splitter (yaml, json, env, sql, etc.)
    global _generic_splitter
    if _generic_splitter is None:
        from langchain_text_splitters import RecursiveCharacterTextSplitter
        _generic_splitter = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE,
            chunk_overlap=CHUNK_OVERLAP,
            separators=["\n\n", "\n", " ", ""],
        )
    return _generic_splitter


def _get_splitter_for_file(file_path: str):
    # detect language from file extension and return the right splitter
    ext = file_path.rsplit(".", 1)[-1].lower() if "." in file_path else ""
    lang = _EXT_TO_LANG.get(ext)
    if lang:
        return _get_lang_splitter(lang)
    return _get_generic_splitter()


# Chunk — one piece of a file with metadata about where it came from
@dataclass
class Chunk:
    text: str         # actual code text (prefixed with file path)
    file_path: str    # e.g. "src/App.tsx" — used for source citations in AI answers
    chunk_index: int  # position of this chunk within its file (0, 1, 2 ...)


def build_chunks(file_sections: dict[str, str]) -> list[Chunk]:
    # file_sections = { "src/App.tsx": "<full file code>", ... }
    # each file gets split with its own language-aware splitter
    # returns a flat list of Chunk objects across all files

    all_chunks: list[Chunk] = []

    for file_path, code in file_sections.items():
        # pick the right splitter for this file's language
        splitter = _get_splitter_for_file(file_path)
        texts = splitter.split_text(code)

        for i, text in enumerate(texts):
            all_chunks.append(
                Chunk(
                    # prefix with file path so LLM knows which file this came from
                    text=f"[File: {file_path}]\n{text}",
                    file_path=file_path,
                    chunk_index=i,
                )
            )

    logger.info(f"[Chunker] Built {len(all_chunks)} chunks from {len(file_sections)} files.")
    return all_chunks
