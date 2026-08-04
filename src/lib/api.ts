const BASE = '/api'

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
  rateLimit?: RateLimitInfo
  rateLimited?: boolean
  error?: string
}

// Collect / refresh repo data via GitIngest
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

// Fetch a single file's content
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

// Send a chat message to Gemini
export async function askGemini(params: {
  username: string
  repo: string
  query: string
  filePath?: string | null
  fetchOnlyCurrentFile?: boolean
  history?: { role: string; content: string }[]
}): Promise<GeminiResponse> {
  const res = await fetch(`${BASE}/gemini`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  return res.json()
}

// Check current rate limit status
export async function getRateLimit(): Promise<{ success: boolean } & RateLimitInfo> {
  const res = await fetch(`${BASE}/rate-limit`)
  return res.json()
}

// Fetch GitHub user profile + repos directly (public API, no secret needed)
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
