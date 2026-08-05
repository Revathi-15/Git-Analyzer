import { askGeminiStream, getRateLimit, ingestRepoForRAG, type RateLimitInfo } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Code, FileQuestion, Lightbulb, Package, SendHorizontal, User, Database, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { CodeBlock } from './CodeBlock'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  sources?: string[]   // file paths RAG used — shown under assistant messages
}

interface Props {
  username: string
  repo: string
  selectedFile: string | null
}

// ── Rate limit indicator ──────────────────────────────────────────────────────
function RateDisplay({ info }: { info: RateLimitInfo | null }) {
  if (!info) return null
  const pct = (info.remaining / info.limit) * 100
  const color = info.remaining === 0 ? 'bg-red-500' : info.remaining <= 5 ? 'bg-yellow-500' : 'bg-emerald-500'
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" title={`${info.remaining}/${info.limit} requests remaining`}>
      <span className={cn('h-2 w-2 rounded-full', color)} />
      <span>{info.remaining}/{info.limit}</span>
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── RAG status badge ──────────────────────────────────────────────────────────
type RAGState = 'idle' | 'indexing' | 'ready' | 'failed'

function RAGBadge({ state, chunksCount }: { state: RAGState; chunksCount: number }) {
  if (state === 'idle') return null
  return (
    <div className={cn(
      'flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border',
      state === 'indexing' && 'border-amber-500/40 bg-amber-500/10 text-amber-400',
      state === 'ready'    && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
      state === 'failed'   && 'border-red-500/40 bg-red-500/10 text-red-400',
    )}>
      <Database className="h-3 w-3" />
      {state === 'indexing' && <span>Indexing repo...</span>}
      {state === 'ready'    && <span>RAG ready · {chunksCount} chunks</span>}
      {state === 'failed'   && <span>Index failed</span>}
    </div>
  )
}

// ── Source files citation ─────────────────────────────────────────────────────
function SourceCitation({ sources }: { sources: string[] }) {
  if (!sources.length) return null
  return (
    <div className="mt-2 pt-2 border-t border-border/50">
      <p className="text-[10px] text-muted-foreground mb-1">Sources used:</p>
      <div className="flex flex-wrap gap-1">
        {sources.map(src => (
          <span key={src} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {src}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Loading status showing real-time chunk search progress ───────────────────
function LoadingStatus({ progressMsg, chunkFile, chunkHistory }: {
  progressMsg: string
  chunkFile?: string
  chunkHistory: string[]
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {/* Main status line */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 shrink-0">
          {[0, 150, 300].map(d => (
            <div key={d} className="h-1.5 w-1.5 bg-emerald-500/60 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
        <span className="text-xs text-muted-foreground animate-pulse truncate">{progressMsg || 'Thinking...'}</span>
      </div>

      {/* Current chunk being read */}
      {chunkFile && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground shrink-0">reading:</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 truncate max-w-[220px]">
            {chunkFile}
          </span>
        </div>
      )}

      {/* Mini trail of previously visited chunks */}
      {chunkHistory.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {chunkHistory.map((f, i) => (
            <span
              key={i}
              className="text-[9px] font-mono px-1 py-0.5 rounded bg-muted/60 text-muted-foreground border border-border/40 truncate max-w-[120px]"
              title={f}
            >
              ✓ {f.split('/').pop()}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
const QUICK_PROMPTS = [
  { icon: <FileQuestion className="h-3.5 w-3.5" />, label: 'Explain structure', prompt: 'Explain the project structure and what it does?' },
  { icon: <Package className="h-3.5 w-3.5" />,      label: 'Dependencies',      prompt: 'What are the main dependencies of this project?' },
  { icon: <Lightbulb className="h-3.5 w-3.5" />,    label: 'Improvements',      prompt: 'How can I improve this codebase?' },
  { icon: <FileQuestion className="h-3.5 w-3.5" />, label: 'Create README',      prompt: 'Create a README.md for this repository' },
  { icon: <Code className="h-3.5 w-3.5" />,         label: 'Generate tests',     prompt: 'Generate tests for this code' },
]

// ── Main AiChat component ─────────────────────────────────────────────────────
export function AiChat({ username, repo, selectedFile }: Props) {
  const [messages, setMessages] = useState<Message[]>([{
    role: 'assistant',
    content: `Hi! I'm your AI assistant for **${username}/${repo}**. Ask me anything, or click **Index repo** to enable RAG-powered answers grounded in the actual source code.`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }])
  const [input, setInput]               = useState('')
  const [loading, setLoading]           = useState(false)
  const [rateLimit, setRateLimit]       = useState<RateLimitInfo | null>(null)
  const [ragState, setRagState]         = useState<RAGState>('idle')
  const [chunksCount, setChunksCount]   = useState(0)
  const [progressMsg, setProgressMsg]   = useState('Thinking...')
  const [progressFile, setProgressFile] = useState<string | undefined>(undefined)
  const [chunkHistory, setChunkHistory] = useState<string[]>([])
  const [streaming, setStreaming]       = useState(false)  // true from send → until done/error/abort
  const streamCtrlRef = useRef<AbortController | null>(null)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Re-focus input when not loading
  useEffect(() => {
    if (!loading) inputRef.current?.focus()
  }, [loading])

  // Load rate limit on mount
  useEffect(() => {
    getRateLimit()
      .then(r => setRateLimit({ allowed: r.allowed, remaining: r.remaining, limit: r.limit, resetAt: r.resetAt }))
      .catch(() => {})
  }, [])

  // ── Trigger RAG ingestion ONLY when user clicks Index button ───────────────
  const startIndexing = () => {
    if (ragState === 'indexing') return
    setRagState('indexing')
    setChunksCount(0)

    ingestRepoForRAG(username, repo)
      .then(res => {
        if (res.success) {
          setRagState('ready')
          setChunksCount(res.chunks_count ?? 0)
          const cached = res.cached ? ' (from cache)' : ''
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `Indexed${cached}. **${res.chunks_count} chunks** from **${res.files_count} files** ready. Ask me anything!`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }])
        } else {
          setRagState('failed')
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `⚠️ Indexing failed: ${res.error ?? 'unknown error'}.`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }])
        }
      })
      .catch(() => setRagState('failed'))
  }

  // ── Send a message ──────────────────────────────────────────────────────────
  const send = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    setMessages(prev => [...prev, { role: 'user', content: text, timestamp: ts }])
    setInput('')
    setLoading(true)
    setStreaming(true)
    setProgressMsg('Connecting...')
    setProgressFile(undefined)
    setChunkHistory([])

    // Placeholder index for the streaming assistant message
    let assistantIdx = -1
    let accumulated = ''
    let streamingStarted = false

    // Cancel any previous stream
    streamCtrlRef.current?.abort()

    const ctrl = askGeminiStream(
      {
        username,
        repo,
        query: text,
        filePath: selectedFile,
        history: messages.map(m => ({ role: m.role, content: m.content })),
      },
      {
        onProgress(msg, chunkFile) {
          setProgressMsg(msg)
          if (chunkFile) {
            setProgressFile(chunkFile)
            setChunkHistory(h => {
              const short = chunkFile.split('/').pop() ?? chunkFile
              // avoid duplicates — keep a running list of visited files
              return h.includes(short) ? h : [...h, short]
            })
          } else {
            setProgressFile(undefined)
          }
        },
        onToken(token) {
          accumulated += token
          if (assistantIdx === -1) {
            // First token — hide the loading bubble, add assistant message
            streamingStarted = true
            setLoading(false)
            setMessages(prev => {
              assistantIdx = prev.length
              return [...prev, {
                role: 'assistant',
                content: accumulated,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              }]
            })
          } else {
            setMessages(prev => prev.map((m, i) =>
              i === assistantIdx ? { ...m, content: accumulated } : m
            ))
          }
        },
        onDone(sources, rl) {
          setMessages(prev => prev.map((m, i) =>
            i === assistantIdx ? { ...m, sources } : m
          ))
          setRateLimit(rl)
          setLoading(false)
          setStreaming(false)
        },
        onError(msg, rateLimited, rl) {
          if (!streamingStarted) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `⚠️ ${msg}`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            }])
          }
          if (rl) setRateLimit(rl)
          setLoading(false)
          setStreaming(false)
        },
      }
    )
    streamCtrlRef.current = ctrl
  }, [streaming, messages, username, repo, selectedFile])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  const reindex = () => {
    setRagState('indexing')
    setChunksCount(0)
    ingestRepoForRAG(username, repo, true)
      .then(res => {
        setRagState(res.success ? 'ready' : 'failed')
        if (res.success) setChunksCount(res.chunks_count ?? 0)
      })
      .catch(() => setRagState('failed'))
  }
  return (
    <div className="flex flex-col h-full bg-background border-l border-border">

      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="Git Analyzer" className="w-6 h-6 rounded" />
          <div>
            <p className="text-sm font-semibold">AI Assistant</p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              <span>RAG · Gemini 2.0</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RAGBadge state={ragState} chunksCount={chunksCount} />
          {ragState === 'idle' && (
            <button
              onClick={startIndexing}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors whitespace-nowrap"
            >
              <Database className="h-3 w-3" /> Index repo
            </button>
          )}
          {ragState === 'ready' && (
            <button
              onClick={reindex}
              title="Re-index repository"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          <RateDisplay info={rateLimit} />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col gap-5 p-4 w-full">
          {messages.map((m, i) => (
            <div key={i} className={cn('flex gap-3', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
              <div className={cn(
                'h-7 w-7 rounded-full flex items-center justify-center shrink-0 border border-border',
                m.role === 'assistant' ? 'bg-muted overflow-hidden' : 'bg-muted'
              )}>
                {m.role === 'assistant'
                  ? <img src="/logo.svg" alt="AI" className="w-4 h-4" />
                  : <User className="h-3.5 w-3.5 text-blue-400" />}
              </div>
              <div className={cn('flex flex-col min-w-0 w-full max-w-[85%]', m.role === 'user' ? 'items-end' : 'items-start')}>
                <div className="flex items-center gap-2 mb-1 px-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {m.role === 'assistant' ? 'Git Analyzer AI' : 'You'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{m.timestamp}</span>
                </div>
                <div className={cn(
                  'rounded-2xl px-4 py-3 text-sm leading-relaxed min-w-0 w-full',
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-tr-sm'
                    : 'bg-muted border border-border text-foreground rounded-tl-sm'
                )}>
                  <div className="prose dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent overflow-hidden break-words">
                    <ReactMarkdown
                      components={{
                        code({ className, children, ...props }: any) {
                          const match = /language-(\w+)/.exec(className || '')
                          return match
                            ? <CodeBlock language={match[1]} value={String(children).replace(/\n$/, '')} />
                            : <code className="bg-zinc-700/50 px-1.5 py-0.5 rounded text-xs font-mono break-all" {...props}>{children}</code>
                        },
                        p({ children }: any) { return <p className="mb-2 last:mb-0 break-words">{children}</p> },
                        pre({ children }: any) { return <div className="overflow-x-auto max-w-full">{children}</div> },
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </div>
                  {/* Source citation — only for assistant messages with sources */}
                  {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                    <SourceCitation sources={m.sources} />
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div className="flex gap-3">
              <div className="h-7 w-7 rounded-full bg-muted border border-border flex items-center justify-center shrink-0 overflow-hidden">
                <img src="/logo.svg" alt="AI" className="w-4 h-4" />
              </div>
              <div className="bg-muted border border-border rounded-2xl rounded-tl-sm px-4 py-3">
                <LoadingStatus progressMsg={progressMsg} chunkFile={progressFile} chunkHistory={chunkHistory} />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-border shrink-0">
        {/* Quick prompts */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-2 scrollbar-hide">
          {QUICK_PROMPTS.map(({ icon, label, prompt }) => (
            <button
              key={label}
              onClick={() => setInput(selectedFile && label === 'Explain structure' ? `Explain file contents of : ${selectedFile}` : prompt)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-border bg-muted hover:bg-accent hover:text-emerald-400 whitespace-nowrap transition-colors"
            >
              {icon}{label}
            </button>
          ))}
        </div>

        {/* Textarea */}
        <div className="flex gap-2 bg-muted p-2 rounded-xl border border-border focus-within:border-emerald-500/50 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={ragState === 'ready' ? 'Ask about this codebase (RAG-powered)...' : 'Ask about this repository...'}
            rows={1}
            disabled={false}
            className="flex-1 min-h-[40px] max-h-[160px] resize-none bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground py-2 px-2"
          />
          {streaming ? (
            /* Stop button — shown for the entire generation (loading + token streaming) */
            <button
              onClick={() => {
                streamCtrlRef.current?.abort()
                setLoading(false)
                setStreaming(false)
              }}
              title="Stop generating"
              className="h-10 w-10 rounded-full bg-white flex items-center justify-center shrink-0 shadow-md hover:bg-white/90 transition-all"
            >
              <span className="h-3.5 w-3.5 rounded-sm bg-black block" />
            </button>
          ) : (
            /* Send button — shown when idle */
            <button
              onClick={() => send(input)}
              disabled={!input.trim()}
              className={cn(
                'h-10 w-10 rounded-full flex items-center justify-center transition-all shrink-0',
                input.trim()
                  ? 'bg-white text-black hover:bg-white/90 shadow-md'
                  : 'bg-muted/50 text-muted-foreground cursor-not-allowed'
              )}
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-2">
          {ragState === 'ready'
            ? `Grounded in ${chunksCount} chunks via FAISS search`
            : ragState === 'indexing'
            ? 'Indexing repository...'
            : 'Click "Index repo" for RAG-powered answers'}
        </p>
      </div>
    </div>
  )
}
