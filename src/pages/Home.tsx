import { TypewriterText } from '@/components/Loading'
import {
  ArrowRight, Code, Github, MessageSquare,
  AlertCircle, Loader2, User, Search,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

type InputMode = 'idle' | 'validating' | 'error'

export default function Home() {
  const navigate = useNavigate()
  const [url, setUrl]           = useState('')
  const [mode, setMode]         = useState<InputMode>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // ── Smart analyze: username-only → profile, username/repo → repo page ──────
  const analyze = async () => {
    const trimmed = url.trim().replace(/\/$/, '')  // strip trailing slash
    if (!trimmed) {
      setErrorMsg('Paste a GitHub URL or type username / username/repo')
      setMode('error')
      return
    }

    // Extract path from full URL or bare input
    const stripped = trimmed
      .replace(/^https?:\/\/(www\.)?github\.com\/?/, '')
      .replace(/\.git$/, '')

    const parts = stripped.split('/').filter(Boolean)

    if (parts.length === 0) {
      setErrorMsg('Enter a GitHub username or username/repo')
      setMode('error')
      return
    }

    const username = parts[0]
    const repo     = parts[1]

    // Validate username format
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      setErrorMsg(`"${username}" is not a valid GitHub username`)
      setMode('error')
      return
    }

    setMode('validating')
    setErrorMsg('')

    try {
      // Always verify the user exists first (free GitHub public API)
      const userRes = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`)

      if (!userRes.ok) {
        setErrorMsg(`GitHub user "${username}" not found`)
        setMode('error')
        return
      }

      // Username-only input → go to profile page so user can pick a repo
      if (!repo) {
        navigate(`/${username}`)
        return
      }

      // Validate repo format
      if (!/^[a-zA-Z0-9_.-]+$/.test(repo)) {
        setErrorMsg(`"${repo}" is not a valid repository name`)
        setMode('error')
        return
      }

      // Verify the repo actually exists under this user
      const repoRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}`
      )

      if (!repoRes.ok) {
        if (repoRes.status === 404) {
          setErrorMsg(`Repository "${repo}" not found under @${username}`)
        } else if (repoRes.status === 403) {
          setErrorMsg('GitHub rate limit hit — wait a minute and try again')
        } else {
          setErrorMsg(`Could not verify repository (HTTP ${repoRes.status})`)
        }
        setMode('error')
        return
      }

      setMode('idle')
      navigate(`/${username}/${repo}`)
    } catch {
      setErrorMsg('Network error — check your connection and try again')
      setMode('error')
    }
  }

  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') analyze() }
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value)
    if (mode === 'error') { setMode('idle'); setErrorMsg('') }
  }

  const isValidating = mode === 'validating'
  const hasError     = mode === 'error'

  return (
    <div className="min-h-screen bg-[#03040a] flex flex-col">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-20 relative overflow-hidden">

        {/* Ambient orbs */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
          <div className="absolute top-1/3 right-1/4 w-80 h-80 bg-purple-600/10 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-emerald-600/08 rounded-full blur-3xl" />
          {/* dot grid */}
          <div
            className="absolute inset-0 opacity-[0.035]"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
            }}
          />
        </div>

        <div className="relative z-10 w-full max-w-3xl flex flex-col items-center gap-10 text-center">

          {/* Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-xs font-semibold tracking-widest text-emerald-400 uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            AI · RAG · Vector Search
          </div>

          {/* Headline */}
          <div className="space-y-2">
            <TypewriterText
              text="Understand any GitHub repo"
              className="text-5xl md:text-6xl font-black tracking-tight text-white block"
              speed={35}
              showCursor={true}
            />
            <TypewriterText
              text="in seconds"
              className="text-5xl md:text-6xl font-black tracking-tight bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400 bg-clip-text text-transparent block"
              speed={35}
              delay={1200}
              showCursor={false}
            />
            <p className="mt-4 text-base text-slate-400 max-w-xl mx-auto leading-relaxed">
              Paste a repo URL, enter&nbsp;<code className="text-slate-300 bg-white/5 px-1.5 py-0.5 rounded text-sm font-mono">username/repo</code>,
              or just a&nbsp;<code className="text-slate-300 bg-white/5 px-1.5 py-0.5 rounded text-sm font-mono">username</code> to browse their projects.
            </p>
          </div>

          {/* Input card */}
          <div className="w-full max-w-2xl">
            <div className={`
              flex flex-col sm:flex-row gap-2 p-2 rounded-2xl border backdrop-blur-xl transition-all duration-200
              bg-white/[0.04]
              ${hasError
                ? 'border-red-500/60 shadow-[0_0_0_3px_rgba(239,68,68,0.12)]'
                : 'border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.4)] focus-within:border-white/20 focus-within:shadow-[0_0_40px_rgba(99,102,241,0.12)]'
              }
            `}>
              <div className="flex-1 flex items-center gap-2 px-3">
                <Search className="h-4 w-4 text-slate-500 shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="github.com/username/repo  or  username  or  username/repo"
                  value={url}
                  onChange={onChange}
                  onKeyDown={onKey}
                  disabled={isValidating}
                  className="flex-1 bg-transparent py-2.5 text-sm text-white placeholder:text-slate-600 outline-none disabled:opacity-50"
                />
              </div>
              <button
                onClick={analyze}
                disabled={isValidating || !url.trim()}
                className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-all hover:brightness-110 hover:shadow-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {isValidating
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking...</>
                  : <>Analyze <ArrowRight className="h-4 w-4" /></>
                }
              </button>
            </div>

            {/* Inline error */}
            {hasError && (
              <div className="mt-2 flex items-center gap-2 text-sm text-red-400 animate-in fade-in slide-in-from-top-1 duration-200">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Hints */}
            {!hasError && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {[
                  { label: 'Browse a user', example: 'torvalds', icon: <User className="h-3 w-3" /> },
                  { label: 'Open a repo', example: 'facebook/react', icon: <Github className="h-3 w-3" /> },
                  { label: 'Full URL', example: 'github.com/vercel/next.js', icon: <Code className="h-3 w-3" /> },
                ].map(({ label, example, icon }) => (
                  <button
                    key={example}
                    onClick={() => { setUrl(example); setMode('idle'); setErrorMsg(''); inputRef.current?.focus() }}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/8 bg-white/[0.03] text-xs text-slate-500 hover:text-slate-300 hover:border-white/15 transition-all"
                  >
                    {icon}
                    <span className="text-slate-600">{label}:</span>
                    <code className="text-slate-400 font-mono">{example}</code>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ── How it works ────────────────────────────────────────────────────── */}
      <section className="px-6 pb-20 pt-4">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold text-white">How it works</h2>
            <p className="mt-2 text-sm text-slate-500">Three steps from URL to insight.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                icon: <Github className="h-6 w-6" />,
                gradient: 'from-blue-500/20 to-cyan-500/10',
                border: 'border-blue-500/20',
                accent: 'text-blue-400',
                step: '01',
                title: 'Paste any repo',
                desc: 'Drop in a GitHub URL, a username/repo pair, or just a username to browse all their projects.',
              },
              {
                icon: <MessageSquare className="h-6 w-6" />,
                gradient: 'from-purple-500/20 to-fuchsia-500/10',
                border: 'border-purple-500/20',
                accent: 'text-purple-400',
                step: '02',
                title: 'AI indexes the code',
                desc: 'RAG pipeline chunks, embeds, and indexes the repo into a FAISS vector store — grounded answers, not hallucinations.',
              },
              {
                icon: <Code className="h-6 w-6" />,
                gradient: 'from-emerald-500/20 to-lime-500/10',
                border: 'border-emerald-500/20',
                accent: 'text-emerald-400',
                step: '03',
                title: 'Ask anything',
                desc: 'Chat with the codebase, explore files, and get contextual answers with citations back to the exact source files.',
              },
            ].map(({ icon, gradient, border, accent, step, title, desc }) => (
              <div
                key={step}
                className={`relative rounded-2xl border ${border} bg-gradient-to-br ${gradient} p-6 backdrop-blur-sm overflow-hidden group hover:-translate-y-0.5 transition-transform`}
              >
                <span className="absolute top-4 right-5 text-4xl font-black text-white/[0.04] select-none group-hover:text-white/[0.07] transition-colors">
                  {step}
                </span>
                <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 border border-white/8 ${accent} mb-4`}>
                  {icon}
                </div>
                <h3 className="text-sm font-semibold text-white mb-1.5">{title}</h3>
                <p className="text-xs leading-5 text-slate-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
