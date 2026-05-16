'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useLoadingContext } from './LoadingContext'

export default function PageTransition({ children }) {
  const pathname                   = usePathname()
  const { loading: pageLoading }   = useLoadingContext()
  const prevPath                   = useRef(pathname)
  const [visible, setVisible]      = useState(false)
  const hideTimer                  = useRef(null)
  const fallbackTimer              = useRef(null)

  function show() {
    clearTimeout(hideTimer.current)
    clearTimeout(fallbackTimer.current)
    setVisible(true)
    // Hard fallback — never stuck longer than 2.5s
    fallbackTimer.current = setTimeout(hide, 2500)
  }

  function hide() {
    clearTimeout(fallbackTimer.current)
    hideTimer.current = setTimeout(() => setVisible(false), 120)
  }

  // Show on route change
  useEffect(() => {
    if (prevPath.current === pathname) return
    prevPath.current = pathname
    show()
  }, [pathname])

  // Hide when page signals ready
  useEffect(() => {
    if (!pageLoading) hide()
  }, [pageLoading])

  useEffect(() => () => {
    clearTimeout(hideTimer.current)
    clearTimeout(fallbackTimer.current)
  }, [])

  return (
    <>
      {/* Lightweight translucent overlay — page stays fully visible beneath */}
      <div
        className="page-loader-overlay"
        style={{
          opacity:        visible ? 1 : 0,
          pointerEvents:  visible ? 'all' : 'none',
          transition:     visible
            ? 'opacity 0.12s ease'       // fade in fast
            : 'opacity 0.22s ease',      // fade out a bit slower
        }}
      >
        <div className="loader" />
      </div>
      {children}
    </>
  )
}
