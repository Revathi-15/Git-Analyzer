import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from '@/pages/Home'
import UserProfile from '@/pages/UserProfile'
import RepoPage from '@/pages/RepoPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/:username" element={<UserProfile />} />
        <Route path="/:username/:repo" element={<RepoPage />} />
      </Routes>
    </BrowserRouter>
  )
}
