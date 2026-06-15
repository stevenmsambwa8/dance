'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * SlideTransition — native-app-style page slides, zero dependencies.
 * Wraps children in a div that slides in from the right on forward
 * navigation and from the left on back navigation.
 *
 * Direction is inferred by comparing path depth:
 *   deeper path  → slide in from right (forward)
 *   shallower    → slide in from left  (back)
 *   same depth   → slide in from right (lateral)
 */

function getDepth(path) {
  return path.split('/').filter(Boolean).length
}

export default function SlideTransition({ children }) {
  const pathname    = usePathname()
  const prevPath    = useRef(pathname)
  const [phase, setPhase]       = useState('idle')   // idle | enter
  const [direction, setDirection] = useState(1)       // 1 = from right, -1 = from left
  const [displayed, setDisplayed] = useState(children)
  const frameRef    = useRef(null)

  useEffect(() => {
    if (pathname === prevPath.current) return

    const prev = prevPath.current
    const dir  = getDepth(pathname) >= getDepth(prev) ? 1 : -1
    prevPath.current = pathname

    // Cancel any in-flight animation
    if (frameRef.current) cancelAnimationFrame(frameRef.current)

    setDirection(dir)
    setDisplayed(children)     // swap content immediately (hidden offscreen)
    setPhase('offscreen')      // position offscreen first frame

    // Next frame: trigger slide-in
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = requestAnimationFrame(() => {
        setPhase('enter')
      })
    })

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Keep displayed in sync when content updates on same route
  useEffect(() => {
    if (phase === 'idle') setDisplayed(children)
  }, [children, phase])

  const translateX =
    phase === 'offscreen' ? `${direction * 100}%`
    : phase === 'enter'   ? '0%'
    : '0%'

  return (
    <div
      style={{
        transform:  `translateX(${translateX})`,
        transition: phase === 'enter'
          ? 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)'
          : 'none',
        willChange: 'transform',
        minHeight:  '100%',
      }}
      onTransitionEnd={() => setPhase('idle')}
    >
      {displayed}
    </div>
  )
}
