import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FileCode, FileText, Folder, Search, FileJson, Package } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FileNode } from '@/lib/api'

interface Props {
  files: FileNode[]
  username: string
  repo: string
  selectedPath: string | null
  openPaths?: string[]
  onFileSelect: (path: string) => void
}

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  if (name === 'package.json' || name === 'package-lock.json')
    return <Package className="h-4 w-4 mr-2 text-orange-400 shrink-0" />
  switch (ext) {
    case 'js': case 'jsx': case 'ts': case 'tsx':
      return <FileCode className="h-4 w-4 mr-2 text-blue-400 shrink-0" />
    case 'json':
      return <FileJson className="h-4 w-4 mr-2 text-yellow-400 shrink-0" />
    case 'md': case 'mdx':
      return <FileText className="h-4 w-4 mr-2 text-purple-400 shrink-0" />
    default:
      return <FileText className="h-4 w-4 mr-2 text-muted-foreground shrink-0" />
  }
}

function Tree({
  nodes,
  level,
  expanded,
  toggle,
  selected,
  openPaths,
  onSelect,
  query,
}: {
  nodes: FileNode[]
  level: number
  expanded: Set<string>
  toggle: (p: string) => void
  selected: string | null
  openPaths: string[]
  onSelect: (p: string) => void
  query: string
}) {
  const filtered = query
    ? nodes.filter(n => n.name.toLowerCase().includes(query.toLowerCase()))
    : nodes

  return (
    <>
      {filtered.map(node => {
        const isOpen = expanded.has(node.path)
        const isSelected = node.path === selected
        const isOpenInTab = node.type === 'file' && openPaths.includes(node.path)
        return (
          <div key={node.path}>
            <div
              style={{ paddingLeft: `${level * 12 + 8}px` }}
              onClick={() => node.type === 'directory' ? toggle(node.path) : onSelect(node.path)}
              className={cn(
                'relative flex items-center py-1.5 pr-2 cursor-pointer rounded text-sm select-none transition-colors',
                isSelected
                  ? 'bg-emerald-500/[0.12] text-emerald-300'
                  : 'hover:bg-muted text-foreground'
              )}
            >
              {/* Left accent bar for active file */}
              {isSelected && node.type === 'file' && (
                <span className="absolute left-0 top-0.5 bottom-0.5 w-0.5 rounded-full bg-emerald-400" />
              )}
              {/* Dimmer left bar for open-but-not-active files */}
              {!isSelected && isOpenInTab && (
                <span className="absolute left-0 top-0.5 bottom-0.5 w-0.5 rounded-full bg-emerald-700" />
              )}
              {node.type === 'directory' ? (
                <>
                  {isOpen
                    ? <ChevronDown className="h-4 w-4 mr-1 text-muted-foreground shrink-0" />
                    : <ChevronRight className="h-4 w-4 mr-1 text-muted-foreground shrink-0" />}
                  <Folder className="h-4 w-4 mr-2 text-blue-400 shrink-0" />
                </>
              ) : (
                <>
                  <span className="w-5 shrink-0" />
                  {fileIcon(node.name)}
                </>
              )}
              <span className={cn(
                'truncate font-mono text-xs',
                isSelected ? 'text-emerald-300 font-medium' : ''
              )}>{node.name}</span>
              {/* Badge: "open" for active, dot for open-in-background */}
              {isSelected && node.type === 'file' && (
                <span className="ml-auto pl-2 shrink-0 text-[9px] font-mono text-emerald-500/70 uppercase tracking-wide">open</span>
              )}
              {!isSelected && isOpenInTab && (
                <span className="ml-auto pl-2 shrink-0 h-1.5 w-1.5 rounded-full bg-emerald-700" />
              )}
            </div>
            {node.type === 'directory' && isOpen && node.children && (
              <Tree
                nodes={node.children}
                level={level + 1}
                expanded={expanded}
                toggle={toggle}
                selected={selected}
                openPaths={openPaths}
                onSelect={onSelect}
                query={query}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

export function FileExplorer({ files, username, repo, selectedPath, openPaths = [], onFileSelect }: Props) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['src', 'public']))

  // Auto-expand all ancestor folders whenever selectedPath changes
  useEffect(() => {
    if (!selectedPath) return
    // e.g. "src/components/AiChat.tsx" → expand "src" and "src/components"
    const parts = selectedPath.split('/')
    if (parts.length <= 1) return  // top-level file, nothing to expand
    const ancestors: string[] = []
    for (let i = 1; i < parts.length; i++) {
      ancestors.push(parts.slice(0, i).join('/'))
    }
    setExpanded(prev => {
      // Only update if something is actually missing — avoids unnecessary re-renders
      const missing = ancestors.filter(a => !prev.has(a))
      if (missing.length === 0) return prev
      const next = new Set(prev)
      missing.forEach(a => next.add(a))
      return next
    })
  }, [selectedPath])

  const toggle = (path: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-3 border-b border-border shrink-0">
        <div className="text-sm mb-2 font-mono text-muted-foreground truncate">
          <a href={`/${username}`} className="text-emerald-400 hover:text-emerald-300">{username}</a>
          <span className="text-foreground mx-1">/</span>
          <span>{repo}</span>
        </div>
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <input
            placeholder="Search files..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-8 pr-3 h-8 bg-muted border border-border rounded text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        <Tree
          nodes={files}
          level={0}
          expanded={expanded}
          toggle={toggle}
          selected={selectedPath}
          openPaths={openPaths}
          onSelect={onFileSelect}
          query={query}
        />
      </div>
    </div>
  )
}
