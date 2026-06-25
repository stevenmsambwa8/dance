'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, createContext, useContext } from 'react'
import { useLoadingContext } from './LoadingContext'

/**
 * PageTransition — loading overlay shown between navigations.
 *
 * REWRITE NOTES (fixes "bottom nav disappears" bug):
 * The previous version patched window.history.pushState/replaceState to
 * show the overlay, then hid it from two independent, uncoordinated paths.
 * Pages that never call usePageLoading() relied entirely on a 50ms fallback
 * timer, which could leave the overlay stuck visible over the fixed nav.
 *
 * REWRITE NOTES PART 2 (fixes "loader starts bottom-center, snaps to
 * center" bug):
 * The overlay used to render *inside* <SlideTransition>'s transformed div
 * (in layout.js: SlideTransition > PageTransition > main). Even though the
 * overlay is `position: fixed`, while SlideTransition's wrapper has an
 * active `transform` (during the ~280ms slide animation) that wrapper
 * becomes the overlay's containing block instead of the real viewport —
 * so the overlay rendered offset by however far the slide had moved, then
 * visually "snapped" to true center once the transform cleared back to
 * `none`. The fix: the overlay is now rendered by <PageLoaderOverlay>,
 * which must be placed as a SIBLING of <SlideTransition> in layout.js
 * (same level as NavWrapper) — never as its descendant — so it is always
 * fixed to the actual viewport no matter what transform is happening below
 * it. PageTransition itself keeps the pathname/loading logic and now only
 * wraps <main> for backwards compatibility — it renders no overlay itself.
 */

const PageLoaderContext = createContext({ visible: false, opacity: 0 })

function usePageLoaderState() {
  const pathname                 = usePathname()
  const { loading: pageLoading } = useLoadingContext()
  const [visible, setVisible]    = useState(false)
  const [opacity, setOpacity]    = useState(0)
  const prevPath = useRef(pathname)
  const hardCap  = useRef(null)
  const fadeOut  = useRef(null)

  function show() {
    clearTimeout(fadeOut.current)
    clearTimeout(hardCap.current)
    setVisible(true)
    setOpacity(1)
    // Absolute ceiling — overlay is force-hidden after this no matter what.
    hardCap.current = setTimeout(hide, 2000)
  }

  function hide() {
    clearTimeout(hardCap.current)
    setOpacity(0)
    fadeOut.current = setTimeout(() => setVisible(false), 250)
  }

  // Show the instant the route actually changes.
  useEffect(() => {
    if (pathname === prevPath.current) return
    prevPath.current = pathname
    show()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Hide once the new page reports it's done loading (or never started).
  useEffect(() => {
    if (!pageLoading && visible) hide()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageLoading, pathname])

  useEffect(() => () => {
    clearTimeout(hardCap.current)
    clearTimeout(fadeOut.current)
  }, [])

  return { visible, opacity }
}

/**
 * Renders the actual fixed overlay + backdrop box + spinner.
 * MUST be placed OUTSIDE/SIBLING of <SlideTransition> in layout.js so it's
 * never a descendant of any transformed element.
 */
export function PageLoaderOverlay() {
  const { visible, opacity } = usePageLoaderState()

  if (!visible) return null

  return (
    <div
      className="page-loader-overlay"
      style={{
        opacity,
        transition: 'opacity 0.25s ease',
        pointerEvents: opacity > 0 ? 'all' : 'none',
      }}
    >
      <div className="loader-box">
        <div className="loader" />
      </div>
    </div>
  )
}

// Kept as a plain pass-through wrapper around <main> for backwards
// compatibility with layout.js's existing structure — it no longer renders
// the overlay itself (see PageLoaderOverlay above).
export default function PageTransition({ children }) {
  return <>{children}</>
}
