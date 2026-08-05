# Git Analyzer

An AI-powered GitHub repository explorer. Paste any public GitHub URL, browse the codebase in a VS Code-style 3-panel layout, and chat with an AI that answers questions grounded in the actual source code using RAG (Retrieval-Augmented Generation).

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router v6 |
| Node Backend | Express, Octokit (GitHub API), Redis (optional cache) |
| Python Backend | FastAPI, sentence-transformers (all-MiniLM-L6-v2), FAISS, LangChain |
| AI / LLM | OpenRouter (GPT, DeepSeek, Gemma, Mistral — free tier) |
| Dev | concurrently, Python venv |

---

## Setup

### Prerequisites
- Node.js 18+, Python 3.11+, npm, pip

### 1 — Clone & install

```bash
git clone <repo-url>
cd "Git Analyzer"

# Node dependencies (frontend + server)
npm install
cd server && npm install && cd ..

# Python dependencies
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Mac/Linux
pip install -r gitingest-api/requirements.txt
```

### 2 — Configure environment variables

Create a `.env` file in the root (copy from `.env.example` if present):

```env
OPENROUTER_API_KEY=sk-or-v1-...   # required — get free at openrouter.ai
GITHUB_TOKEN=ghp_...              # recommended — github.com/settings/tokens
GEMINI_API_KEY=...                # optional — legacy endpoint only
REDIS_URL=redis://...             # optional — enables persistent caching
```

### 3 — Run

```bash
npm start
```

Opens all 3 servers: **Vite :5173** · **Express :3001** · **FastAPI :8001**

Visit → `http://localhost:5173`

---

## How It Works

1. Paste a GitHub URL → file tree loads instantly
2. Click **Index Repo** → files are chunked, embedded, and indexed in FAISS
3. Ask a question in chat → top-5 relevant code chunks retrieved → LLM answers with source citations
4. Browse files with syntax highlighting (code, markdown, images, PDFs, Jupyter notebooks)

---

## Project Structure

```
├── src/                  # React frontend
│   ├── pages/            # Home, RepoPage, UserProfile
│   ├── components/       # AiChat, FileExplorer, FileViewer, CodeBlock, Loading
│   └── lib/              # api.ts (all API calls), utils.ts
├── server/               # Express backend — GitHub API proxy, Redis cache
├── gitingest-api/        # FastAPI backend — RAG pipeline, streaming chat
│   ├── main.py           # API endpoints
│   └── rag.py            # Chunk → embed → FAISS → retrieve → prompt
└── .env                  # API keys (never commit)
```
