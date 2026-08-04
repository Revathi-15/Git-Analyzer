import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Star, GitFork, MapPin, Link as LinkIcon, Calendar, Search, ArrowLeft } from 'lucide-react'
import { fetchGitHubUser } from '@/lib/api'
import { Loading } from '@/components/Loading'

interface Repo {
  id: number
  name: string
  description: string
  stargazers_count: number
  forks_count: number
  language: string
  updated_at: string
  html_url: string
}

interface Profile {
  login: string
  name: string
  avatar_url: string
  bio: string
  location: string
  blog: string
  followers: number
  following: number
  public_repos: number
  created_at: string
}

export default function UserProfile() {
  const { username } = useParams<{ username: string }>()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [repos, setRepos] = useState<Repo[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!username) return
    setLoading(true)
    fetchGitHubUser(username)
      .then(({ profile, repos }) => { setProfile(profile); setRepos(repos) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [username])

  if (loading) return <div className="min-h-screen bg-zinc-900 flex items-center justify-center"><Loading text="Loading profile..." /></div>
  if (error || !profile) return (
    <div className="min-h-screen bg-zinc-900 flex items-center justify-center text-zinc-400">
      {error || 'Failed to load profile'}
    </div>
  )

  const filtered = repos.filter(r => r.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-900 to-black p-6">
      <div className="max-w-6xl mx-auto">
        <button onClick={() => navigate('/')} className="flex items-center gap-2 mb-6 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:bg-zinc-700 text-sm transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        {/* Profile header */}
        <div className="flex flex-col md:flex-row gap-6 items-start mb-8">
          <div className="relative group shrink-0">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-600 to-blue-600 rounded-full opacity-75 group-hover:opacity-100 blur transition" />
            <img src={profile.avatar_url} alt={profile.name} className="relative w-32 h-32 md:w-36 md:h-36 rounded-full border-4 border-zinc-800" />
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <h1 className="text-3xl font-bold text-white">{profile.name}</h1>
              <p className="text-emerald-500">@{profile.login}</p>
            </div>
            {profile.bio && <p className="text-zinc-300">{profile.bio}</p>}
            <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
              {profile.location && <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{profile.location}</span>}
              {profile.blog && (
                <a href={profile.blog} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-emerald-500 hover:text-emerald-400">
                  <LinkIcon className="h-4 w-4" />{profile.blog}
                </a>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />Joined {new Date(profile.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Repositories', value: profile.public_repos },
            { label: 'Followers', value: profile.followers },
            { label: 'Following', value: profile.following },
          ].map(({ label, value }) => (
            <div key={label} className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
              <p className="text-zinc-400 text-sm mb-1">{label}</p>
              <p className="text-2xl font-bold text-white">{value}</p>
            </div>
          ))}
        </div>

        {/* Repos */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h2 className="text-xl font-semibold text-white">Repositories</h2>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 h-4 w-4" />
              <input
                placeholder="Search repositories..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-1">
            {filtered.map(repo => (
              <div key={repo.id} className="bg-zinc-800/50 border border-zinc-700 hover:border-emerald-500/50 rounded-lg p-4 transition-colors cursor-pointer" onClick={() => navigate(`/${username}/${repo.name}`)}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-emerald-500 hover:text-emerald-400 font-medium">{repo.name}</span>
                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5" />{repo.stargazers_count}</span>
                    <span className="flex items-center gap-1"><GitFork className="h-3.5 w-3.5" />{repo.forks_count}</span>
                  </div>
                </div>
                {repo.description && <p className="text-sm text-zinc-300 mb-2 line-clamp-2">{repo.description}</p>}
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  {repo.language && <span>{repo.language}</span>}
                  <span>Updated {new Date(repo.updated_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
