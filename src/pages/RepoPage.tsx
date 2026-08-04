import { AiChat } from '@/components/AiChat'
import { FileExplorer } from '@/components/FileExplorer'
import { FileViewer } from '@/components/FileViewer'
import { collectRepoData, type RepoData } from '@/lib/api'
import { useCallback, useEffect, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

export default function RepoPage() {
  const { username, repo } = useParams<{ username: string; repo: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [repoData, setRepoData] = useState<RepoData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  useEffect(() => {
    if (!username || !repo) return

    setError(null)
    setRepoData(fallbackRepoData(username, repo))

    collectRepoData(username, repo, false)
      .then(res => {
        if (!res.success || !res.data) throw new Error(res.error || 'Failed to load repository')
        setRepoData(res.data)
      })
      .catch(() => undefined)
  }, [username, repo])

  if (!repoData || !username || !repo) {
    return (
      <div className="h-screen bg-background flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <p>{error || 'Repository not found'}</p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 rounded-lg bg-muted hover:bg-accent text-sm transition-colors"
        >
          ← Go home
        </button>
      </div>
    )
  }

  return (
    <div className="h-screen bg-background overflow-hidden">
      <PanelGroup direction="horizontal" className="h-full">
        {/* Left — File Explorer */}
        <Panel defaultSize={20} minSize={14} maxSize={30} collapsible>
          <div className="h-full border-r border-border overflow-hidden">
            <FileExplorer
              files={repoData.files}
              username={username}
              repo={repo}
              selectedPath={selectedFile}
              onFileSelect={selectFile}
            />
          </div>
        </Panel>

        <PanelResizeHandle className="w-1 bg-border hover:bg-emerald-500/40 transition-colors" />

        {/* Middle — File Viewer */}
        <Panel defaultSize={50} minSize={30}>
          <div className="h-full overflow-hidden">
            <FileViewer username={username} repo={repo} filePath={selectedFile} />
          </div>
        </Panel>

        <PanelResizeHandle className="w-1 bg-border hover:bg-emerald-500/40 transition-colors" />

        {/* Right — AI Chat */}
        <Panel defaultSize={30} minSize={20} maxSize={50} collapsible>
          <div className="h-full overflow-hidden">
            <AiChat username={username} repo={repo} selectedFile={selectedFile} />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  )
}
