import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { ZoomIn, ZoomOut, RotateCcw, X } from 'lucide-react'
import { Document, Page, pdfjs } from 'react-pdf'
import { CodeBlock } from './CodeBlock'
import { Loading } from './Loading'
import { fetchFileContent } from '@/lib/api'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

type FileType = 'code' | 'markdown' | 'image' | 'pdf' | 'notebook' | 'plaintext'

// Maps file extension → syntax highlighter language name
const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  cs: 'csharp', cpp: 'cpp', cc: 'cpp', c: 'c', h: 'c',
  php: 'php', swift: 'swift', kt: 'kotlin', scala: 'scala',
  html: 'html', css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  xml: 'xml', sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash',
  dockerfile: 'docker', vue: 'vue', svelte: 'markup',
  graphql: 'graphql', r: 'r', lua: 'lua', dart: 'dart',
  env: 'bash', gitignore: 'bash', ini: 'ini', cfg: 'ini',
}

function getFileInfo(path: string): { type: FileType; lang: string } {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const filename = path.split('/').pop()?.toLowerCase() || ''

  if (['jpg','jpeg','png','gif','svg','webp','bmp','ico'].includes(ext))
    return { type: 'image', lang: '' }
  if (ext === 'pdf') return { type: 'pdf', lang: '' }
  if (ext === 'ipynb') return { type: 'notebook', lang: '' }
  if (['md','markdown','mdx'].includes(ext)) return { type: 'markdown', lang: '' }

  // Check extension map for code files
  const lang = EXT_TO_LANG[ext] || EXT_TO_LANG[filename] || ''
  if (lang) return { type: 'code', lang }

  // Fallback — plain text
  return { type: 'plaintext', lang: '' }
}

// ── Notebook renderer (minimal) ───────────────────────────────────────────────
function NotebookViewer({ raw }: { raw: string }) {
  let notebook: any
  try { notebook = JSON.parse(raw) } catch { return <p className="p-4 text-red-400">Invalid notebook JSON</p> }
  return (
    <div className="flex flex-col gap-4 p-4">
      {notebook.cells?.map((cell: any, i: number) => {
        const src = Array.isArray(cell.source) ? cell.source.join('') : cell.source
        return (
          <div key={i} className="rounded-lg border border-zinc-800 overflow-hidden">
            {cell.cell_type === 'markdown'
              ? <div className="p-4 prose dark:prose-invert max-w-none"><ReactMarkdown>{src}</ReactMarkdown></div>
              : <CodeBlock language="python" value={src} />}
          </div>
        )
      })}
    </div>
  )
}

// ── PDF renderer ──────────────────────────────────────────────────────────────
function PdfViewer({ data }: { data: string }) {
  const [pages, setPages] = useState<number>(0)
  const [scale, setScale] = useState(1)
  const src = data.startsWith('data:') ? data : `data:application/pdf;base64,${data.replace(/\s/g, '')}`
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-end gap-2 p-2 border-b border-border bg-muted/30 shrink-0">
        <button onClick={() => setScale(s => Math.max(s - 0.25, 0.5))} className="p-1 rounded hover:bg-muted"><ZoomOut className="h-4 w-4" /></button>
        <span className="text-xs font-mono w-12 text-center">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale(s => Math.min(s + 0.25, 3))} className="p-1 rounded hover:bg-muted"><ZoomIn className="h-4 w-4" /></button>
        <button onClick={() => setScale(1)} className="p-1 rounded hover:bg-muted"><RotateCcw className="h-4 w-4" /></button>
      </div>
      <div className="flex-1 overflow-auto flex flex-col items-center p-4">
        <Document file={src} onLoadSuccess={({ numPages }) => setPages(numPages)}>
          {Array.from({ length: pages }, (_, i) => (
            <Page key={i + 1} pageNumber={i + 1} scale={scale} className="mb-4 shadow-lg" renderTextLayer={false} renderAnnotationLayer={false} />
          ))}
        </Document>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  username: string
  repo: string
  filePath: string | null
  onClose?: () => void
}

export function FileViewer({ username, repo, filePath, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [isBinary, setIsBinary] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    if (!filePath) { setContent(null); return }
    setLoading(true)
    setError(null)
    setContent(null)
    setZoom(1)
    fetchFileContent(username, repo, filePath)
      .then(r => { setContent(r.content); setIsBinary(r.isBinary) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [filePath, username, repo])

  if (!filePath) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Select a file to view its contents
      </div>
    )
  }

  const { type: fileType, lang } = getFileInfo(filePath)
  // label shown in header
  const typeLabel = fileType === 'code' ? (lang.toUpperCase() || 'CODE') : fileType.toUpperCase()

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header bar — breadcrumb style */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted shrink-0">
        <span className="text-xs font-mono text-muted-foreground truncate">{filePath}</span>
        <div className="flex items-center gap-2 ml-2 shrink-0">
          <span className="text-xs text-muted-foreground uppercase">{typeLabel}</span>
          {onClose && (
            <button
              onClick={onClose}
              title="Close file"
              className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && <Loading text="Loading file..." />}
        {error && <div className="p-4 text-red-400 text-sm">Error: {error}</div>}
        {!loading && !error && content !== null && (() => {
          switch (fileType) {
            case 'image': {
              const src = isBinary
                ? `data:image/${filePath.split('.').pop()?.toLowerCase()};base64,${content.replace(/\s/g, '')}`
                : content
              return (
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-end gap-2 p-2 border-b border-border bg-muted/30">
                    <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))} className="p-1 rounded hover:bg-muted"><ZoomOut className="h-4 w-4" /></button>
                    <span className="text-xs font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
                    <button onClick={() => setZoom(z => Math.min(z + 0.25, 3))} className="p-1 rounded hover:bg-muted"><ZoomIn className="h-4 w-4" /></button>
                    <button onClick={() => setZoom(1)} className="p-1 rounded hover:bg-muted"><RotateCcw className="h-4 w-4" /></button>
                  </div>
                  <div className="flex-1 flex items-center justify-center p-4 bg-zinc-900">
                    <img src={src} alt={filePath} style={{ transform: `scale(${zoom})`, transition: 'transform 0.2s' }} className="max-w-full max-h-[80vh] object-contain shadow-lg rounded" />
                  </div>
                </div>
              )
            }
            case 'pdf':
              return <PdfViewer data={content} />
            case 'notebook':
              return <NotebookViewer raw={content} />
            case 'markdown':
              return (
                <div className="p-8 markdown-content max-w-none">
                  <ReactMarkdown
                    rehypePlugins={[rehypeRaw]}
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || '')
                        return match
                          ? <CodeBlock language={match[1]} value={String(children).replace(/\n$/, '')} />
                          : <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono border border-border" {...props}>{children}</code>
                      },
                    }}
                  >
                    {content}
                  </ReactMarkdown>
                </div>
              )
            case 'code':
              // Syntax highlighted with line numbers — matches VS Code style
              return <CodeBlock language={lang} value={content} showLineNumbers />
            default:
              // Plain text — show with line numbers but no syntax highlighting
              return (
                <div className="flex h-full overflow-auto">
                  <div className="select-none shrink-0 text-right pr-4 pl-4 pt-4 pb-4 text-xs font-mono text-zinc-600 bg-zinc-900/50 border-r border-zinc-800 leading-[1.5rem]">
                    {content.split('\n').map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                  <pre className="flex-1 p-4 text-sm font-mono whitespace-pre text-zinc-300 leading-6 overflow-auto">
                    {content}
                  </pre>
                </div>
              )
          }
        })()}
      </div>
    </div>
  )
}
