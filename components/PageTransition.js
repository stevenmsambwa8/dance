'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLoadingContext } from './LoadingContext'

export default function PageTransition({ children }) {
  const pathname               = usePathname()
  const { loading: pageLoading } = useLoadingContext()
  const prevPath               = useRef(pathname)
  const [overlayOpacity, setOverlayOpacity] = useState(0)
  const fallbackTimer = useRef(null)
  const fadeOutTimer  = useRef(null)

  function show() {
    clearTimeout(fadeOutTimer.current)
    clearTimeout(fallbackTimer.current)
    setOverlayOpacity(1)
  }

  function hide() {
    clearTimeout(fallbackTimer.current)
    // Small delay so content is painted before we fade the overlay away
    fadeOutTimer.current = setTimeout(() => setOverlayOpacity(0), 80)
  }

  // useLayoutEffect fires synchronously BEFORE the browser paints.
  // This means the overlay is already opaque before the new page is visible.
  useLayoutEffect(() => {
    if (prevPath.current === pathname) return
    prevPath.current = pathname
    show()
    // Hard fallback: never stay stuck longer than 2s
    fallbackTimer.current = setTimeout(hide, 2000)
  }, [pathname])

  // Page signals it finished loading
  useEffect(() => {
    if (!pageLoading) hide()
  }, [pageLoading])

  useEffect(() => () => {
    clearTimeout(fallbackTimer.current)
    clearTimeout(fadeOutTimer.current)
  }, [])

  return (
    <>
      {/* Overlay is always in the DOM — no mount/unmount flicker */}
      <div
        className="page-loader-overlay"
        style={{
          opacity: overlayOpacity,
          transition: overlayOpacity === 1
            ? 'none'               // appear instantly
            : 'opacity 0.25s ease', // fade out smoothly
          pointerEvents: overlayOpacity > 0 ? 'all' : 'none',
        }}
      >
        <div className="loader" />
      </div>
      {children}
    </>
  )
}
