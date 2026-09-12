import { AiChat } from '@/components/AiChat'
import { FileExplorer } from '@/components/FileExplorer'
import { FileViewer } from '@/components/FileViewer'
import { collectRepoData, type RepoData } from '@/lib/api'
import { ArrowLeft, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

export default function RepoPage() {
  const { username, repo } = useParams<{ username: string; repo: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [repoData, setRepoData] = useState<RepoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)

  const leftPanelRef  = useRef<ImperativePanelHandle>(null)
  const rightPanelRef = useRef<ImperativePanelHandle>(null)

  const fallbackRepoData = (user: string, project: string): RepoData => ({
    summary: `Preview available for ${user}/${project}.`,
    tree: 'Repository preview loaded',
    content: '',
    files: [],
  })

  const selectedFile = searchParams.get('file')

  const selectFile = useCallback((path: string) => {
    setSearchParams({ file: path })
  }, [setSearchParams])

  const closeFile = useCallback(() => {
    setSearchParams({})
  }, [setSearchParams])

  useEffect(() => {
    if (!username || !repo) return
    setError(null)
    setLoading(true)

    collectRepoData(username, repo, false)
      .then(res => {
        if (!res.success || !res.data) throw new Error(res.error || 'Failed to load')
        setRepoData(res.data)
      })
      .catch(() => setRepoData(fallbackRepoData(username, repo)))
      .finally(() => setLoading(false))
  }, [username, repo])

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
      <div className="h-screen bg-background flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <p>{error || 'Repository not found'}</p>
        <button onClick={() => navigate('/')} className="px-4 py-2 rounded-lg bg-muted hover:bg-accent text-sm transition-colors">
          ← Go home
        </button>
      </div>
    )
  }

  const repoDataToUse = repoData || fallbackRepoData(username, repo)

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
                {/* small inline spinner in the top bar */}
                <span className="relative flex h-3.5 w-3.5 shrink-0">
                  <span className="absolute inset-0 rounded-full border-2 border-muted" />
                  <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-emerald-500 animate-spin" />
                </span>
                <span>Loading {username}/{repo}...</span>
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
                // circular spinner with status text while file tree loads from GitHub
                <div className="h-full flex flex-col items-center justify-center gap-4 p-6">
                  {/* spinning ring */}
                  <div className="relative w-10 h-10">
                    <div className="absolute inset-0 rounded-full border-2 border-muted" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-emerald-500 animate-spin" />
                  </div>
                  <div className="flex flex-col items-center gap-1 text-center">
                    <span className="text-xs font-medium text-foreground">Loading files</span>
                    <span className="text-[10px] text-muted-foreground">Fetching from GitHub...</span>
                  </div>
                  {/* faint skeleton bars below spinner for context */}
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
                  files={repoDataToUse.files}
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
