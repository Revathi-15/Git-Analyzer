import { useState } from 'react'
import { Check, Copy, Terminal } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { dracula } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface Props {
  language: string
  value: string
}

export function CodeBlock({ language, value }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

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
          style={dracula}
          customStyle={{ margin: 0, padding: '1.25rem', background: 'transparent', fontSize: '0.875rem', lineHeight: '1.5' }}
          wrapLongLines={false}
        >
          {value}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}
