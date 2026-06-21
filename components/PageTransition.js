'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLoadingContext } from './LoadingContext'

export default function PageTransition({ children }) {
  const pathname               = usePathname()
  const { loading: pageLoading } = useLoadingContext()
  const [overlayOpacity, setOverlayOpacity] = useState(0)
  const fallbackTimer = useRef(null)
  const fadeOutTimer  = useRef(null)
  const opacityRef    = useRef(0)

  function show() {
    clearTimeout(fadeOutTimer.current)
    clearTimeout(fallbackTimer.current)
    opacityRef.current = 1
    setOverlayOpacity(1)
    fallbackTimer.current = setTimeout(hide, 2500)
  }

  function hide() {
    clearTimeout(fallbackTimer.current)
    fadeOutTimer.current = setTimeout(() => {
      opacityRef.current = 0
      setOverlayOpacity(0)
    }, 80)
  }

  // ── Intercept history.pushState / replaceState ────────────────────────────
  // Next.js calls window.history.pushState BEFORE it renders new children.
  // By patching it here we show the overlay at the earliest possible moment —
  // before any React rendering of the new page happens.
  useEffect(() => {
    const originalPush    = window.history.pushState.bind(window.history)
    const originalReplace = window.history.replaceState.bind(window.history)

    function onNavigate() {
      // Only show if not already visible
      if (opacityRef.current < 1) show()
    }

    window.history.pushState = function (...args) {
      onNavigate()
      return originalPush(...args)
    }

    window.history.replaceState = function (...args) {
      // replaceState fires on scroll restoration etc — only trigger for real
      // route changes (when the URL actually changes)
      const newUrl = args[2]
      if (newUrl && newUrl !== window.location.pathname + window.location.search) {
        onNavigate()
      }
      return originalReplace(...args)
    }

    // Browser back/forward
    window.addEventListener('popstate', onNavigate)

    return () => {
      window.history.pushState    = originalPush
      window.history.replaceState = originalReplace
      window.removeEventListener('popstate', onNavigate)
    }
  }, [])

  // ── Hide when new page's data finishes loading ────────────────────────────
  useEffect(() => {
    if (!pageLoading) hide()
  }, [pageLoading])

  // ── Fallback: also hide when pathname settles (catches pages with no data) ─
  useLayoutEffect(() => {
    // If a page doesn't call usePageLoading at all, hide after pathname commits
    // Give it a tiny grace period for usePageLoading to initialise first
    const t = setTimeout(() => {
      if (!pageLoading) hide()
    }, 50)
    return () => clearTimeout(t)
  }, [pathname])

  useEffect(() => () => {
    clearTimeout(fallbackTimer.current)
    clearTimeout(fadeOutTimer.current)
  }, [])

  return (
    <>
      <div
        className="page-loader-overlay"
        style={{
          opacity:       overlayOpacity,
          transition:    overlayOpacity === 1
            ? 'none'
            : 'opacity 0.25s ease',
          pointerEvents: overlayOpacity > 0 ? 'all' : 'none',
        }}
      >
        <div className="splash-box">
          <img src="/logo.png"       alt="NaboGaming" className="splash-logo-light" />
          <img src="/logo-black.png" alt="NaboGaming" className="splash-logo-dark" />
        </div>
      </div>
      {children}
    </>
  )
}
