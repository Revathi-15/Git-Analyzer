import { AiChat } from '@/components/AiChat'
import { FileExplorer } from '@/components/FileExplorer'
import { FileViewer } from '@/components/FileViewer'
import { collectRepoData, type RepoData } from '@/lib/api'
import {
  ArrowLeft, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  AlertCircle, GitFork, Home, RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

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
  const [loading, setLoading]       = useState(true)
  const [errorMsg, setErrorMsg]     = useState<string | null>(null)
  const [diagnosing, setDiagnosing] = useState(false)
  const [leftOpen, setLeftOpen]     = useState(true)
  const [rightOpen, setRightOpen]   = useState(true)

  const leftPanelRef  = useRef<ImperativePanelHandle>(null)
  const rightPanelRef = useRef<ImperativePanelHandle>(null)

  const selectedFile = searchParams.get('file')

  const selectFile = useCallback((path: string) => {
    setSearchParams({ file: path })
  }, [setSearchParams])

  const closeFile = useCallback(() => {
    setSearchParams({})
  }, [setSearchParams])

  const loadRepo = useCallback(async () => {
    if (!username || !repo) return
    setErrorMsg(null)
    setLoading(true)
    setRepoData(null)

    const res = await collectRepoData(username, repo, false)

    if (res.success && res.data) {
      setRepoData(res.data)
      setLoading(false)
      return
    }

    // Backend failed — ask GitHub directly to give a precise error message
    setDiagnosing(true)
    const msg = await diagnoseRepoError(username, repo)
    setDiagnosing(false)
    setErrorMsg(msg)
    setLoading(false)
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

  // ── Error screen (with diagnosis) ─────────────────────────────────────────
  if (!loading && errorMsg) {
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

      {/* Top bar with toggle buttons */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0 bg-background">
        {/* Left toggle + back button */}
        <div className="flex items-center gap-2">
          {/* Back to home */}
          <button
            onClick={() => navigate('/')}
            title="Back to home"
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="w-px h-4 bg-border" />

          <button
            onClick={toggleLeft}
            title={leftOpen ? 'Close file explorer' : 'Open file explorer'}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {leftOpen
              ? <PanelLeftClose className="h-4 w-4" />
              : <PanelLeftOpen className="h-4 w-4" />}
          </button>
          <span className="text-sm text-muted-foreground font-medium">
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="relative flex h-3.5 w-3.5 shrink-0">
                  <span className="absolute inset-0 rounded-full border-2 border-muted" />
                  <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-emerald-500 animate-spin" />
                </span>
                <span>{diagnosing ? 'Diagnosing…' : `Loading ${username}/${repo}...`}</span>
              </span>
            ) : (
              <span>{username} / <span className="text-foreground font-semibold">{repo}</span></span>
            )}
          </span>
        </div>

        {/* Right toggle */}
        <button
          onClick={toggleRight}
          title={rightOpen ? 'Close AI chat' : 'Open AI chat'}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          {rightOpen
            ? <PanelRightClose className="h-4 w-4" />
            : <PanelRightOpen className="h-4 w-4" />}
        </button>
      </div>

      {/* 3-panel layout */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal" className="h-full">

          {/* Left — File Explorer */}
          <Panel ref={leftPanelRef} defaultSize={20} minSize={14} maxSize={35} collapsible
            onCollapse={() => setLeftOpen(false)} onExpand={() => setLeftOpen(true)}>
            <div className="h-full border-r border-border overflow-hidden">
              {loading ? (
                <div className="h-full flex flex-col items-center justify-center gap-4 p-6">
                  <div className="relative w-10 h-10">
                    <div className="absolute inset-0 rounded-full border-2 border-muted" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-emerald-500 animate-spin" />
                  </div>
                  <div className="flex flex-col items-center gap-1 text-center">
                    <span className="text-xs font-medium text-foreground">Loading files</span>
                    <span className="text-[10px] text-muted-foreground">Fetching from GitHub...</span>
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
                  selectedPath={selectedFile}
                  onFileSelect={selectFile}
                />
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-emerald-500/40 transition-colors" />

          {/* Middle — File Viewer */}
          <Panel defaultSize={50} minSize={30}>
            <div className="h-full overflow-hidden">
              <FileViewer username={username} repo={repo} filePath={selectedFile} onClose={selectedFile ? closeFile : undefined} />
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-emerald-500/40 transition-colors" />

          {/* Right — AI Chat */}
          <Panel ref={rightPanelRef} defaultSize={30} minSize={20} maxSize={50} collapsible
            onCollapse={() => setRightOpen(false)} onExpand={() => setRightOpen(true)}>
            <div className="h-full overflow-hidden">
              <AiChat username={username} repo={repo} selectedFile={selectedFile} />
            </div>
          </Panel>

        </PanelGroup>
      </div>
    </div>
  )
}
