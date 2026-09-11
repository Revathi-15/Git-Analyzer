import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Entry point — mounts React, then removes the splash screen
const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    <App />
  </StrictMode>
)

// Wait for React to paint its first frame, then fade out + remove the splash
// Two rAF calls ensure the DOM has actually been painted before we hide the splash
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const splash = document.getElementById('splash')
    const canvas = document.getElementById('splash-canvas')
    if (splash) {
      splash.classList.add('hidden')
      // remove from DOM after CSS transition ends (700ms in index.html)
      setTimeout(() => {
        splash.remove()
        canvas?.remove()
      }, 750)
    }
  })
})
