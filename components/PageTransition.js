'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * Native-feel SPA slide transition.
 * Uses a keyed wrapper that re-animates on every route change.
 * New page slides in from right; background dims leftward — like iOS.
 */
export default function PageTransition({ children }) {
  const pathname  = usePathname()
  const [key, setKey]         = useState(pathname)
  const [animating, setAnimating] = useState(false)
  const prevPath  = useRef(pathname)
  const timerRef  = useRef(null)
  const firstRender = useRef(true)

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    if (pathname === prevPath.current) return
    prevPath.current = pathname

    clearTimeout(timerRef.current)

    // Trigger slide-in animation
    setKey(pathname)
    setAnimating(true)

    // Remove animation class after it completes
    timerRef.current = setTimeout(() => setAnimating(false), 340)
  }, [pathname])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return (
    <div
      key={key}
      className={animating ? 'page-slide-enter' : 'page-slide-idle'}
      style={{ minHeight: '100dvh' }}
    >
      {children}
    </div>
  )
}
