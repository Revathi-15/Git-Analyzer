import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// Spinner with optional message
export function Loading({ text, className }: { text?: string; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 p-8', className)}>
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      {text && (
        <p className="text-sm text-muted-foreground animate-pulse">
          {text.replace(/GitIngest/gi, 'analysis')}
        </p>
      )}
    </div>
  )
}

// Typewriter text used on the home page
export function TypewriterText({
  text,
  className,
  speed = 50,
  delay = 0,
  showCursor = true,
}: {
  text: string
  className?: string
  speed?: number
  delay?: number
  showCursor?: boolean
}) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    setDisplayed('')
    setDone(false)
    let i = 0
    const start = setTimeout(() => {
      const id = setInterval(() => {
        if (i < text.length) {
          setDisplayed(text.slice(0, ++i))
        } else {
          clearInterval(id)
          setDone(true)
        }
      }, speed)
      return () => clearInterval(id)
    }, delay)
    return () => clearTimeout(start)
  }, [text, speed, delay])

  return (
    <span className={cn("font-['Chunk']", className)}>
      {displayed}
      {!done && showCursor && (
        <span className="inline-block w-1 h-8 ml-1 bg-blue-500 animate-pulse" />
      )}
    </span>
  )
}
