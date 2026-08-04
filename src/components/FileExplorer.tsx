import { useState } from 'react'
import { ChevronDown, ChevronRight, FileCode, FileText, Folder, Search, FileJson, Package } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FileNode } from '@/lib/api'

interface Props {
  files: FileNode[]
  username: string
  repo: string
  selectedPath: string | null
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
  onSelect,
  query,
}: {
  nodes: FileNode[]
  level: number
  expanded: Set<string>
  toggle: (p: string) => void
  selected: string | null
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
        return (
          <div key={node.path}>
            <div
              style={{ paddingLeft: `${level * 12 + 8}px` }}
              onClick={() => node.type === 'directory' ? toggle(node.path) : onSelect(node.path)}
              className={cn(
                'flex items-center py-1.5 pr-2 cursor-pointer rounded text-sm select-none',
                isSelected ? 'bg-emerald-500/20 text-emerald-400' : 'hover:bg-muted'
              )}
            >
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
              <span className="truncate font-mono text-xs">{node.name}</span>
            </div>
            {node.type === 'directory' && isOpen && node.children && (
              <Tree
                nodes={node.children}
                level={level + 1}
                expanded={expanded}
                toggle={toggle}
                selected={selected}
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

export function FileExplorer({ files, username, repo, selectedPath, onFileSelect }: Props) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['src', 'public']))

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
          onSelect={onFileSelect}
          query={query}
        />
      </div>
    </div>
  )
}
