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

// Dismiss splash reliably:
// - Wait at least 800ms so the entrance animation feels intentional (not a flash)
// - Use a microtask flush (Promise.resolve) + rAF to ensure React has painted
//   before we start the fade-out transition
const splashStart = Date.now()
const MIN_SPLASH_MS = 800

function dismissSplash() {
  const elapsed = Date.now() - splashStart
  const remaining = Math.max(0, MIN_SPLASH_MS - elapsed)
  setTimeout(() => {
    Promise.resolve().then(() => {
      requestAnimationFrame(() => {
        const splash = document.getElementById('splash')
        const canvas = document.getElementById('splash-canvas')
        const rootEl = document.getElementById('root')
        if (!splash) return

        // Stop particle loop + typewriter immediately
        ;(window as any).particlesRunning = false

        // Start fade-out
        splash.classList.add('hidden')

        // Once the CSS transition finishes (700ms), remove splash from DOM
        // and reveal the app — only then re-enable scroll
        setTimeout(() => {
          splash.remove()
          canvas?.remove()
          document.body.classList.remove('splash-active')
          // Fade the root in smoothly rather than snapping into view
          if (rootEl) {
            rootEl.style.transition = 'opacity 0.2s ease'
            rootEl.style.opacity = '1'
          }
        }, 720)
      })
    })
  }, remaining)
}

// Kick off dismissal after React renders
requestAnimationFrame(dismissSplash)
