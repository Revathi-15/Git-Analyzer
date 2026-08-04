import { Loading, TypewriterText } from '@/components/Loading'
import { collectRepoData } from '@/lib/api'
import { ArrowRight, Code, Github, MessageSquare } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Home() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [status, setStatus] = useState('Analyzing Repository...')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const analyze = async () => {
    const match = url.match(/(?:github\.com\/)?([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/)
    if (!match) { alert('Enter a valid GitHub URL or username/repo'); return }
    const [, username, repo] = match

    setAnalyzing(true)
    setStatus('Preparing preview...')
    void collectRepoData(username, repo, true).catch(() => undefined)
    setStatus('Opening repository...')
    await new Promise(r => setTimeout(r, 200))
    navigate(`/${username}/${repo}`)
  }

  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') analyze() }

  return (
    <div className="flex flex-col bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.13),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(168,85,247,0.14),_transparent_30%)]">
      <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16 relative overflow-hidden">
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-blue-500/20 rounded-full blur-3xl animate-blob" />
          <div className="absolute top-1/3 right-1/4 w-72 h-72 bg-purple-500/20 rounded-full blur-3xl animate-blob animation-delay-2000" />
          <div className="absolute bottom-1/4 right-1/3 w-72 h-72 bg-emerald-500/20 rounded-full blur-3xl animate-blob animation-delay-4000" />
        </div>

        <div className="relative z-10 max-w-4xl w-full text-center space-y-10">
          {analyzing ? (
            <div className="flex items-center justify-center min-h-[240px] rounded-3xl border border-white/60 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl shadow-2xl p-8">
              <Loading text={status} />
            </div>
          ) : (
            <>
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50/80 px-4 py-2 text-sm font-medium text-blue-700 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-300">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                AI-powered repo understanding
              </div>

              <div className="space-y-5 animate-fade-in">
                <div className="flex flex-col items-center gap-1">
                  <TypewriterText
                    text="Understand GitHub repositories"
                    className="text-5xl md:text-7xl font-black tracking-tight text-slate-900 dark:text-white block"
                    speed={40}
                    showCursor={true}
                  />
                  <TypewriterText
                    text="in seconds"
                    className="text-5xl md:text-7xl font-black tracking-tight bg-gradient-to-r from-blue-600 via-purple-600 to-emerald-500 bg-clip-text text-transparent block"
                    speed={40}
                    delay={1500}
                    showCursor={false}
                  />
                </div>
                <p className="mx-auto max-w-2xl text-lg text-slate-600 dark:text-slate-300">
                  Instantly analyze, explain, and improve any GitHub project with a clean, AI-assisted workspace.
                </p>
              </div>

              <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 rounded-3xl border border-slate-200/70 bg-white/80 p-3 shadow-2xl shadow-slate-200/60 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-black/20 sm:flex-row">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="github.com/username/repository"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={onKey}
                  className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                <button
                  onClick={analyze}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-3 font-semibold text-white shadow-lg transition hover:scale-[1.01] hover:shadow-xl"
                >
                  Analyze <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <p className="text-sm text-slate-500 dark:text-slate-400">Example: github.com/username/repo</p>
            </>
          )}
        </div>
      </main>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">How It Works</h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-600 dark:text-slate-300">A polished workflow for understanding repos, asking questions, and exploring code faster.</p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              { icon: <Github className="h-7 w-7" />, color: 'from-blue-600 to-cyan-500', title: 'Repository Analysis', desc: 'Scan repository structure and metadata quickly to get a useful overview without waiting on heavy processing.' },
              { icon: <MessageSquare className="h-7 w-7" />, color: 'from-purple-600 to-fuchsia-500', title: 'AI Chat Assistant', desc: 'Ask questions about the codebase and receive instant, contextual guidance powered by Gemini.' },
              { icon: <Code className="h-7 w-7" />, color: 'from-emerald-600 to-lime-500', title: 'Code Navigation', desc: 'Jump through files and inspect content with a more intuitive explorer experience.' },
            ].map(({ icon, color, title, desc }) => (
              <div key={title} className="group rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-lg shadow-slate-200/50 backdrop-blur transition hover:-translate-y-1 hover:shadow-2xl dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-black/10">
                <div className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${color} text-white shadow-lg`}>
                  {icon}
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
