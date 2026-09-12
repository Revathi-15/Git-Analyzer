import { useState } from 'react'
import { Check, Copy, Terminal } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import vscDarkPlus from 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus'

interface Props {
  language: string
  value: string
  // When true: full-page file viewer mode — no header bar, line numbers shown
  showLineNumbers?: boolean
}

export function CodeBlock({ language, value, showLineNumbers = false }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── File viewer mode (full page, line numbers, no chrome) ──────────────────
  if (showLineNumbers) {
    return (
      <div className="relative h-full">
        {/* Copy button floats top-right */}
        <button
          onClick={copy}
          title="Copy"
          className="absolute top-3 right-3 z-10 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200 bg-zinc-800/80 px-2 py-1 rounded transition-colors"
        >
          {copied
            ? <><Check className="h-3 w-3 text-emerald-400" /><span className="text-emerald-400">Copied</span></>
            : <><Copy className="h-3 w-3" /><span>Copy</span></>}
        </button>
        <SyntaxHighlighter
          language={language || 'text'}
          style={vscDarkPlus}
          showLineNumbers
          lineNumberStyle={{
            color: '#4b5563',
            fontSize: '0.75rem',
            paddingRight: '1.25rem',
            userSelect: 'none',
            minWidth: '3rem',
            textAlign: 'right',
          }}
          customStyle={{
            margin: 0,
            padding: '1rem 1rem 1rem 0',
            background: '#1e1e1e',
            fontSize: '0.8125rem',
            lineHeight: '1.5rem',
            height: '100%',
            overflow: 'auto',
            borderRadius: 0,
          }}
          wrapLongLines={false}
        >
          {value}
        </SyntaxHighlighter>
      </div>
    )
  }

  // ── Inline chat mode (inside markdown, has header bar) ─────────────────────
  return (
    <div className="relative rounded-lg overflow-hidden border border-zinc-700 shadow-sm bg-zinc-900 my-4">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 border-b border-zinc-700">
        <div className="flex items-center gap-2 text-zinc-400">
          <Terminal className="h-4 w-4" />
          <span className="text-xs font-mono uppercase">{language || 'code'}</span>
        </div>
        <button onClick={copy} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition-colors">
          {copied
            ? <><Check className="h-3.5 w-3.5 text-emerald-400" /><span className="text-emerald-400">Copied!</span></>
            : <><Copy className="h-3.5 w-3.5" /><span>Copy</span></>}
        </button>
      </div>
      <div className="overflow-x-auto">
        <SyntaxHighlighter
          language={language}
          style={vscDarkPlus}
          customStyle={{ margin: 0, padding: '1.25rem', background: 'transparent', fontSize: '0.875rem', lineHeight: '1.5' }}
          wrapLongLines={false}
        >
          {value}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}
