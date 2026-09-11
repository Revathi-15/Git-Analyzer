# Git Analyzer

An AI-powered GitHub repository explorer. Paste any public GitHub URL, browse the codebase in a VS Code-style 3-panel layout, and chat with an AI that answers questions grounded in the actual source code using RAG (Retrieval-Augmented Generation).

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router v6 |
| Backend | Python, FastAPI, Uvicorn |
| AI / RAG | sentence-transformers (all-MiniLM-L6-v2), FAISS, LangChain, OpenRouter |
| GitHub Data | GitHub REST API (via httpx) |

## Setup

### Prerequisites
- Node.js 18+, Python 3.11+, npm, pip

### 1. Clone & install

```bash
git clone https://github.com/Revathi-15/Git-Analyzer
cd "Git Analyzer"

# Node dependencies (frontend only)
npm install

# Python dependencies
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Mac/Linux
pip install -r backend/requirements.txt
```

### 2. Configure environment variables

Create a `.env` file in the root:

```env
OPENROUTER_API_KEY=sk-or-v1-...   # required — get free at openrouter.ai
GITHUB_TOKEN=ghp_...              # recommended — github.com/settings/tokens
```

### 3. Run

```bash
npm start
```

Opens both servers: **Vite :5173** (frontend) · **FastAPI :8001** (backend)
Visit → `http://localhost:5173`

## Project Structure

```
├── src/                        # React frontend
│   ├── pages/                  # Home, RepoPage, UserProfile
│   ├── components/             # AiChat, FileExplorer, FileViewer, CodeBlock, Loading
│   └── lib/                    # api.ts, utils.ts
├── backend/                    # Python FastAPI backend
│   ├── src/
│   │   ├── ingestion/          # GitHub API fetch, file tree builder
│   │   ├── chunking/           # LangChain text splitter
│   │   ├── embeddings/         # HuggingFace all-MiniLM-L6-v2
│   │   ├── vectordb/           # FAISS index, pipeline cache
│   │   ├── retrieval/          # Top-k similarity search
│   │   ├── prompts/            # Grounded prompt builder
│   │   ├── llm/                # OpenRouter LLM calls (stream + non-stream)
│   │   ├── api/                # All FastAPI route handlers
│   │   └── utils/              # Rate limiter, IP utils, Pydantic models
│   ├── tests/                  # Pytest test suite
│   ├── logs/                   # Rotating log files
│   ├── config.yaml             # Non-secret configuration
│   ├── main.py                 # App entry point
│   └── requirements.txt        # Python dependencies
└── .env                        # API keys (never commit)
```

## How It Works
1. Paste a GitHub URL → file tree loads instantly
2. Click **Index Repo** → files are chunked, embedded, and indexed in FAISS
3. Ask a question in chat → top-k relevant code chunks retrieved → LLM answers with source citations
4. Browse files with syntax highlighting (code, markdown, images, PDFs, Jupyter notebooks)

### Demo
https://github.com/user-attachments/assets/ca0011aa-8eab-4b49-86b4-880023b273dd
