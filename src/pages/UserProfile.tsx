import { fetchGitHubUser } from '@/lib/api'
import { Loading } from '@/components/Loading'
import {
  ArrowLeft, MapPin, Link as LinkIcon, Calendar,
  Search, Star, GitFork, Users, BookOpen,
  ExternalLink, AlertCircle, Twitter,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

// ── GitHub language → colour (same as github.com) ───────────────────────────
const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5',
  Rust: '#dea584', Go: '#00ADD8', Java: '#b07219', 'C++': '#f34b7d',
  C: '#555555', 'C#': '#178600', Ruby: '#701516', Swift: '#F05138',
  Kotlin: '#A97BFF', HTML: '#e34c26', CSS: '#563d7c', Shell: '#89e051',
  Vue: '#41b883', Svelte: '#ff3e00', Dart: '#00B4AB', PHP: '#4F5D95',
  Scala: '#c22d40', Haskell: '#5e5086', Elixir: '#6e4a7e', Lua: '#000080',
  R: '#198CE7', MATLAB: '#e16737', Dockerfile: '#384d54',
}

interface Repo {
  id: number
  name: string
  description: string | null
  stargazers_count: number
  forks_count: number
  language: string | null
  updated_at: string
  html_url: string
  fork: boolean
  topics?: string[]
}

interface Profile {
  login: string
  name: string | null
  avatar_url: string
  bio: string | null
  location: string | null
  blog: string | null
  twitter_username: string | null
  followers: number
  following: number
  public_repos: number
  created_at: string
  company: string | null
}

type SortKey = 'updated' | 'stars' | 'forks' | 'name'

function langColor(lang: string | null) {
  if (!lang) return '#6b7280'
  return LANG_COLORS[lang] ?? '#6b7280'
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const d = Math.floor(diff / 86_400_000)
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d}d ago`
  const m = Math.floor(d / 30)
  if (m < 12) return `${m}mo ago`
  return `${Math.floor(m / 12)}y ago`
}

// ── Stat pill ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-5 py-3 rounded-xl border border-white/8 bg-white/[0.03]">
      <div className="text-slate-500">{icon}</div>
      <p className="text-xl font-bold text-white">{value.toLocaleString()}</p>
      <p className="text-[11px] text-slate-500 uppercase tracking-wider">{label}</p>
    </div>
  )
}

export default function UserProfile() {
  const { username } = useParams<{ username: string }>()
  const navigate = useNavigate()

  const [profile, setProfile]   = useState<Profile | null>(null)
  const [repos, setRepos]       = useState<Repo[]>([])
  const [search, setSearch]     = useState('')
  const [sortBy, setSortBy]     = useState<SortKey>('updated')
  const [showForks, setShowForks] = useState(false)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    if (!username) return
    setLoading(true)
    setError(null)
    fetchGitHubUser(username)
      .then(({ profile, repos }) => { setProfile(profile as Profile); setRepos(repos as Repo[]) })
      .catch(e => setError(e.message ?? 'Failed to load profile'))
      .finally(() => setLoading(false))
  }, [username])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#03040a] flex items-center justify-center">
        <Loading text={`Loading @${username}...`} />
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-[#03040a] flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
          <AlertCircle className="h-7 w-7 text-red-400" />
        </div>
        <div>
          <p className="text-lg font-semibold text-white">
            {error?.includes('not found') || error?.includes('404')
              ? `GitHub user "@${username}" doesn't exist`
              : 'Failed to load profile'}
          </p>
          <p className="mt-1 text-sm text-slate-500">{error}</p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 hover:bg-white/10 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to search
        </button>
      </div>
    )
  }

  // ── Filter + sort ────────────────────────────────────────────────────────
  const displayed = repos
    .filter(r => !r.fork || showForks)
    .filter(r =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.description ?? '').toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'stars')   return b.stargazers_count - a.stargazers_count
      if (sortBy === 'forks')   return b.forks_count - a.forks_count
      if (sortBy === 'name')    return a.name.localeCompare(b.name)
      // updated (default)
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })

  const blogHref = profile.blog
    ? profile.blog.startsWith('http') ? profile.blog : `https://${profile.blog}`
    : null

  return (
    <div className="min-h-screen bg-[#03040a] text-white">

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 border-b border-white/6 bg-[#03040a]/80 backdrop-blur-xl px-6 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="h-4 w-px bg-white/10" />
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <img src={profile.avatar_url} alt="" className="h-5 w-5 rounded-full" />
          <span className="text-white font-medium">{profile.login}</span>
          {profile.name && <span>· {profile.name}</span>}
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-10">

        {/* ── Profile card ─────────────────────────────────────────────────── */}
        <div className="mb-10 flex flex-col md:flex-row gap-8 items-start">

          {/* Avatar */}
          <div className="shrink-0 relative">
            <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-emerald-500 opacity-60 blur-sm" />
            <img
              src={profile.avatar_url}
              alt={profile.login}
              className="relative w-28 h-28 md:w-32 md:h-32 rounded-full border-2 border-white/10 object-cover"
            />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <h1 className="text-2xl font-bold text-white leading-tight">
                {profile.name ?? profile.login}
              </h1>
              <a
                href={`https://github.com/${profile.login}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-indigo-400 hover:text-indigo-300 transition-colors mt-0.5"
              >
                @{profile.login}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {profile.bio && (
              <p className="text-sm text-slate-400 leading-relaxed max-w-xl">{profile.bio}</p>
            )}

            {/* Meta links */}
            <div className="flex flex-wrap gap-4 text-xs text-slate-500">
              {profile.company && (
                <span className="flex items-center gap-1">
                  <BookOpen className="h-3.5 w-3.5" />
                  {profile.company}
                </span>
              )}
              {profile.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {profile.location}
                </span>
              )}
              {blogHref && (
                <a
                  href={blogHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  <LinkIcon className="h-3.5 w-3.5" />
                  {profile.blog}
                </a>
              )}
              {profile.twitter_username && (
                <a
                  href={`https://twitter.com/${profile.twitter_username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sky-400 hover:text-sky-300 transition-colors"
                >
                  <Twitter className="h-3.5 w-3.5" />
                  @{profile.twitter_username}
                </a>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                Joined {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </span>
            </div>

            {/* Stats */}
            <div className="flex flex-wrap gap-3 pt-1">
              <StatCard label="Repos"      value={profile.public_repos} icon={<BookOpen className="h-4 w-4" />} />
              <StatCard label="Followers"  value={profile.followers}    icon={<Users className="h-4 w-4" />} />
              <StatCard label="Following"  value={profile.following}    icon={<Users className="h-4 w-4" />} />
            </div>
          </div>
        </div>

        {/* ── Repos toolbar ────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-widest">
            Repositories
            <span className="ml-2 text-xs font-normal text-slate-600 normal-case tracking-normal">
              ({displayed.length} shown)
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-600" />
              <input
                placeholder="Filter repos..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded-lg border border-white/8 bg-white/[0.03] text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-white/15 transition-colors w-44"
              />
            </div>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortKey)}
              className="py-1.5 px-3 rounded-lg border border-white/8 bg-[#03040a] text-xs text-slate-400 focus:outline-none focus:border-white/15 transition-colors cursor-pointer"
            >
              <option value="updated">Recently updated</option>
              <option value="stars">Most stars</option>
              <option value="forks">Most forks</option>
              <option value="name">Name A–Z</option>
            </select>

            {/* Fork toggle */}
            <button
              onClick={() => setShowForks(f => !f)}
              className={`py-1.5 px-3 rounded-lg border text-xs transition-colors ${
                showForks
                  ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-400'
                  : 'border-white/8 bg-white/[0.03] text-slate-500 hover:text-slate-300'
              }`}
            >
              {showForks ? 'Hide forks' : 'Show forks'}
            </button>
          </div>
        </div>

        {/* ── Repo grid ────────────────────────────────────────────────────── */}
        {displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-600">
            <BookOpen className="h-10 w-10 opacity-30" />
            <p className="text-sm">
              {search ? `No repos match "${search}"` : 'No repositories to show'}
            </p>
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-xs text-indigo-400 hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {displayed.map(repo => (
              <RepoCard
                key={repo.id}
                repo={repo}
                onClick={() => navigate(`/${username}/${repo.name}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Repo card ─────────────────────────────────────────────────────────────────
function RepoCard({ repo, onClick }: { repo: Repo; onClick: () => void }) {
  const color = langColor(repo.language)

  return (
    <button
      onClick={onClick}
      className="group w-full text-left rounded-xl border border-white/6 bg-white/[0.02] p-4 hover:border-white/15 hover:bg-white/[0.05] transition-all duration-150 focus:outline-none focus:border-indigo-500/40"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        {/* Name + fork badge */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-indigo-400 group-hover:text-indigo-300 transition-colors truncate">
            {repo.name}
          </span>
          {repo.fork && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 text-slate-500 bg-white/[0.03]">
              fork
            </span>
          )}
        </div>

        {/* Stars + forks */}
        <div className="flex items-center gap-3 text-xs text-slate-600 shrink-0">
          {repo.stargazers_count > 0 && (
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" />
              {repo.stargazers_count.toLocaleString()}
            </span>
          )}
          {repo.forks_count > 0 && (
            <span className="flex items-center gap-1">
              <GitFork className="h-3 w-3" />
              {repo.forks_count.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      {repo.description && (
        <p className="text-xs text-slate-500 leading-relaxed mb-3 line-clamp-2">
          {repo.description}
        </p>
      )}

      {/* Topics */}
      {repo.topics && repo.topics.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {repo.topics.slice(0, 4).map(t => (
            <span
              key={t}
              className="text-[10px] px-2 py-0.5 rounded-full border border-indigo-500/20 bg-indigo-500/5 text-indigo-400"
            >
              {t}
            </span>
          ))}
          {repo.topics.length > 4 && (
            <span className="text-[10px] text-slate-600">+{repo.topics.length - 4}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 text-[11px] text-slate-600">
        {repo.language && (
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            {repo.language}
          </span>
        )}
        <span>Updated {timeAgo(repo.updated_at)}</span>
      </div>
    </button>
  )
}
