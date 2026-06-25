'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * SlideTransition — native-app-style page slides, zero dependencies.
 *
 * KEY FIX #1: transform is set to `none` (not translateX(0%)) during idle phase.
 * Any CSS transform — even translateX(0%) — creates a new stacking context
 * that breaks position:fixed children (modals, popups, bottom sheets).
 * By removing the transform entirely when idle, fixed elements work normally.
 *
 * KEY FIX #2 (bottom-nav-disappears + horizontal-scrollbar bug):
 * This wrapper div sits between <body> and <main>. body/main both have
 * overflow-x:hidden, but THIS div didn't — so during the offscreen/enter
 * phases, translateX(100%) produced a real layout box extending a full
 * viewport-width past the right edge. On mobile Chrome/Safari, once an
 * element's geometry exceeds its overflow-x:hidden ancestor like that, the
 * ancestor can briefly re-establish itself as the containing block for
 * position:fixed descendants instead of the viewport — which is exactly
 * when the fixed BottomNav would shift/vanish, and exactly why a horizontal
 * scrollbar track appeared. Containing the overflow HERE, at the source,
 * stops it from ever reaching body.
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

    // Safety net: onTransitionEnd can be missed entirely if the tab is
    // backgrounded mid-animation, the user navigates again very fast, or
    // the browser drops the transitionend event under load. Without this,
    // `phase` would stay stuck on 'enter' with a transform still applied
    // forever.
    const safety = setTimeout(() => setPhase('idle'), 400)

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      clearTimeout(safety)
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
    // Outer div: fixed to the real viewport width and clips its own overflow.
    // This is what stops the translated child from ever affecting body's
    // layout width / triggering the fixed-positioning bug described above.
    <div style={{ width: '100%', overflowX: 'hidden', position: 'relative' }}>
      <div
        style={{ transform, transition, minHeight: '100%', width: '100%' }}
        onTransitionEnd={() => setPhase('idle')}
      >
        {displayed}
      </div>
    </div>
  )
}
