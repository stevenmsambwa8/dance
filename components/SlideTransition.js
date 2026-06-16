'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * SlideTransition — native-app-style page slides, zero dependencies.
 *
 * KEY FIX: transform is set to `none` (not translateX(0%)) during idle phase.
 * Any CSS transform — even translateX(0%) — creates a new stacking context
 * that breaks position:fixed children (modals, popups, bottom sheets).
 * By removing the transform entirely when idle, fixed elements work normally.
 */

function getDepth(path) {
  return path.split('/').filter(Boolean).length
}

export default function SlideTransition({ children }) {
  const pathname  = usePathname()
  const prevPath  = useRef(pathname)
  const frameRef  = useRef(null)

  // phase: 'idle' | 'offscreen' | 'enter'
  const [phase,     setPhase]     = useState('idle')
  const [direction, setDirection] = useState(1)
  const [displayed, setDisplayed] = useState(children)

  useEffect(() => {
    if (pathname === prevPath.current) return

    const prev = prevPath.current
    const dir  = getDepth(pathname) >= getDepth(prev) ? 1 : -1
    prevPath.current = pathname

    if (frameRef.current) cancelAnimationFrame(frameRef.current)

    setDirection(dir)
    setDisplayed(children)
    setPhase('offscreen')

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

  // Keep content in sync while idle (same-route re-renders)
  useEffect(() => {
    if (phase === 'idle') setDisplayed(children)
  }, [children, phase])

  // ── CRITICAL: use transform:none when idle, NOT translateX(0%) ──
  // translateX(0%) still creates a stacking context and breaks position:fixed
  const transform =
    phase === 'offscreen' ? `translateX(${direction * 100}%)`
    : phase === 'enter'   ? 'translateX(0%)'
    : 'none'                                          // ← idle: no transform at all

  const transition =
    phase === 'enter' ? 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)' : 'none'

  return (
    <div
      style={{ transform, transition, minHeight: '100%' }}
      onTransitionEnd={() => setPhase('idle')}
    >
      {displayed}
    </div>
  )
}
