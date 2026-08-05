const BASE = '/api'

// ── Shared types ──────────────────────────────────────────────────────────────

export interface RepoData {
  summary: string
  tree: string
  content: string
  files: FileNode[]
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export interface RateLimitInfo {
  allowed: boolean
  remaining: number
  limit: number
  resetAt: number
}

export interface GeminiResponse {
  success: boolean
  response?: string
  sources?: string[]      // file paths RAG retrieved to answer the question
  rag_used?: boolean      // whether RAG pipeline was used
  rateLimit?: RateLimitInfo
  rateLimited?: boolean
  error?: string
}

export interface RAGIngestResponse {
  success: boolean
  repo_key?: string
  chunks_count?: number
  files_count?: number
  cached?: boolean
  message?: string
  error?: string
}

export interface RAGStatusResponse {
  indexed: boolean
  repo_key: string
  chunks_count?: number
  files_count?: number
  age_seconds?: number
}

// ── Existing API calls (unchanged) ───────────────────────────────────────────

/** Collect repo file tree via Express → GitHub API */
export async function collectRepoData(
  username: string,
  repo: string,
  force = false
): Promise<{ success: boolean; data?: RepoData; error?: string }> {
  const res = await fetch(`${BASE}/collect-repo-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, repo, force }),
  })
  return res.json()
}

/** Fetch a single file's content */
export async function fetchFileContent(
  username: string,
  repo: string,
  path: string
): Promise<{ content: string; isBinary: boolean }> {
  const res = await fetch(
    `${BASE}/file-content?username=${encodeURIComponent(username)}&repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to fetch file' }))
    throw new Error(err.error || 'Failed to fetch file content')
  }
  return res.json()
}

/** Check current rate limit status */
export async function getRateLimit(): Promise<{ success: boolean } & RateLimitInfo> {
  const res = await fetch(`${BASE}/rate-limit`)
  return res.json()
}

/** Fetch GitHub user profile + repos (public GitHub API, no secret needed) */
export async function fetchGitHubUser(username: string) {
  const [profileRes, reposRes] = await Promise.all([
    fetch(`https://api.github.com/users/${username}`),
    fetch(`https://api.github.com/users/${username}/repos?sort=updated&per_page=100`),
  ])
  if (!profileRes.ok) throw new Error('User not found')
  return {
    profile: await profileRes.json(),
    repos: await reposRes.json(),
  }
}

// ── NEW: RAG API calls ────────────────────────────────────────────────────────

/**
 * Step 1 — Ingest a repository into the RAG pipeline.
 * Clones repo via GitIngest → chunks → embeds → builds FAISS index.
 * Call this once when the RepoPage loads, then use askGemini() for chat.
 */
export async function ingestRepoForRAG(
  username: string,
  repo: string,
  force = false
): Promise<RAGIngestResponse> {
  const res = await fetch(`${BASE}/ingest-rag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, repo, force }),
  })
  return res.json()
}

/**
 * Step 2 — RAG-powered chat.
 * Embeds the query → FAISS retrieval → grounded Gemini answer.
 * Returns response + sources (which files were used to answer).
 */
export async function askGemini(params: {
  username: string
  repo: string
  query: string
  filePath?: string | null
  fetchOnlyCurrentFile?: boolean
  history?: { role: string; content: string }[]
}): Promise<GeminiResponse> {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: params.username,
      repo: params.repo,
      query: params.query,
      history: params.history ?? [],
      top_k: 5,
    }),
  })
  return res.json()
}

/**
 * Check whether a repo's RAG index is already built in the backend cache.
 */
export async function getRAGStatus(
  username: string,
  repo: string
): Promise<RAGStatusResponse> {
  const res = await fetch(
    `${BASE}/rag-status?username=${encodeURIComponent(username)}&repo=${encodeURIComponent(repo)}`
  )
  return res.json()
}

// ── SSE streaming types ───────────────────────────────────────────────────────

export type StreamEvent =
  | { type: 'progress'; message: string; chunk_file?: string; chunk_index?: number }
  | { type: 'token'; text: string }
  | { type: 'done'; sources: string[]; rateLimit: RateLimitInfo }
  | { type: 'error'; message: string; rateLimited?: boolean; rateLimit?: RateLimitInfo }

export interface StreamCallbacks {
  onProgress?: (msg: string, chunkFile?: string) => void
  onToken?: (text: string) => void
  onDone?: (sources: string[], rateLimit: RateLimitInfo) => void
  onError?: (msg: string, rateLimited?: boolean, rateLimit?: RateLimitInfo) => void
}

/**
 * Streaming RAG chat via SSE.
 * Calls /api/chat-stream and fires callbacks as events arrive.
 * Returns an AbortController so the caller can cancel mid-stream.
 */
export function askGeminiStream(
  params: {
    username: string
    repo: string
    query: string
    filePath?: string | null
    history?: { role: string; content: string }[]
  },
  callbacks: StreamCallbacks
): AbortController {
  const ctrl = new AbortController()

  ;(async () => {
    let res: Response
    try {
      res = await fetch(`${BASE}/chat-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: params.username,
          repo: params.repo,
          query: params.query,
          history: params.history ?? [],
          top_k: 5,
        }),
        signal: ctrl.signal,
      })
    } catch (e: any) {
      if (e?.name !== 'AbortError') callbacks.onError?.('Network error: ' + e?.message)
      return
    }

    if (!res.ok || !res.body) {
      callbacks.onError?.(`HTTP ${res.status}`)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      let done: boolean, value: Uint8Array | undefined
      try {
        ;({ done, value } = await reader.read())
      } catch {
        break
      }
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''  // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw) continue
        try {
          const event: StreamEvent = JSON.parse(raw)
          switch (event.type) {
            case 'progress':
              callbacks.onProgress?.(event.message, event.chunk_file)
              break
            case 'token':
              callbacks.onToken?.(event.text)
              break
            case 'done':
              callbacks.onDone?.(event.sources, event.rateLimit)
              break
            case 'error':
              callbacks.onError?.(event.message, event.rateLimited, event.rateLimit)
              break
          }
        } catch {
          // skip malformed line
        }
      }
    }
  })()

  return ctrl
}
