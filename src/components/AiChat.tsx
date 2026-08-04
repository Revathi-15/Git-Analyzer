import { askGemini, getRateLimit, type RateLimitInfo } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Code, FileQuestion, Lightbulb, Package, SendHorizontal, User } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { CodeBlock } from './CodeBlock'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

interface Props {
  username: string
  repo: string
  selectedFile: string | null
}

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

const QUICK_PROMPTS = [
  { icon: <FileQuestion className="h-3.5 w-3.5" />, label: 'Explain structure', prompt: 'Explain the project structure and what it does?' },
  { icon: <Package className="h-3.5 w-3.5" />, label: 'Dependencies', prompt: 'What are the main dependencies of this project?' },
  { icon: <Lightbulb className="h-3.5 w-3.5" />, label: 'Improvements', prompt: 'How can I improve this codebase?' },
  { icon: <FileQuestion className="h-3.5 w-3.5" />, label: 'Create README', prompt: 'Create a README.md for this repository' },
  { icon: <Code className="h-3.5 w-3.5" />, label: 'Generate tests', prompt: 'Generate tests for this code' },
]

export function AiChat({ username, repo, selectedFile }: Props) {
  const [messages, setMessages] = useState<Message[]>([{
    role: 'assistant',
    content: `Hi! I'm your AI assistant for **${username}/${repo}**. Ask me anything about this codebase.`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load initial rate limit
  useEffect(() => {
    getRateLimit().then(r => setRateLimit({ allowed: r.allowed, remaining: r.remaining, limit: r.limit, resetAt: r.resetAt })).catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!loading) inputRef.current?.focus()
  }, [loading])

  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading) return
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    setMessages(prev => [...prev, { role: 'user', content: text, timestamp: ts }])
    setInput('')
    setLoading(true)
    try {
      const isFileExplain = text.startsWith('Explain file contents of') || text.startsWith('Explain this file')
      const data = await askGemini({
        username, repo,
        query: text,
        filePath: selectedFile,
        fetchOnlyCurrentFile: isFileExplain && !!selectedFile,
        history: messages.map(m => ({ role: m.role, content: m.content })),
      })
      if (data.rateLimited) {
        setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${data.error}`, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }])
        if (data.rateLimit) setRateLimit(data.rateLimit)
        return
      }
      if (!data.success) throw new Error(data.error)
      setMessages(prev => [...prev, { role: 'assistant', content: data.response || 'No response.', timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }])
      if (data.rateLimit) setRateLimit(data.rateLimit)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed'
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ ${msg}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }])
    } finally {
      setLoading(false)
    }
  }, [loading, messages, username, repo, selectedFile])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
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
              <span>Online</span>
            </div>
          </div>
        </div>
        <RateDisplay info={rateLimit} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col gap-5 p-4 w-full">
          {messages.map((m, i) => (
            <div key={i} className={cn('flex gap-3', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
              <div className={cn('h-7 w-7 rounded-full flex items-center justify-center shrink-0 border border-border',
                m.role === 'assistant' ? 'bg-muted overflow-hidden' : 'bg-muted')}>
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
                        p({ children }: any) {
                          return <p className="mb-2 last:mb-0 break-words">{children}</p>
                        },
                        pre({ children }: any) {
                          return <div className="overflow-x-auto max-w-full">{children}</div>
                        },
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="h-7 w-7 rounded-full bg-muted border border-border flex items-center justify-center shrink-0 overflow-hidden">
                <img src="/logo.svg" alt="AI" className="w-4 h-4" />
              </div>
              <div className="bg-muted border border-border rounded-2xl rounded-tl-sm px-4 py-4">
                <div className="flex items-center gap-1.5">
                  {[0, 150, 300].map(d => (
                    <div key={d} className="h-2 w-2 bg-emerald-500/50 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
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
            placeholder="Ask about this repository..."
            rows={1}
            disabled={loading}
            className="flex-1 min-h-[40px] max-h-[160px] resize-none bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground py-2 px-2"
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className={cn(
              'h-10 w-10 rounded-lg flex items-center justify-center transition-all shrink-0',
              input.trim() ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-md' : 'bg-muted/50 text-muted-foreground'
            )}
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-2">AI can make mistakes. Review generated code before use.</p>
      </div>
    </div>
  )
}
