'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, createContext } from 'react'
import { useLoadingContext } from './LoadingContext'

/**
 * PageTransition — no slide/animation between pages. Navigation is instant;
 * the only visual cue is the centered loading circle, shown ONLY while the
 * incoming page is actually loading (pages report this via usePageLoading).
 *
 * - Route changes -> overlay appears.
 * - Page reports done (usePageLoading(false)) -> overlay fades out.
 * - Page never reports loading (doesn't use the hook / has nothing to
 *   fetch) -> overlay is dropped after a short grace period instead of
 *   lingering.
 * - Hard ceiling so it can never get stuck over the nav.
 *
 * <PageLoaderOverlay> lives in layout.js next to NavWrapper.
 */

const GRACE_MS = 200      // wait for the new page to declare it's loading
const HARD_CAP_MS = 8000  // absolute safety ceiling
const FADE_MS = 150

const PageLoaderContext = createContext({ visible: false, opacity: 0 })

function usePageLoaderState() {
  const pathname                 = usePathname()
  const { loading: pageLoading } = useLoadingContext()
  const [visible, setVisible]    = useState(false)
  const [opacity, setOpacity]    = useState(0)
  const prevPath   = useRef(pathname)
  const loadingRef = useRef(pageLoading)
  const hardCap    = useRef(null)
  const fadeOut    = useRef(null)
  const grace      = useRef(null)

  function clearAll() {
    clearTimeout(hardCap.current)
    clearTimeout(fadeOut.current)
    clearTimeout(grace.current)
  }

  function show() {
    clearAll()
    setVisible(true)
    setOpacity(1)
    hardCap.current = setTimeout(hide, HARD_CAP_MS)
    // If the new page hasn't flagged itself as loading by now, there's
    // nothing to wait for.
    grace.current = setTimeout(() => {
      if (!loadingRef.current) hide()
    }, GRACE_MS)
  }

  function hide() {
    clearTimeout(hardCap.current)
    clearTimeout(grace.current)
    setOpacity(0)
    fadeOut.current = setTimeout(() => setVisible(false), FADE_MS)
  }

  useEffect(() => { loadingRef.current = pageLoading }, [pageLoading])

  // Show the instant the route actually changes.
  useEffect(() => {
    if (pathname === prevPath.current) return
    prevPath.current = pathname
    show()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Hide once the page reports it's done loading.
  useEffect(() => {
    if (!pageLoading && visible) hide()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageLoading])

  useEffect(() => clearAll, [])

  return { visible, opacity }
}

export function PageLoaderOverlay() {
  const { visible, opacity } = usePageLoaderState()

  if (!visible) return null

  return (
    <div
      className="page-loader-overlay"
      style={{
        opacity,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: opacity > 0 ? 'all' : 'none',
      }}
    >
      <div className="loader-box">
        <div className="loader" />
      </div>
    </div>
  )
}

// Plain pass-through, kept so layout.js structure stays the same.
export default function PageTransition({ children }) {
  return <>{children}</>
}
