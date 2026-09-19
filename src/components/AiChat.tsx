import { askGeminiStream, getRateLimit, ingestRepoForRAG, type RateLimitInfo } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  Code, FileQuestion, Lightbulb, Package, SendHorizontal,
  User, Database, RefreshCw, Copy, Check, Zap, AlertTriangle,
  StopCircle,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { CodeBlock } from './CodeBlock'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Message {
  id: string          // stable identity — used to update the right message during streaming
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  sources?: string[]
  queued?: boolean    // user msg shown while indexing is pending
  stopped?: boolean   // assistant msg that was aborted mid-stream
  streaming?: boolean // assistant msg still receiving tokens
}

interface Props {
  username: string
  repo: string
  selectedFile: string | null
  onFileSelect?: (path: string) => void
  // When provided by RepoPage, AiChat skips its own indexing and uses these values
  externalRagState?: 'idle' | 'indexing' | 'ready' | 'failed'
  externalChunksCount?: number
}

type RAGState = 'idle' | 'indexing' | 'ready' | 'failed'

// ── Gibberish / irrelevant input detection ────────────────────────────────────
function detectInvalidInput(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  if (t.length < 3) return 'Message is too short — please ask a real question.'
  if (/^[\d\s\W]+$/.test(t)) return "That doesn't look like a question. Try asking something about the repo."
  const hasNoSpaces = !t.includes(' ')
  const vowelRatio = (t.match(/[aeiou]/gi) ?? []).length / t.length
  if (hasNoSpaces && t.length > 12 && vowelRatio < 0.08)
    return 'That looks like random text. Try asking a question about the codebase.'
  if (/^(.{1,4})\1{4,}$/.test(t))
    return 'That looks like a repeated pattern. Please ask something meaningful.'
  return null
}

// ── Rate display ──────────────────────────────────────────────────────────────
function RateDisplay({ info }: { info: RateLimitInfo | null }) {
  if (!info) return null
  const pct = (info.remaining / info.limit) * 100
  const color = info.remaining === 0 ? 'bg-red-500' : info.remaining <= 5 ? 'bg-yellow-500' : 'bg-emerald-500'
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-zinc-500" title={`${info.remaining}/${info.limit} daily requests`}>
      <div className="w-12 h-1 bg-zinc-800 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span>{info.remaining}/{info.limit}</span>
    </div>
  )
}

// ── RAG state badge ───────────────────────────────────────────────────────────
function RAGBadge({ state, chunksCount }: { state: RAGState; chunksCount: number }) {
  if (state === 'idle') return null
  return (
    <div className={cn(
      'flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-medium transition-all',
      state === 'indexing' && 'border-amber-500/30 bg-amber-500/[0.08] text-amber-400',
      state === 'ready'    && 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400',
      state === 'failed'   && 'border-red-500/30 bg-red-500/[0.08] text-red-400',
    )}>
      {state === 'indexing' && <><span className="h-2 w-2 rounded-full border border-amber-400 border-t-transparent animate-spin shrink-0" /> Indexing...</>}
      {state === 'ready'    && <><Zap className="h-3 w-3 shrink-0" /> {chunksCount} chunks</>}
      {state === 'failed'   && <><AlertTriangle className="h-3 w-3 shrink-0" /> Index failed</>}
    </div>
  )
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {})}
      title={copied ? 'Copied!' : 'Copy'}
      className={cn('opacity-0 group-hover:opacity-100 p-1 rounded-md transition-all', copied ? 'text-emerald-400' : 'text-zinc-600 hover:text-zinc-300 hover:bg-white/5')}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

// ── Source pills — clickable, opens file in middle panel ─────────────────────
function SourceCitation({ sources, onFileSelect }: { sources: string[]; onFileSelect?: (path: string) => void }) {
  if (!sources.length) return null
  return (
    <div className="mt-3 pt-2.5 border-t border-white/[0.06]">
      <p className="text-[10px] text-zinc-600 mb-1.5 uppercase tracking-wider font-medium">Sources</p>
      <div className="flex flex-wrap gap-1">
        {sources.map(src => (
          <button
            key={src}
            onClick={() => onFileSelect?.(src)}
            title={src}
            className={cn(
              'group flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-md border transition-all',
              onFileSelect
                ? 'bg-emerald-500/[0.08] text-emerald-400/80 border-emerald-500/15 hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/40 cursor-pointer'
                : 'bg-emerald-500/[0.08] text-emerald-400/80 border-emerald-500/15 cursor-default'
            )}
          >
            {onFileSelect && (
              <svg className="h-2.5 w-2.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" viewBox="0 0 12 12" fill="none">
                <path d="M2 2h4v1H3v6h6V7h1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="currentColor"/>
                <path d="M7 2h3v3h-1V3.7L6.4 6.3l-.7-.7L8.3 3H7V2z" fill="currentColor"/>
              </svg>
            )}
            {src.split('/').slice(-2).join('/')}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Animated cursor while streaming ──────────────────────────────────────────
function StreamingCursor() {
  return (
    <span className="inline-flex items-center ml-0.5 align-middle">
      <span className="inline-block w-0.5 h-4 bg-indigo-400/80 rounded-full animate-[pulse_0.8s_ease-in-out_infinite]" />
    </span>
  )
}

// ── Terminal-style answer generation indicator ────────────────────────────────
const CHAT_STEPS = [
  { key: 'search',   label: 'Searching index...' },
  { key: 'reading',  label: 'Reading relevant chunks...' },
  { key: 'assembl',  label: 'Assembling context...' },
  { key: 'query',    label: 'Querying AI...' },
]

function LoadingBubble({ progressMsg, chunkFile, chunkHistory }: {
  progressMsg: string
  chunkFile?: string
  chunkHistory: string[]
}) {
  const msg = progressMsg.toLowerCase()

  // Map the current backend message to a step index (0-based)
  const currentStep =
    msg.includes('search') || msg.includes('connect') ? 0
    : msg.includes('reading') || msg.includes('chunk') ? 1
    : msg.includes('assembl') ? 2
    : msg.includes('query') || msg.includes('ai') ? 3
    : 0

  // Only render steps that have actually been reached — don't show future steps at all
  const visibleSteps = CHAT_STEPS.slice(0, currentStep + 1)
  const progress = Math.round(((currentStep + 1) / CHAT_STEPS.length) * 100)

  return (
    <div className="w-full min-w-[220px] max-w-[300px]">
      {/* Terminal title bar */}
      <div className="flex items-center gap-1.5 mb-3">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
        <span className="ml-1.5 text-[10px] font-mono text-zinc-600">codebase-intelligence — processing</span>
      </div>

      {/* Only show steps that have been reached */}
      <div className="space-y-2 mb-3">
        {visibleSteps.map((step, i) => {
          const done    = i < currentStep
          const current = i === currentStep
          return (
            <div key={step.key} className="flex items-center gap-2">
              {done ? (
                <svg className="h-3.5 w-3.5 shrink-0 text-emerald-400" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                // Spinning arc — only for the current active step
                <svg className="h-3.5 w-3.5 shrink-0 text-emerald-400 animate-spin" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" />
                  <path d="M8 1a7 7 0 0 1 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
              <span className={cn(
                'text-xs font-mono',
                done    ? 'text-emerald-400'
                : current ? 'text-emerald-300'
                : 'text-zinc-600'
              )}>
                {current ? (progressMsg || step.label) : step.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Current file being read */}
      {chunkFile && (
        <div className="flex items-center gap-1.5 text-[10px] mb-2.5">
          <span className="text-zinc-600 shrink-0">reading</span>
          <span className="font-mono text-emerald-400/70 truncate px-1.5 py-0.5 rounded bg-emerald-500/[0.08] border border-emerald-500/10">
            {chunkFile.split('/').slice(-2).join('/')}
          </span>
        </div>
      )}

      {/* Visited files trail */}
      {chunkHistory.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2.5">
          {chunkHistory.slice(-4).map((f, i) => (
            <span key={i} className="text-[9px] px-1 py-0.5 rounded bg-zinc-800/80 text-zinc-600 border border-zinc-700/50 font-mono">
              ✓ {f}
            </span>
          ))}
        </div>
      )}

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-mono text-zinc-600">Progress</span>
          <span className="text-[10px] font-mono text-zinc-500">{progress}%</span>
        </div>
        <div className="h-1 w-full rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ── Indexing banner ───────────────────────────────────────────────────────────
function IndexingBanner() {
  return (
    <div className="mx-4 my-2 flex items-center gap-3 rounded-xl border border-amber-500/15 bg-amber-500/[0.05] px-3 py-2.5">
      <span className="h-3.5 w-3.5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0" />
      <div>
        <p className="text-xs font-medium text-amber-300">Indexing repository</p>
        <p className="text-[10px] text-zinc-500 mt-0.5">Building the RAG index — your question will send automatically when it's ready.</p>
      </div>
    </div>
  )
}

// ── Auto-grow textarea up to maxRows, then scroll ─────────────────────────────
function useAutoResize(ref: React.RefObject<HTMLTextAreaElement>, value: string, maxRows = 6) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const lh = parseInt(getComputedStyle(el).lineHeight || '20', 10)
    const max = lh * maxRows + 16
    el.style.height = Math.min(el.scrollHeight, max) + 'px'
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [value, ref, maxRows])
}

const QUICK_PROMPTS = [
  { icon: <FileQuestion className="h-3 w-3" />, label: 'Structure',    prompt: 'Explain the project structure and what it does?' },
  { icon: <Package className="h-3 w-3" />,      label: 'Dependencies', prompt: 'What are the main dependencies of this project?' },
  { icon: <Lightbulb className="h-3 w-3" />,    label: 'Improvements', prompt: 'How can I improve this codebase?' },
  { icon: <FileQuestion className="h-3 w-3" />, label: 'README',       prompt: 'Create a README.md for this repository' },
  { icon: <Code className="h-3 w-3" />,         label: 'Tests',        prompt: 'Generate tests for this code' },
]

// ── Main component ────────────────────────────────────────────────────────────
export function AiChat({ username, repo, selectedFile, onFileSelect, externalRagState, externalChunksCount }: Props) {
  const [messages, setMessages] = useState<Message[]>([{
    id: 'welcome',
    role: 'assistant',
    content: `Hi! I'm your AI assistant for **${username}/${repo}**.\n\nIndexing the repository now — you can type your question and it will send the moment it's ready.`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }])
  const [input, setInput]               = useState('')
  const [inputError, setInputError]     = useState<string | null>(null)
  const [loading, setLoading]           = useState(false)   // true = loading bubble shown
  const [rateLimit, setRateLimit]       = useState<RateLimitInfo | null>(null)
  const [ragState, setRagState]         = useState<RAGState>('idle')
  const [chunksCount, setChunksCount]   = useState(0)
  const [progressMsg, setProgressMsg]   = useState('Connecting...')
  const [progressFile, setProgressFile] = useState<string | undefined>()
  const [chunkHistory, setChunkHistory] = useState<string[]>([])
  const [streaming, setStreaming]       = useState(false)   // true = tokens still arriving

  // Use a ref for streaming so closures always see the latest value
  const streamingRef     = useRef(false)
  const pendingQueryRef  = useRef<string | null>(null)
  const indexStartedRef  = useRef(false)
  const streamCtrlRef    = useRef<AbortController | null>(null)
  // assistantId as a ref — stable string ID used to find/update the streaming message
  const assistantIdRef   = useRef<string | null>(null)
  // Keep latest messages ref so sendNow closure is never stale
  const messagesRef      = useRef(messages)
  const bottomRef        = useRef<HTMLDivElement>(null)
  const inputRef         = useRef<HTMLTextAreaElement>(null)

  useAutoResize(inputRef, input)

  // Keep ref in sync
  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { streamingRef.current = streaming }, [streaming])

  // Auto-scroll
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  // Re-focus
  useEffect(() => { if (!loading && !streaming) inputRef.current?.focus() }, [loading, streaming])

  // Rate limit
  useEffect(() => {
    getRateLimit()
      .then(r => setRateLimit({ allowed: r.allowed, remaining: r.remaining, limit: r.limit, resetAt: r.resetAt }))
      .catch(() => {})
  }, [])

  // If parent provides RAG state, sync it in and skip self-managed indexing
  useEffect(() => {
    if (externalRagState !== undefined) {
      setRagState(externalRagState)
    }
  }, [externalRagState])

  useEffect(() => {
    if (externalChunksCount !== undefined) {
      setChunksCount(externalChunksCount)
    }
  }, [externalChunksCount])

  // ── Indexing ──────────────────────────────────────────────────────────────
  const triggerIndexing = useCallback(() => {
    // If parent is managing RAG state externally, don't start a second indexing run
    if (externalRagState !== undefined) return
    if (indexStartedRef.current) return
    indexStartedRef.current = true
    setRagState('indexing')
    ;(async () => {
      try {
        const res = await ingestRepoForRAG(username, repo)
        if (res.success) {
          setRagState('ready')
          setChunksCount(res.chunks_count ?? 0)
        } else if (res.error?.includes('timed out') || res.error?.includes('waking')) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            id: `retry-${Date.now()}`,
            content: '⏳ Backend is waking up (free tier). Auto-retrying in 10 seconds...',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }])
          setTimeout(async () => {
            const retry = await ingestRepoForRAG(username, repo)
            setRagState(retry.success ? 'ready' : 'failed')
            if (retry.success) setChunksCount(retry.chunks_count ?? 0)
          }, 10_000)
        } else {
          setRagState('failed')
        }
      } catch {
        setRagState('failed')
      }
    })()
  }, [username, repo])

  // Start indexing on mount
  useEffect(() => { triggerIndexing() }, [triggerIndexing])

  // ── Core send — never stale because it reads from refs ────────────────────
  const sendNow = useCallback((text: string) => {
    if (!text.trim() || streamingRef.current) return

    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const currentMessages = messagesRef.current

    setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: 'user', content: text, timestamp: ts }])
    setInput('')
    setInputError(null)
    setLoading(true)
    setStreaming(true)
    streamingRef.current = true
    setProgressMsg('Connecting...')
    setProgressFile(undefined)
    setChunkHistory([])

    // Generate a stable ID for the assistant response before any async work
    const responseId = `assistant-${Date.now()}`
    assistantIdRef.current = null  // null = message not inserted yet
    let accumulated = ''
    let gotAnyToken = false

    streamCtrlRef.current?.abort()

    const ctrlStream = askGeminiStream(
      {
        username,
        repo,
        query: text,
        filePath: selectedFile,
        history: currentMessages.filter(m => !m.queued).map(m => ({ role: m.role, content: m.content })),
      },
      {
        onProgress(msg, chunkFile) {
          setProgressMsg(msg)
          if (chunkFile) {
            setProgressFile(chunkFile)
            setChunkHistory(h => {
              const short = chunkFile.split('/').pop() ?? chunkFile
              return h.includes(short) ? h : [...h, short]
            })
          } else {
            setProgressFile(undefined)
          }
        },

        onToken(token) {
          accumulated += token
          gotAnyToken = true

          if (assistantIdRef.current === null) {
            // First token — insert the assistant message using its stable ID
            assistantIdRef.current = responseId
            setLoading(false)
            setMessages(prev => [
              ...prev,
              {
                id: responseId,
                role: 'assistant' as const,
                content: accumulated,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                streaming: true,
              },
            ])
          } else {
            // Subsequent tokens — find message by ID, not by index
            setMessages(prev => prev.map(m =>
              m.id === responseId ? { ...m, content: accumulated, streaming: true } : m
            ))
          }
        },

        onDone(sources, rl) {
          setMessages(prev => prev.map(m =>
            m.id === responseId ? { ...m, sources, streaming: false } : m
          ))
          setRateLimit(rl)
          setLoading(false)
          setStreaming(false)
          streamingRef.current = false
        },

        onError(msg, _rl, rl) {
          const wasAborted = msg === '__aborted__'

          if (!gotAnyToken) {
            if (wasAborted) {
              setMessages(prev => [...prev, {
                id: `stopped-${Date.now()}`,
                role: 'assistant',
                content: '',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                streaming: false,
                stopped: true,
              }])
            } else {
              setMessages(prev => [...prev, {
                id: `error-${Date.now()}`,
                role: 'assistant',
                content: `⚠️ ${msg}`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                streaming: false,
              }])
            }
          } else {
            // Partial content — mark as stopped via ID
            setMessages(prev => prev.map(m =>
              m.id === responseId ? { ...m, streaming: false, stopped: true } : m
            ))
          }
          if (rl) setRateLimit(rl)
          setLoading(false)
          setStreaming(false)
          streamingRef.current = false
        },
      }
    )
    streamCtrlRef.current = ctrlStream
  }, [username, repo, selectedFile])

  // Fire pending query when indexing completes
  useEffect(() => {
    if (ragState === 'ready' && pendingQueryRef.current) {
      const q = pendingQueryRef.current
      pendingQueryRef.current = null
      // Unmark queued bubbles
      setMessages(prev => prev.map(m => m.queued ? { ...m, queued: false } : m))
      // Small tick to let state settle before calling sendNow
      setTimeout(() => sendNow(q), 50)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ragState])

  // ── Public send ───────────────────────────────────────────────────────────
  const send = useCallback((text: string) => {
    const t = text.trim()
    if (!t) return

    // Don't queue another while already streaming
    if (streamingRef.current) return

    const err = detectInvalidInput(t)
    if (err) { setInputError(err); return }
    setInputError(null)

    if (ragState === 'indexing') {
      // Overwrite queue (only one pending allowed)
      pendingQueryRef.current = t
      setInput('')
      const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      setMessages(prev => {
        // Replace any existing queued message
        const without = prev.filter(m => !m.queued)
        return [...without, { id: `queued-${Date.now()}`, role: 'user', content: t, timestamp: ts, queued: true }]
      })
      return
    }

    sendNow(t)
  }, [ragState, sendNow])

  // ── Stop streaming ────────────────────────────────────────────────────────
  const stopStreaming = useCallback(() => {
    streamCtrlRef.current?.abort()
    // onError will handle the state cleanup via the abort error
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  const reindex = () => {
    setRagState('indexing')
    setChunksCount(0)
    ingestRepoForRAG(username, repo, true)
      .then(res => { setRagState(res.success ? 'ready' : 'failed'); if (res.success) setChunksCount(res.chunks_count ?? 0) })
      .catch(() => setRagState('failed'))
  }

  const retryIndexing = () => {
    // If external, just re-trigger via local ingest (parent won't interfere after mount)
    indexStartedRef.current = false
    triggerIndexing()
  }

  const hasPending = ragState === 'indexing' && pendingQueryRef.current !== null

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f] border-l border-white/[0.06]">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] shrink-0 bg-[#0a0a0f]">
        <div className="flex items-center gap-2.5">
          <div className="relative h-7 w-7 rounded-lg overflow-hidden border border-white/10 bg-gradient-to-br from-indigo-600/30 to-emerald-600/20 flex items-center justify-center shrink-0">
            <img src="/logo.svg" alt="" className="w-4 h-4" />
            <span className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 border border-[#0a0a0f]" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-white leading-none">AI Assistant</p>
            <p className="text-[10px] text-zinc-600 mt-0.5">RAG · Gemini 2.0</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RAGBadge state={ragState} chunksCount={chunksCount} />
          {ragState === 'failed' && (
            <button onClick={retryIndexing} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-red-500/30 bg-red-500/[0.08] text-red-400 hover:bg-red-500/15 transition-colors">
              <Database className="h-2.5 w-2.5" /> Retry
            </button>
          )}
          {ragState === 'ready' && (
            <button onClick={reindex} title="Re-index" className="p-1 rounded-md hover:bg-white/5 text-zinc-600 hover:text-zinc-400 transition-colors">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          <RateDisplay info={rateLimit} />
        </div>
      </div>

      {/* ── Messages ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-zinc-800/60">
        <div className="flex flex-col gap-0.5 py-4 w-full">

          {ragState === 'indexing' && !hasPending && <IndexingBanner />}

          {messages.map((m) => (
            <MessageRow key={m.id} message={m} onFileSelect={onFileSelect} />
          ))}

          {hasPending && (
            <div className="mx-4 flex items-center gap-2 text-[11px] text-amber-400/60 py-1">
              <span className="h-2.5 w-2.5 border border-amber-400/60 border-t-transparent rounded-full animate-spin shrink-0" />
              Queued — will send when indexing completes...
            </div>
          )}

          {/* Loading bubble — shown until first token arrives */}
          {loading && (
            <div className="flex gap-3 px-4 py-2">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-indigo-600/20 to-emerald-600/10 border border-white/[0.08] flex items-center justify-center shrink-0 mt-0.5">
                <img src="/logo.svg" alt="" className="w-4 h-4" />
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-zinc-900 border border-white/[0.06] px-4 py-3">
                <LoadingBubble progressMsg={progressMsg} chunkFile={progressFile} chunkHistory={chunkHistory} />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-white/[0.06] bg-[#0a0a0f] p-3 space-y-2">

        {/* Quick prompts — locked during indexing */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
          {QUICK_PROMPTS.map(({ icon, label, prompt }) => (
            <button
              key={label}
              disabled={ragState === 'indexing' || streaming}
              onClick={() => {
                const text = selectedFile && label === 'Structure' ? `Explain file contents of: ${selectedFile}` : prompt
                setInput(text); setInputError(null); inputRef.current?.focus()
              }}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] whitespace-nowrap transition-all shrink-0',
                ragState === 'indexing' || streaming
                  ? 'border-white/[0.04] bg-white/[0.01] text-zinc-700 cursor-not-allowed opacity-50'
                  : 'border-white/[0.07] bg-white/[0.03] text-zinc-500 hover:text-zinc-300 hover:border-white/[0.12] hover:bg-white/[0.05] cursor-pointer'
              )}
            >
              {icon}{label}
            </button>
          ))}
        </div>

        {/* Textarea — locked during indexing */}
        <div className={cn(
          'flex items-end gap-2 rounded-xl border px-3 py-2 transition-all duration-200',
          inputError
            ? 'border-red-500/40 bg-red-500/[0.04]'
            : streaming
            ? 'border-indigo-500/30 bg-zinc-900/60'
            : ragState === 'indexing'
            ? 'border-amber-500/20 bg-zinc-900/40 opacity-60'
            : 'border-white/[0.08] bg-zinc-900/60 focus-within:border-indigo-500/40 focus-within:bg-zinc-900'
        )}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => { setInput(e.target.value); if (inputError) setInputError(null) }}
            onKeyDown={onKeyDown}
            placeholder={
              ragState === 'indexing' ? '⏳ Indexing repository — please wait...'
              : streaming             ? 'Generating response...'
              : ragState === 'ready'  ? 'Ask anything about this codebase...'
              : ragState === 'failed' ? 'Ask anything (answers from general knowledge)...'
              : 'Ask about this repository...'
            }
            disabled={streaming || ragState === 'indexing'}
            rows={1}
            className="flex-1 min-h-[36px] resize-none bg-transparent border-none outline-none text-sm text-zinc-200 placeholder:text-zinc-700 py-1 leading-5 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ maxHeight: `${6 * 20 + 16}px` }}
          />
          <div className="shrink-0 self-end pb-0.5">
            {streaming ? (
              <button
                onClick={stopStreaming}
                title="Stop generating"
                className="h-8 w-8 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 flex items-center justify-center transition-colors text-red-400"
              >
                <StopCircle className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => send(input)}
                disabled={!input.trim() || ragState === 'indexing'}
                className={cn(
                  'h-8 w-8 rounded-lg flex items-center justify-center transition-all',
                  ragState === 'indexing'
                    ? 'bg-white/[0.04] text-zinc-700 cursor-not-allowed'
                    : input.trim()
                    ? 'bg-indigo-500 hover:bg-indigo-400 text-white shadow-sm shadow-indigo-500/25'
                    : 'bg-white/[0.04] text-zinc-700 cursor-not-allowed'
                )}
              >
                <SendHorizontal className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {inputError && (
          <p className="text-[11px] text-red-400 flex items-center gap-1.5 px-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />{inputError}
          </p>
        )}

        <p className="text-[10px] text-zinc-700 text-center leading-tight">
          {streaming        ? 'Generating · click ■ to stop'
          : ragState === 'ready'    ? `Grounded in ${chunksCount} chunks · Enter ↵ to send · Shift+Enter for new line`
          : ragState === 'indexing' ? '⏳ Input locked — waiting for index to complete...'
          : ragState === 'failed'   ? 'Index failed · answering from general knowledge'
          : 'Enter ↵ to send · Shift+Enter for new line'}
        </p>
      </div>
    </div>
  )
}

// ── Message row ───────────────────────────────────────────────────────────────
function MessageRow({ message: m, onFileSelect }: { message: Message; onFileSelect?: (path: string) => void }) {
  return (
    <div className={cn('group flex gap-3 px-4 py-1.5', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>

      {/* Avatar */}
      <div className={cn(
        'h-7 w-7 rounded-lg flex items-center justify-center shrink-0 border mt-0.5',
        m.role === 'assistant'
          ? 'bg-gradient-to-br from-indigo-600/20 to-emerald-600/10 border-white/[0.08] overflow-hidden'
          : 'bg-zinc-800/80 border-white/[0.08]'
      )}>
        {m.role === 'assistant'
          ? <img src="/logo.svg" alt="" className="w-4 h-4" />
          : <User className="h-3.5 w-3.5 text-zinc-400" />}
      </div>

      {/* Content col */}
      <div className={cn('flex flex-col min-w-0 max-w-[85%]', m.role === 'user' ? 'items-end' : 'items-start')}>

        {/* Meta row */}
        <div className={cn('flex items-center gap-1.5 mb-1 px-0.5', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
          <span className="text-[11px] font-medium text-zinc-600">{m.role === 'assistant' ? 'AI' : 'You'}</span>
          <span className="text-[10px] text-zinc-700">{m.timestamp}</span>
          {m.queued && (
            <span className="text-[10px] text-amber-500/60 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full border border-amber-400/50 border-t-transparent animate-spin" />
              queued
            </span>
          )}
          {m.stopped && (
            <span className="text-[10px] text-zinc-600 flex items-center gap-1">
              <StopCircle className="h-3 w-3 text-zinc-600" />
              stopped
            </span>
          )}
          {m.streaming && (
            <span className="text-[10px] text-indigo-400/60 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400/50 animate-pulse" />
              writing
            </span>
          )}
          <CopyButton text={m.content} />
        </div>

        {/* Bubble */}
        <div className={cn(
          'rounded-2xl px-4 py-3 text-sm leading-relaxed min-w-0 w-full relative',
          m.role === 'user'
            ? m.queued
              ? 'bg-zinc-800/50 border border-amber-500/15 text-zinc-500 rounded-tr-sm'
              : 'bg-indigo-600 text-white rounded-tr-sm shadow-sm shadow-indigo-900/40'
            : m.stopped
              ? 'bg-zinc-900 border border-zinc-700/50 text-zinc-400 rounded-tl-sm'
              : 'bg-zinc-900 border border-white/[0.06] text-zinc-200 rounded-tl-sm'
        )}>

          {m.role === 'user' ? (
            <p className="whitespace-pre-wrap break-words">{m.content}</p>
          ) : (
            <>
              <div className="prose prose-sm prose-invert max-w-none
                prose-p:leading-relaxed prose-p:text-zinc-300 prose-p:mb-2 prose-p:last:mb-0
                prose-pre:p-0 prose-pre:bg-transparent
                prose-headings:font-bold prose-headings:text-zinc-100
                prose-h1:text-base prose-h1:mt-4 prose-h1:mb-2
                prose-h2:text-sm prose-h2:mt-3 prose-h2:mb-1.5
                prose-h3:text-sm prose-h3:mt-2 prose-h3:mb-1
                prose-strong:text-zinc-100 prose-strong:font-semibold
                prose-code:text-emerald-300 prose-code:bg-zinc-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
                prose-a:text-indigo-400 prose-a:no-underline hover:prose-a:underline
                prose-blockquote:border-l-indigo-500/50 prose-blockquote:text-zinc-500
                prose-ul:text-zinc-300 prose-ol:text-zinc-300
                prose-li:text-zinc-300 prose-li:leading-relaxed
                prose-table:text-xs
                overflow-hidden break-words">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                  components={{
                    code({ className, children, ...props }: any) {
                      const match = /language-(\w+)/.exec(className || '')
                      return match
                        ? <CodeBlock language={match[1]} value={String(children).replace(/\n$/, '')} />
                        : <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-xs font-mono text-emerald-300 break-all" {...props}>{children}</code>
                    },
                    p({ children }: any) { return <p className="mb-2 last:mb-0 break-words text-zinc-300">{children}</p> },
                    pre({ children }: any) { return <div className="overflow-x-auto max-w-full">{children}</div> },
                    table({ children }: any) {
                      return (
                        <div className="overflow-x-auto my-3 rounded-lg border border-white/[0.07]">
                          <table className="w-full text-xs border-collapse">{children}</table>
                        </div>
                      )
                    },
                    thead({ children }: any) { return <thead className="bg-white/[0.04] text-zinc-400 text-[10px] uppercase tracking-wider">{children}</thead> },
                    tbody({ children }: any) { return <tbody className="divide-y divide-white/[0.04]">{children}</tbody> },
                    tr({ children }: any) { return <tr className="hover:bg-white/[0.02] transition-colors">{children}</tr> },
                    th({ children }: any) { return <th className="px-3 py-2 text-left font-semibold text-zinc-400 whitespace-nowrap">{children}</th> },
                    td({ children }: any) { return <td className="px-3 py-2 text-zinc-400 align-top">{children}</td> },
                    ul({ children }: any) { return <ul className="list-disc list-outside pl-4 space-y-1 mb-2">{children}</ul> },
                    ol({ children }: any) { return <ol className="list-decimal list-outside pl-4 space-y-1 mb-2">{children}</ol> },
                    li({ children }: any) { return <li className="leading-relaxed">{children}</li> },
                    h1({ children }: any) { return <h1 className="text-base font-bold text-zinc-100 mt-4 mb-2 first:mt-0">{children}</h1> },
                    h2({ children }: any) { return <h2 className="text-sm font-bold text-zinc-100 mt-3 mb-1.5 first:mt-0">{children}</h2> },
                    h3({ children }: any) { return <h3 className="text-sm font-semibold text-zinc-200 mt-2 mb-1 first:mt-0">{children}</h3> },
                    blockquote({ children }: any) { return <blockquote className="border-l-2 border-indigo-500/40 pl-3 italic text-zinc-500 my-2">{children}</blockquote> },
                    hr() { return <hr className="border-white/[0.06] my-3" /> },
                    a({ children, href }: any) { return <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors">{children}</a> },
                  }}
                >
                  {m.content}
                </ReactMarkdown>
              </div>

              {/* Blinking cursor while streaming */}
              {m.streaming && <StreamingCursor />}

              {/* Stopped notice */}
              {m.stopped && m.content && (
                <div className="mt-2 pt-2 border-t border-zinc-700/40 flex items-center gap-1.5 text-[10px] text-zinc-600">
                  <StopCircle className="h-3 w-3 shrink-0" />
                  Response was stopped — partial answer shown above
                </div>
              )}

              {/* Stopped with no content */}
              {m.stopped && !m.content && (
                <div className="flex items-center gap-2 text-zinc-500 text-xs py-0.5">
                  <StopCircle className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                  <span>You stopped this — no response was generated.</span>
                </div>
              )}

              {m.sources && m.sources.length > 0 && <SourceCitation sources={m.sources} onFileSelect={onFileSelect} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
