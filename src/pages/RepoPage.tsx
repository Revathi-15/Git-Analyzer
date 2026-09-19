import { AiChat } from '@/components/AiChat'
import { FileExplorer } from '@/components/FileExplorer'
import { FileViewer } from '@/components/FileViewer'
import { collectRepoData, ingestRepoForRAG, type RepoData } from '@/lib/api'
import {
  ArrowLeft, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  AlertCircle, GitFork, Home, RefreshCw, X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/utils'

// ── Terminal loading steps — driven by real phase props ───────────────────────
const LOADING_STEPS = [
  { label: 'Repository processing initialized', phase: 0 },
  { label: 'Authenticating with GitHub API...', phase: 0 },
  { label: 'Fetching file tree & contents...',  phase: 1 },
  { label: 'Building vector index...',          phase: 2 },
  { label: 'Finishing repository ingestion...', phase: 2 },
  { label: 'Intelligence ready!',               phase: 3 },
]

// phase 0=starting, 1=repo fetched, 2=indexing, 3=done
function RepoLoadingTerminal({ username, repo, phase }: { username: string; repo: string; phase: number }) {
  // Animate progress smoothly within phase 2 so it doesn't jump straight to 75%
  const [animatedProgress, setAnimatedProgress] = useState(15)

  useEffect(() => {
    const targets: Record<number, number> = { 0: 15, 1: 40, 2: 85, 3: 100 }
    const target = targets[phase] ?? 15
    // Increment by 1% every 400ms until we reach the target
    const interval = setInterval(() => {
      setAnimatedProgress(prev => {
        if (prev >= target) { clearInterval(interval); return target }
        return prev + 1
      })
    }, 400)
    return () => clearInterval(interval)
  }, [phase])

  const visibleUpTo =
    phase === 0 ? 2
    : phase === 1 ? 3
    : phase === 2 ? 5
    : 6

  return (
    <div className="h-full flex items-center justify-center bg-[#03040a] p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d0f1a] shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-[#161825] border-b border-white/[0.07]">
          <span className="h-3 w-3 rounded-full bg-red-500/80" />
          <span className="h-3 w-3 rounded-full bg-yellow-500/80" />
          <span className="h-3 w-3 rounded-full bg-green-500/80" />
          <span className="ml-2 text-xs font-mono text-zinc-500 truncate">
            {username}/{repo} — processing
          </span>
        </div>
        <div className="px-5 py-5 space-y-3 min-h-[200px]">
          {LOADING_STEPS.map((step, i) => {
            if (i >= visibleUpTo) return null
            const done    = i < visibleUpTo - 1
            const current = i === visibleUpTo - 1
            return (
              <div key={i} className="flex items-center gap-3">
                {done ? (
                  <svg className="h-4 w-4 shrink-0 text-emerald-400" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 shrink-0 text-emerald-400 animate-spin" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" />
                    <path d="M8 1a7 7 0 0 1 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                )}
                <span className={
                  done    ? 'text-sm font-mono text-emerald-400'
                  : current ? 'text-sm font-mono text-emerald-300 animate-pulse'
                  : 'text-sm font-mono text-zinc-500'
                }>
                  {step.label}
                </span>
              </div>
            )
          })}
        </div>
        <div className="px-5 pb-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-mono text-zinc-600">Progress</span>
            <span className="text-[11px] font-mono text-zinc-500">{animatedProgress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300 ease-out"
              style={{ width: `${animatedProgress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── File icon helper (used in tabs) ──────────────────────────────────────────
function fileTabIcon(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const colors: Record<string, string> = {
    ts: 'text-blue-400', tsx: 'text-blue-400',
    js: 'text-yellow-400', jsx: 'text-yellow-400',
    py: 'text-emerald-400',
    md: 'text-purple-400', mdx: 'text-purple-400',
    json: 'text-orange-400',
    css: 'text-pink-400', scss: 'text-pink-400',
    html: 'text-red-400',
  }
  return colors[ext] ?? 'text-zinc-500'
}

// ── File tabs bar ─────────────────────────────────────────────────────────────
function FileTabs({
  openFiles, activeFile, onSelect, onClose,
}: {
  openFiles: string[]
  activeFile: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
}) {
  if (openFiles.length === 0) return null
  return (
    <div className="flex items-center overflow-x-auto scrollbar-hide shrink-0 bg-[#0d0f14] border-b border-border">
      {openFiles.map(path => {
        const name = path.split('/').pop() ?? path
        const isActive = path === activeFile
        const iconColor = fileTabIcon(path)
        return (
          <div
            key={path}
            onClick={() => onSelect(path)}
            className={cn(
              'group flex items-center gap-1.5 px-3 py-2 text-xs font-mono cursor-pointer select-none shrink-0 border-r border-border transition-colors relative',
              isActive
                ? 'bg-background text-foreground'
                : 'bg-[#0d0f14] text-zinc-500 hover:text-zinc-300 hover:bg-muted/50'
            )}
          >
            {/* Active indicator — bottom bar */}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-400 rounded-t-full" />
            )}
            {/* Dot color indicator */}
            <span className={cn('h-2 w-2 rounded-full shrink-0', iconColor.replace('text-', 'bg-'))} />
            <span className="max-w-[120px] truncate">{name}</span>
            <button
              onClick={e => { e.stopPropagation(); onClose(path) }}
              className={cn(
                'ml-0.5 rounded p-0.5 transition-all shrink-0',
                isActive
                  ? 'text-zinc-400 hover:text-white hover:bg-white/10 opacity-100'
                  : 'text-zinc-600 hover:text-zinc-300 hover:bg-white/10 opacity-0 group-hover:opacity-100'
              )}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ── Classify the error from a GitHub API response ─────────────────────────────
async function diagnoseRepoError(username: string, repo: string): Promise<string> {
  try {
    // 1. Does the user exist?
    const userRes = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`)
    if (!userRes.ok) {
      return `GitHub user "@${username}" doesn't exist. Double-check the username.`
    }
    // 2. Does the repo exist under this user?
    const repoRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}`
    )
    if (repoRes.status === 404) {
      return `Repository "${repo}" wasn't found under @${username}. It may be private, renamed, or deleted.`
    }
    if (repoRes.status === 403) {
      return `GitHub rate limit reached. Wait a minute then try again.`
    }
    if (!repoRes.ok) {
      return `GitHub returned an error (HTTP ${repoRes.status}). Try again shortly.`
    }
    // Repo exists but our backend failed
    return `Repository found on GitHub but our backend couldn't load it. Try refreshing.`
  } catch {
    return `Network error — check your connection and try again.`
  }
}

// ── Full-screen error state ───────────────────────────────────────────────────
function RepoError({
  username, repo, message, onRetry,
}: {
  username: string
  repo: string
  message: string
  onRetry: () => void
}) {
  const navigate = useNavigate()
  return (
    <div className="h-screen bg-[#03040a] flex flex-col items-center justify-center gap-6 px-6 text-center">
      {/* Icon */}
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">
        <AlertCircle className="h-8 w-8 text-red-400" />
      </div>

      {/* Heading */}
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-white">
          Couldn't load{' '}
          <span className="text-indigo-400">{username}/</span>
          <span className="text-white">{repo}</span>
        </h2>
        <p className="text-sm text-slate-400 max-w-sm leading-relaxed">{message}</p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
        <button
          onClick={onRetry}
          className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 hover:bg-white/10 transition-colors"
        >
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
        <button
          onClick={() => navigate(`/${username}`)}
          className="flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-300 hover:bg-indigo-500/20 transition-colors"
        >
          <GitFork className="h-4 w-4" /> Browse @{username}'s repos
        </button>
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 rounded-xl border border-white/8 bg-transparent px-4 py-2 text-sm text-slate-500 hover:text-slate-300 transition-colors"
        >
          <Home className="h-4 w-4" /> Home
        </button>
      </div>
    </div>
  )
}

export default function RepoPage() {
  const { username, repo } = useParams<{ username: string; repo: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [repoData, setRepoData]     = useState<RepoData | null>(null)
  const [loadPhase, setLoadPhase]   = useState(0)
  const [errorMsg, setErrorMsg]     = useState<string | null>(null)
  const [diagnosing, setDiagnosing] = useState(false)
  const [ragState, setRagState]     = useState<'idle' | 'indexing' | 'ready' | 'failed'>('idle')
  const [chunksCount, setChunksCount] = useState(0)
  const [leftOpen, setLeftOpen]     = useState(true)
  const [rightOpen, setRightOpen]   = useState(true)

  // ── Multi-file tab state ───────────────────────────────────────────────────
  const [openFiles, setOpenFiles]   = useState<string[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)

  const leftPanelRef  = useRef<ImperativePanelHandle>(null)
  const rightPanelRef = useRef<ImperativePanelHandle>(null)

  const showTerminal = loadPhase < 3

  // Keep URL in sync with active file (for shareable links / back button)
  const selectedFile = searchParams.get('file')
  useEffect(() => {
    if (activeFile) {
      setSearchParams({ file: activeFile }, { replace: true })
    } else {
      setSearchParams({}, { replace: true })
    }
  }, [activeFile, setSearchParams])

  // On first load, restore active file from URL
  useEffect(() => {
    const urlFile = searchParams.get('file')
    if (urlFile && !activeFile) {
      setOpenFiles([urlFile])
      setActiveFile(urlFile)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Open a file: add to tabs if not already open, make it active
  const selectFile = useCallback((path: string) => {
    setOpenFiles(prev => prev.includes(path) ? prev : [...prev, path])
    setActiveFile(path)
  }, [])

  // Close a tab: remove it, activate adjacent tab if it was active
  const closeFile = useCallback((path: string) => {
    setOpenFiles(prev => {
      const next = prev.filter(f => f !== path)
      setActiveFile(cur => {
        if (cur !== path) return cur          // closing a background tab
        if (next.length === 0) return null    // no tabs left
        const idx = prev.indexOf(path)
        return next[Math.min(idx, next.length - 1)]  // activate neighbour
      })
      return next
    })
  }, [])

  const loadRepo = useCallback(async () => {
    if (!username || !repo) return
    setErrorMsg(null)
    setLoadPhase(0)
    setRepoData(null)
    setRagState('idle')
    setChunksCount(0)

    setLoadPhase(1)

    const [repoRes, ragRes] = await Promise.allSettled([
      collectRepoData(username, repo, false),
      (async () => {
        setRagState('indexing')
        setLoadPhase(2)
        return ingestRepoForRAG(username, repo, false)
      })(),
    ])

    const repoResult = repoRes.status === 'fulfilled' ? repoRes.value : null
    if (repoResult?.success && repoResult.data) {
      setRepoData(repoResult.data)
    } else {
      setDiagnosing(true)
      const msg = await diagnoseRepoError(username, repo)
      setDiagnosing(false)
      setErrorMsg(msg)
      setLoadPhase(-1)
      return
    }

    const ragResult = ragRes.status === 'fulfilled' ? ragRes.value : null
    if (ragResult?.success) {
      setRagState('ready')
      setChunksCount(ragResult.chunks_count ?? 0)
    } else {
      setRagState('failed')
    }

    setLoadPhase(3)
  }, [username, repo])

  useEffect(() => { loadRepo() }, [loadRepo])

  const toggleLeft = () => {
    if (leftOpen) {
      leftPanelRef.current?.collapse()
      setLeftOpen(false)
    } else {
      leftPanelRef.current?.expand()
      setLeftOpen(true)
    }
  }

  const toggleRight = () => {
    if (rightOpen) {
      rightPanelRef.current?.collapse()
      setRightOpen(false)
    } else {
      rightPanelRef.current?.expand()
      setRightOpen(true)
    }
  }

  if (!username || !repo) {
    return (
      <div className="h-screen bg-[#03040a] flex flex-col items-center justify-center gap-4 text-slate-400">
        <p>Repository not found</p>
        <button onClick={() => navigate('/')} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm transition-colors">
          ← Go home
        </button>
      </div>
    )
  }

  if (loadPhase === -1 && errorMsg) {
    return (
      <RepoError
        username={username}
        repo={repo}
        message={diagnosing ? 'Diagnosing error…' : errorMsg}
        onRetry={loadRepo}
      />
    )
  }

  return (
    <div className="h-screen bg-background overflow-hidden flex flex-col">

      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0 bg-background">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/')} title="Back to home"
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="w-px h-4 bg-border" />
          <button onClick={toggleLeft} title={leftOpen ? 'Close file explorer' : 'Open file explorer'}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            {leftOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>
          <span className="text-sm text-muted-foreground font-medium">
            {showTerminal ? (
              <span className="flex items-center gap-2">
                <span className="relative flex h-3.5 w-3.5 shrink-0">
                  <span className="absolute inset-0 rounded-full border-2 border-muted" />
                  <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-emerald-500 animate-spin" />
                </span>
                <span>
                  {loadPhase <= 1 ? `Loading ${username}/${repo}...`
                    : loadPhase === 2 ? `Indexing ${username}/${repo}...`
                    : diagnosing ? 'Diagnosing…'
                    : `Loading ${username}/${repo}...`}
                </span>
              </span>
            ) : (
              <span>{username} / <span className="text-foreground font-semibold">{repo}</span></span>
            )}
          </span>
        </div>
        <button onClick={toggleRight} title={rightOpen ? 'Close AI chat' : 'Open AI chat'}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
          {rightOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </button>
      </div>

      {/* 3-panel layout */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal" className="h-full">

          {/* Left — File Explorer */}
          <Panel ref={leftPanelRef} defaultSize={20} minSize={14} maxSize={35} collapsible
            onCollapse={() => setLeftOpen(false)} onExpand={() => setLeftOpen(true)}>
            <div className="h-full border-r border-border overflow-hidden">
              {showTerminal ? (
                <div className="h-full flex flex-col items-center justify-center gap-4 p-6">
                  <div className="relative w-10 h-10">
                    <div className="absolute inset-0 rounded-full border-2 border-muted" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-emerald-500 animate-spin" />
                  </div>
                  <div className="flex flex-col items-center gap-1 text-center">
                    <span className="text-xs font-medium text-foreground">
                      {loadPhase <= 1 ? 'Loading files' : 'Building index'}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {loadPhase <= 1 ? 'Fetching from GitHub...' : 'Embedding chunks...'}
                    </span>
                  </div>
                  <div className="w-full flex flex-col gap-2 mt-2 px-1 opacity-30">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-sm bg-muted animate-pulse shrink-0" />
                        <div className="h-2.5 rounded bg-muted animate-pulse" style={{ width: `${35 + (i % 4) * 14}%` }} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <FileExplorer
                  files={repoData?.files ?? []}
                  username={username}
                  repo={repo}
                  selectedPath={activeFile}
                  openPaths={openFiles}
                  onFileSelect={selectFile}
                />
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-emerald-500/40 transition-colors" />

          {/* Middle — Tabs + File Viewer */}
          <Panel defaultSize={50} minSize={30}>
            <div className="h-full flex flex-col overflow-hidden">
              {showTerminal ? (
                <RepoLoadingTerminal username={username} repo={repo} phase={loadPhase} />
              ) : (
                <>
                  <FileTabs
                    openFiles={openFiles}
                    activeFile={activeFile}
                    onSelect={selectFile}
                    onClose={closeFile}
                  />
                  <div className="flex-1 overflow-hidden">
                    <FileViewer
                      username={username}
                      repo={repo}
                      filePath={activeFile}
                      onClose={activeFile ? () => closeFile(activeFile) : undefined}
                    />
                  </div>
                </>
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-emerald-500/40 transition-colors" />

          {/* Right — AI Chat */}
          <Panel ref={rightPanelRef} defaultSize={30} minSize={20} maxSize={50} collapsible
            onCollapse={() => setRightOpen(false)} onExpand={() => setRightOpen(true)}>
            <div className="h-full overflow-hidden">
              <AiChat
                username={username}
                repo={repo}
                selectedFile={activeFile}
                onFileSelect={selectFile}
                externalRagState={ragState}
                externalChunksCount={chunksCount}
              />
            </div>
          </Panel>

        </PanelGroup>
      </div>
    </div>
  )
}
