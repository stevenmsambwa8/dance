'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useLoadingContext } from './LoadingContext'


export default function PageTransition({ children }) {
  const pathname                 = usePathname()
  const { loading: pageLoading } = useLoadingContext()
  const [visible, setVisible]    = useState(false)
  const [opacity, setOpacity]    = useState(0)
  const prevPath   = useRef(pathname)
  const hardCap    = useRef(null)
  const fadeOut    = useRef(null)

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

  return (
    <>
      {visible && (
        <div
          className="page-loader-overlay"
          style={{
            opacity,
            transition: 'opacity 0.25s ease',
            pointerEvents: opacity > 0 ? 'all' : 'none',
          }}
        >
          <div className="loader" />
        </div>
      )}
      {children}
    </>
  )
}
