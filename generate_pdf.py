from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable,
    Table, TableStyle, PageBreak, KeepTogether
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY

OUTPUT = r"c:\Users\SANGAM REVATHI\Documents\resume_Projects\answergit\AnswerGit_Project_Guide.pdf"

doc = SimpleDocTemplate(
    OUTPUT, pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm,
    topMargin=2*cm, bottomMargin=2*cm
)

W = A4[0] - 4*cm

ss = getSampleStyleSheet()

# ── Custom styles ──────────────────────────────────────────────────────────────
DARK   = colors.HexColor('#1a1a2e')
BLUE   = colors.HexColor('#2563eb')
GREEN  = colors.HexColor('#16a34a')
ORANGE = colors.HexColor('#ea580c')
PURPLE = colors.HexColor('#7c3aed')
GRAY   = colors.HexColor('#64748b')
LGRAY  = colors.HexColor('#f1f5f9')
DGRAY  = colors.HexColor('#334155')

def S(name, **kw):
    base = ss[name] if name in ss else ss['Normal']
    return ParagraphStyle(name+'_custom_'+str(id(kw)), parent=base, **kw)

cover_title  = S('Title', fontSize=28, textColor=BLUE,  alignment=TA_CENTER, spaceAfter=6,  leading=34)
cover_sub    = S('Normal', fontSize=13, textColor=DGRAY, alignment=TA_CENTER, spaceAfter=4)
cover_tag    = S('Normal', fontSize=10, textColor=GRAY,  alignment=TA_CENTER, spaceAfter=2)

h1  = S('Heading1', fontSize=18, textColor=BLUE,   spaceAfter=8,  spaceBefore=18, leading=22)
h2  = S('Heading2', fontSize=14, textColor=DARK,   spaceAfter=6,  spaceBefore=12, leading=18)
h3  = S('Heading3', fontSize=11, textColor=PURPLE, spaceAfter=4,  spaceBefore=8,  leading=14)
bod = S('Normal',   fontSize=9.5,textColor=DGRAY,  spaceAfter=5,  leading=14, alignment=TA_JUSTIFY)
bul = S('Normal',   fontSize=9.5,textColor=DGRAY,  spaceAfter=3,  leading=13, leftIndent=14)
cod = S('Code',     fontSize=8.5,textColor=colors.HexColor('#1e293b'),
        backColor=LGRAY, leftIndent=10, rightIndent=10,
        spaceAfter=6, spaceBefore=4, leading=13,
        fontName='Courier', borderPad=4)
qa_q = S('Normal',  fontSize=10, textColor=BLUE,   spaceAfter=2,  spaceBefore=8, fontName='Helvetica-Bold', leading=14)
qa_a = S('Normal',  fontSize=9.5,textColor=DGRAY,  spaceAfter=6,  leading=13, leftIndent=12, alignment=TA_JUSTIFY)
note = S('Normal',  fontSize=9,  textColor=colors.HexColor('#854d0e'),
         backColor=colors.HexColor('#fef9c3'), leftIndent=8, rightIndent=8,
         spaceAfter=6, leading=13, borderPad=3)

def HR(): return HRFlowable(width=W, thickness=0.5, color=colors.HexColor('#cbd5e1'), spaceAfter=6, spaceBefore=2)
def SP(h=6): return Spacer(1, h)
def P(text, style=bod): return Paragraph(text, style)
def H1(t): return P(t, h1)
def H2(t): return P(t, h2)
def H3(t): return P(t, h3)
def Q(t): return P(f"Q: {t}", qa_q)
def A(t): return P(f"A: {t}", qa_a)
def B(t): return P(f"• {t}", bul)
def C(t): return P(t, cod)
def N(t): return P(f"Note: {t}", note)

story = []

# ══════════════════════════════════════════════════════════════════════════════
# COVER PAGE
# ══════════════════════════════════════════════════════════════════════════════
story += [
    SP(60),
    P("AnswerGit", cover_title),
    P("AI-Powered GitHub Repository Analyzer", cover_sub),
    SP(6),
    P("Complete Project Guide — Architecture · Tech Stack · Interview Prep · Deployment", cover_tag),
    SP(4),
    P("From Zero to Advanced", S('Normal', fontSize=11, textColor=PURPLE, alignment=TA_CENTER, fontName='Helvetica-BoldOblique')),
    SP(20),
    HR(),
    SP(6),
    P("Covers: React · TypeScript · Node.js/Express · Python/FastAPI · Google Gemini AI · Octokit · Redis · Vite · TailwindCSS · react-resizable-panels · GitIngest", cover_tag),
    PageBreak(),
]

# ══════════════════════════════════════════════════════════════════════════════
# TABLE OF CONTENTS
# ══════════════════════════════════════════════════════════════════════════════
story += [
    H1("Table of Contents"),
    HR(),
    B("1. What is AnswerGit? — Simple explanation for everyone"),
    B("2. Who are the Users?"),
    B("3. What makes this project special?"),
    B("4. Full Technology Stack — every tool explained"),
    B("5. System Architecture — how all pieces connect (flow diagram)"),
    B("6. Project Folder Structure — every file explained"),
    B("7. Frontend Deep Dive — React, TypeScript, Vite, TailwindCSS"),
    B("8. Backend Deep Dive — Node.js/Express server"),
    B("9. Python FastAPI Microservice — GitIngest"),
    B("10. AI Integration — Google Gemini"),
    B("11. Caching & Rate Limiting — Redis"),
    B("12. GitHub API — Octokit"),
    B("13. How to Run This Project Locally"),
    B("14. How to Deploy This Project"),
    B("15. How to Explain This Project in an Interview"),
    B("16. Project-Specific Interview Questions & Answers (0 to Advanced)"),
    B("17. Tech Stack Interview Questions & Answers (Why this? Why not that?)"),
    B("18. Key Concepts Explained Simply (JWT, REST, API, etc.)"),
    PageBreak(),
]

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — WHAT IS ANSWERGIT
# ══════════════════════════════════════════════════════════════════════════════
story += [
    H1("1. What is AnswerGit?"),
    HR(),
    P("AnswerGit is a web application that lets you paste any public GitHub repository URL and instantly "
      "explore that repository — browse its files, read its code, and chat with an AI assistant (Google Gemini) "
      "that has full context of that codebase.", bod),
    SP(4),
    P("Simple Analogy: Imagine GitHub is a library, and every repository is a book. AnswerGit is like a "
      "smart librarian who has already read every book and can answer any question you have about it — instantly.", note),
    SP(6),
    H2("What can it do?"),
    B("Paste a GitHub URL → instantly see the file tree of that repository"),
    B("Click any file → read its contents with syntax highlighting"),
    B("Ask the AI anything → 'What does this project do?', 'Explain this file', 'How can I improve this code?'"),
    B("View a GitHub user's profile → see all their public repos with stats"),
    B("Works with images, PDFs, Jupyter notebooks, Markdown files, and source code"),
    SP(8),
]

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — WHO ARE THE USERS
# ══════════════════════════════════════════════════════════════════════════════
story += [
    H1("2. Who are the Users?"),
    HR(),
    B("Students & Learners — understand open-source projects quickly without reading every file manually"),
    B("Job Seekers — analyze a company's open-source repo before an interview to impress them"),
    B("Developers — explore unfamiliar codebases before contributing to open source"),
    B("Tech Interviewers — quickly understand a candidate's GitHub project"),
    B("Product Managers — get a non-technical summary of what a repository does"),
    B("Researchers — explore academic code repositories easily"),
    B("Freelancers — audit a client's codebase before giving a quote"),
    SP(8),
]

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — WHAT MAKES IT SPECIAL
# ══════════════════════════════════════════════════════════════════════════════
story += [
    H1("3. What Makes This Project Special?"),
    HR(),
    B("AI-in-context: Unlike ChatGPT where you paste code manually, AnswerGit automatically fetches the entire "
      "repo and feeds it to Gemini as context — the AI actually knows the full codebase"),
    B("Three-panel layout: File Explorer + File Viewer + AI Chat in one screen — like VS Code + AI side by side"),
    B("Resizable panels: Built with react-resizable-panels so users can adjust panel sizes like a real IDE"),
    B("Multi-format support: Not just code — renders PDFs, images, Jupyter notebooks, and Markdown beautifully"),
    B("Rate limiting: Protects the Gemini API from overuse with per-IP daily limits stored in Redis"),
    B("Caching: Repository data is cached in Redis for 6 hours so the same repo is not fetched repeatedly"),
    B("Dual backend: Node.js/Express handles the main logic; a Python FastAPI microservice handles deep ingestion"),
    B("Quick prompts: One-click buttons for common questions like 'Explain structure' or 'Generate tests'"),
    B("Typewriter animation on homepage: Polished UX detail that makes the app feel alive"),
    SP(8),
    PageBreak(),
]

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — FULL TECH STACK
# ══════════════════════════════════════════════════════════════════════════════
story += [
    H1("4. Full Technology Stack"),
    HR(),
]

stack_data = [
    ["Category", "Technology", "Version", "What it does"],
    ["Frontend Framework", "React", "18.3", "Builds the UI with components"],
    ["Language", "TypeScript", "5.6", "Type-safe JavaScript"],
    ["Build Tool", "Vite", "6.0", "Dev server + production bundler"],
    ["Styling", "TailwindCSS", "3.4", "Utility-first CSS framework"],
    ["Routing", "react-router-dom", "6.28", "Client-side page navigation"],
    ["AI SDK (FE)", "@google/generative-ai", "0.24", "Gemini API client"],
    ["GitHub SDK", "@octokit/rest", "21.1", "GitHub REST API wrapper"],
    ["Markdown", "react-markdown", "10.1", "Renders markdown in React"],
    ["Code Highlight", "react-syntax-highlighter", "15.6", "Syntax coloring for code"],
    ["PDF Viewer", "react-pdf", "9.2", "Renders PDF files in browser"],
    ["Panels", "react-resizable-panels", "2.1", "Drag-to-resize layout panels"],
    ["Icons", "lucide-react", "0.454", "Clean SVG icon library"],
    ["CSS Utils", "clsx + tailwind-merge", "latest", "Conditional class merging"],
    ["UI Primitives", "Radix UI", "latest", "Accessible headless components"],
    ["Backend Runtime", "Node.js", ">=18", "JavaScript on the server"],
    ["Backend Framework", "Express", "4.21", "HTTP server & routing"],
    ["CORS", "cors", "2.8", "Cross-origin request handling"],
    ["Env Vars", "dotenv", "16.4", "Loads .env config files"],
    ["Cache/RateLimit", "Redis (ioredis)", "5.3", "In-memory cache + rate limit"],
    ["Python Framework", "FastAPI", ">=0.112", "Python async API server"],
    ["Python Server", "Uvicorn", ">=0.30", "ASGI server for FastAPI"],
    ["Repo Ingestion", "gitingest", ">=0.3.1", "Converts GitHub repos to text"],
    ["HTTP Client (Py)", "httpx", ">=0.27", "Async HTTP client for Python"],
    ["Data Validation", "Pydantic", ">=2.8", "Python data models & validation"],
    ["AI Model", "Google Gemini", "Flash", "LLM for code Q&A"],
]

ts = TableStyle([
    ('BACKGROUND',  (0,0), (-1,0),  BLUE),
    ('TEXTCOLOR',   (0,0), (-1,0),  colors.white),
    ('FONTNAME',    (0,0), (-1,0),  'Helvetica-Bold'),
    ('FONTSIZE',    (0,0), (-1,0),  8),
    ('ALIGN',       (0,0), (-1,-1), 'LEFT'),
    ('FONTSIZE',    (0,1), (-1,-1), 8),
    ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white, LGRAY]),
    ('GRID',        (0,0), (-1,-1), 0.3, colors.HexColor('#cbd5e1')),
    ('TOPPADDING',  (0,0), (-1,-1), 4),
    ('BOTTOMPADDING',(0,0),(-1,-1), 4),
    ('LEFTPADDING', (0,0), (-1,-1), 5),
])
col_w = [3.5*cm, 4.5*cm, 2*cm, W - 10*cm]
story.append(Table(stack_data, colWidths=col_w, style=ts, repeatRows=1))
story.append(SP(10))
story.append(PageBreak())

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 5 — SYSTEM ARCHITECTURE / FLOW
# ══════════════════════════════════════════════════════════════════════════════
story += [
    H1("5. System Architecture & Data Flow"),
    HR(),
    P("The project has three layers that work together:", bod),
    SP(4),
    H2("Architecture Layers"),
    B("Layer 1 — Frontend (React/Vite on port 5173): The browser UI the user interacts with"),
    B("Layer 2 — Node.js/Express Backend (port 3001): The main API server — handles GitHub data, Gemini AI, caching"),
    B("Layer 3 — Python FastAPI Microservice (port 8001): Optional deep repo ingestion via the gitingest library"),
    SP(8),
    H2("Request Flow — Text Diagram"),
]

flow_data = [
    ["Step", "Who", "What happens"],
    ["1", "User (Browser)", "Types github.com/username/repo → clicks Analyze"],
    ["2", "React Frontend", "Calls POST /api/collect-repo-data to Express backend"],
    ["3", "Express Server", "Checks Redis cache first. If hit → return cached data immediately"],
    ["4", "Express Server", "Cache miss → calls GitHub API (via Octokit) to get repo tree"],
    ["5", "Octokit", "Returns flat file list [{path, type}...] from GitHub REST API"],
    ["6", "Express Server", "Converts flat list to nested tree, stores in Redis (TTL=6h), returns to frontend"],
    ["7", "React Frontend", "Renders FileExplorer (left panel) with the tree, FileViewer (middle), AiChat (right)"],
    ["8", "User", "Clicks a file in FileExplorer"],
    ["9", "React Frontend", "Calls GET /api/file-content?path=... to Express"],
    ["10", "Express Server", "Calls GitHub API getContent endpoint, decodes base64, returns text/binary"],
    ["11", "React Frontend", "FileViewer renders the file (code, image, PDF, markdown, notebook)"],
    ["12", "User", "Types a question in the AI Chat panel"],
    ["13", "React Frontend", "Calls POST /api/gemini with {username, repo, query, history}"],
    ["14", "Express Server", "Checks rate limit (Redis). If exceeded → return 429 error"],
    ["15", "Express Server", "Builds a prompt: repo tree + cached content + conversation history + user question"],
    ["16", "Gemini AI", "Returns a markdown-formatted answer"],
    ["17", "Express Server", "Increments rate limit counter in Redis, returns answer to frontend"],
    ["18", "React Frontend", "Renders AI response with react-markdown + CodeBlock syntax highlighting"],
]

ts2 = TableStyle([
    ('BACKGROUND', (0,0),(-1,0), PURPLE),
    ('TEXTCOLOR',  (0,0),(-1,0), colors.white),
    ('FONTNAME',   (0,0),(-1,0), 'Helvetica-Bold'),
    ('FONTSIZE',   (0,0),(-1,-1), 8),
    ('ALIGN',      (0,0),(-1,-1), 'LEFT'),
    ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white, LGRAY]),
    ('GRID',       (0,0),(-1,-1), 0.3, colors.HexColor('#cbd5e1')),
    ('TOPPADDING', (0,0),(-1,-1), 4),
    ('BOTTOMPADDING',(0,0),(-1,-1), 4),
    ('LEFTPADDING',(0,0),(-1,-1), 5),
    ('VALIGN',     (0,0),(-1,-1), 'TOP'),
])
story.append(Table(flow_data, colWidths=[1*cm, 4*cm, W-5*cm], style=ts2, repeatRows=1))
story.append(SP(8))
story.append(PageBreak())

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 6 — FOLDER STRUCTURE
# ══════════════════════════════════════════════════════════════════════════════
story += [
    H1("6. Project Folder Structure — Every File Explained"),
    HR(),
    C("""answergit/
├── src/                          ← React frontend source code
│   ├── main.tsx                  ← Entry point: mounts React app to DOM
│   ├── App.tsx                   ← Router: defines 3 routes (/, /:user, /:user/:repo)
│   ├── index.css                 ← Global CSS variables, Tailwind base styles
│   ├── pages/
│   │   ├── Home.tsx              ← Landing page with URL input + typewriter animation
│   │   ├── RepoPage.tsx          ← Main 3-panel IDE view (Explorer+Viewer+Chat)
│   │   └── UserProfile.tsx       ← GitHub user profile with repo list
│   ├── components/
│   │   ├── AiChat.tsx            ← AI chat sidebar with message history
│   │   ├── FileExplorer.tsx      ← Left panel tree view with search
│   │   ├── FileViewer.tsx        ← Middle panel multi-format file renderer
│   │   ├── CodeBlock.tsx         ← Code display with syntax highlight + copy
│   │   └── Loading.tsx           ← Spinner + TypewriterText animation
│   └── lib/
│       ├── api.ts                ← All fetch calls to /api/* (typed functions)
│       └── utils.ts              ← cn() helper for Tailwind class merging
├── server/
│   └── index.js                  ← Express server: GitHub API + Gemini + Redis
├── gitingest-api/
│   ├── main.py                   ← Python FastAPI: deep repo ingestion fallback
│   └── requirements.txt          ← Python dependencies
├── public/
│   └── logo.svg                  ← App logo used in chat header
├── .env                          ← Secret keys (GEMINI_API_KEY, GITHUB_TOKEN)
├── package.json                  ← Frontend + scripts (dev, build, server, start)
├── vite.config.ts                ← Vite config + proxy /api → localhost:3001
├── tailwind.config.ts            ← Tailwind theme, animations, dark mode
└── tsconfig.json                 ← TypeScript compiler settings"""),
    SP(8),
    PageBreak(),
]

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 7 — FRONTEND DEEP DIVE
# ══════════════════════════════════════════════════════════════════════════════
story += [
    H1("7. Frontend Deep Dive"),
    HR(),

    H2("7.1 main.tsx — Entry Point"),
    P("This is where React starts. It finds the div#root in index.html and renders the entire app inside it. "
      "StrictMode wraps everything to catch potential bugs during development — it runs effects twice in dev "
      "to surface side-effect issues.", bod),
    C("createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)"),

    H2("7.2 App.tsx — Router"),
    P("Sets up 3 client-side routes using react-router-dom v6. This is a Single Page Application (SPA) — "
      "no full page reloads happen. React Router intercepts the URL and renders the matching component.", bod),
    C("/ → Home page\n/:username → UserProfile page\n/:username/:repo → RepoPage (main IDE)"),

    H2("7.3 Home.tsx — Landing Page"),
    B("Has a text input where users paste a GitHub URL"),
    B("Uses a regex to parse username and repo from the URL (handles both github.com/x/y and x/y formats)"),
    B("Calls collectRepoData() in the background to pre-warm the cache"),
    B("Navigates to /:username/:repo using useNavigate()"),
    B("TypewriterText component creates the animated heading letter by letter"),
    B("Background blobs are animated with CSS keyframe animations defined in tailwind.config.ts"),

    H2("7.4 RepoPage.tsx — The Main IDE View"),
    P("This is the most complex page. It renders a 3-panel resizable layout using react-resizable-panels:", bod),
    B("Left Panel (20% default): FileExplorer component — shows the repo file tree"),
    B("Middle Panel (50% default): FileViewer component — shows selected file content"),
    B("Right Panel (30% default): AiChat component — AI conversation"),
    P("The selected file path is stored in the URL query string (?file=src/App.tsx) using useSearchParams. "
      "This means you can share the URL and the same file will be open.", bod),

    H2("7.5 FileExplorer.tsx — File Tree"),
    B("Receives a nested FileNode[] array from the API"),
    B("Uses a recursive Tree component to render directories and files"),
    B("Expanded folders tracked in a Set<string> stored in useState"),
    B("Search input filters by filename (case-insensitive)"),
    B("Different icons for JS/TS, JSON, Markdown, package.json files using lucide-react"),
    B("Selected file highlighted in green (emerald-500)"),

    H2("7.6 FileViewer.tsx — Multi-format File Renderer"),
    P("Handles 5 file types based on file extension:", bod),
    B("text — shows raw code in a <pre> tag"),
    B("markdown — renders with react-markdown + rehype-raw + remark-gfm (supports GFM tables, checkboxes)"),
    B("image — shows with zoom in/out controls, handles base64 binary"),
    B("pdf — uses react-pdf with pdfjs-dist WebWorker loaded from unpkg CDN"),
    B("notebook — parses .ipynb JSON and renders markdown cells + code cells"),
    P("Binary files (images, PDFs) arrive as base64 from the server and are converted to data: URLs.", bod),

    H2("7.7 AiChat.tsx — AI Chat Panel"),
    B("Maintains messages array in useState with role:'user'|'assistant' and timestamps"),
    B("send() function calls askGemini() API, handles loading/error/rate-limit states"),
    B("Conversation history is passed with every message so Gemini has memory of prior questions"),
    B("Quick prompt buttons pre-fill the input with common questions"),
    B("RateDisplay component shows remaining API calls as a colored progress bar"),
    B("ReactMarkdown renders the AI response — code blocks use the CodeBlock component"),
    B("Enter key submits, Shift+Enter creates a new line"),

    H2("7.8 CodeBlock.tsx — Syntax Highlighted Code"),
    B("Uses react-syntax-highlighter with Prism and the Dracula dark theme"),
    B("Copy button uses navigator.clipboard API, shows 'Copied!' feedback for 2 seconds"),
    B("Language label shown in the header bar"),

    H2("7.9 UserProfile.tsx — GitHub User Page"),
    B("Directly calls GitHub public REST API (no backend needed for this page)"),
    B("Parallel fetch of profile + repos using Promise.all() for speed"),
    B("Shows avatar, bio, location, followers, following, public repos count"),
    B("Repository grid with stars, forks, language, last updated"),
    B("Search bar filters repos client-side"),
    B("Click any repo card → navigates to /:username/:repo"),

    SP(8),
    PageBreak(),
]

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 8 — BACKEND DEEP DIVE
# ══════════════════════════════════════════════════════════════════════════════
story += [
    H1("8. Backend Deep Dive — Node.js/Express Server"),
    HR(),
    P("The Express server (server/index.js) runs on port 3001 and acts as the brain of the application. "
      "All sensitive operations (API keys, caching, rate limiting) happen here — never in the browser.", bod),

    H2("8.1 Why Express?"),
    P("Express is a minimal HTTP framework for Node.js. It handles incoming requests, routes them to the "
      "correct handler, and sends back JSON responses. Chosen because it is lightweight, has huge community "
      "support, and perfect for this kind of API proxy/gateway role.", bod),

    H2("8.2 API Endpoints"),
    C("GET  /api/health            → checks if server is running, keys are set\n"
      "GET  /api/rate-limit        → returns remaining AI requests for your IP\n"
      "POST /api/collect-repo-data → fetches GitHub repo tree (cached in Redis)\n"
      "GET  /api/file-content      → fetches a single file from GitHub\n"
      "POST /api/gemini            → sends prompt to Gemini AI, returns answer"),

    H2("8.3 /api/collect-repo-data — How it works"),
    B("Receives { username, repo } in request body"),
    B("Checks Redis cache with key 'repo:username:repo'"),
    B("Cache HIT: returns cached data immediately (very fast, no GitHub API call)"),
    B("Cache MISS: calls GitHub API with Octokit"),
    B("Gets repo info (default branch, description, stars)"),
    B("Gets full recursive tree (all files/folders in one API call)"),
    B("Calls buildFileTreeFromGitHub() to convert flat array to nested tree"),
    B("Stores result in Redis with 6-hour TTL"),
    B("Returns { success: true, data: { files, tree, summary } }"),

    H2("8.4 buildFileTreeFromGitHub() — Algorithm"),
    P("GitHub returns a flat array like: [{path:'src/App.tsx', type:'blob'}, {path:'src', type:'tree'}]. "
      "We need to convert this to a nested tree. The algorithm:", bod),
    B("Sort all items by path so parent folders always appear before children"),
    B("For each item, split path by '/' to get parent path and name"),
    B("If it has no parent (top-level), push to root array"),
    B("Otherwise find the parent node in dirMap{} and push to its children"),
    B("Directories (type='tree') are added to dirMap for fast lookup"),

    H2("8.5 /api/file-content — File Fetching"),
    B("Calls GitHub getContent API endpoint"),
    B("GitHub returns file content as base64-encoded string"),
    B("For binary files (images, PDFs): returns base64 as-is, sets isBinary:true"),
    B("For text files: decodes base64 to UTF-8 string using Buffer.from(content, 'base64').toString('utf-8')"),

    H2("8.6 /api/gemini — AI Chat"),
    B("First checks rate limit for the user's IP address"),
    B("If fetchOnlyCurrentFile=true: fetches just that one file from GitHub for context"),
    B("Otherwise: loads cached repo data (tree + content) to build context"),
    B("Calls buildPrompt() to construct the full prompt with history, tree, code, question"),
    B("Sends to Gemini with temperature=0.7, maxTokens=4096"),
    B("Increments rate limit counter in Redis"),
    B("Returns { success, response, rateLimit }"),

    H2("8.7 Rate Limiting Logic"),
    P("Per-IP, per-day limit of 100 Gemini requests. Stored in Redis as:", bod),
    C("Key: rl:{ip_address}\nValue: { count: 45, resetAt: 1234567890 }\nTTL: dynamic (until resetAt)"),
    P("If Redis is unavailable, rate limiting is skipped gracefully (fail-open design).", bod),

    H2("8.8 Proxy Setup in Vite"),
    P("During development, Vite's dev server runs on port 5173 but the Express server is on 3001. "
      "The vite.config.ts proxy forwards all /api/* requests to http://localhost:3001. "
      "In production, a reverse proxy (like Nginx or Caddy) handles this.", bod),

    SP(8),
    PageBreak(),
]
