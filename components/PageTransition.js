'use client'
import { usePathname, useRouter } from 'next/navigation'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  createContext,
  useContext,
} from 'react'
import { useLoadingContext } from './LoadingContext'

/**
 * The core problem with useEffect-based preloaders in Next.js App Router:
 *
 *   Link click → children swap → BROWSER PAINTS new page → useEffect fires → overlay shows
 *
 * By the time useEffect runs the user already sees the new page. We need the
 * overlay to show BEFORE the paint. Two techniques combined:
 *
 * 1. useLayoutEffect — fires synchronously after React renders but BEFORE paint.
 *    We use it to detect pathname change and show the overlay in the same frame.
 *
 * 2. Router event interception via a custom <Link> wrapper + NavigationContext.
 *    We expose a `useNavigate` hook that shows the overlay BEFORE calling
 *    router.push(), so the overlay is visible during the fetch that Next.js does
 *    before committing the route change.
 */

/* ─── Navigation context ─────────────────────────────────── */
const NavigationContext = createContext(null)

export function useNavigate() {
  return useContext(NavigationContext)
}

/* ─── Main component ─────────────────────────────────────── */
export default function PageTransition({ children }) {
  const pathname               = usePathname()
  const { loading: pageLoading } = useLoadingContext()
  const prevPath               = useRef(pathname)
  const [visible, setVisible]  = useState(false)
  const hideTimer              = useRef(null)
  const fallbackTimer          = useRef(null)
  const visibleRef             = useRef(false)

  function show() {
    clearTimeout(hideTimer.current)
    clearTimeout(fallbackTimer.current)
    visibleRef.current = true
    setVisible(true)
    fallbackTimer.current = setTimeout(hide, 3000)
  }

  function hide() {
    clearTimeout(fallbackTimer.current)
    // Small delay so new content paints before overlay disappears
    hideTimer.current = setTimeout(() => {
      visibleRef.current = false
      setVisible(false)
    }, 100)
  }

  // ── KEY FIX: useLayoutEffect fires before paint ──────────
  // When pathname changes React has already rendered the new children
  // but the browser hasn't painted yet. Showing the overlay here means
  // it appears in the SAME frame as the new page content — so the user
  // sees overlay + new page simultaneously, not new page then overlay.
  useLayoutEffect(() => {
    if (prevPath.current === pathname) return
    prevPath.current = pathname
    show()
  }, [pathname])

  // Hide when the page's data finishes loading
  useEffect(() => {
    if (!pageLoading) hide()
  }, [pageLoading])

  useEffect(() => () => {
    clearTimeout(hideTimer.current)
    clearTimeout(fallbackTimer.current)
  }, [])

  // ── Intercept navigation calls so overlay shows BEFORE route fetch ──
  // Any component that calls useNavigate() gets a navigate() function
  // that shows the overlay then calls router.push(). This covers the
  // gap between "user taps" and "Next.js commits the route".
  const router = useRouter()

  const navigate = useCallback((href, options) => {
    if (!visibleRef.current) show()
    router.push(href, options)
  }, [router])

  return (
    <NavigationContext.Provider value={navigate}>
      {/* Overlay — always in DOM, toggled via opacity only (no mount flicker) */}
      <div
        className="page-loader-overlay"
        style={{
          opacity:       visible ? 1 : 0,
          pointerEvents: visible ? 'all' : 'none',
          transition:    visible
            ? 'opacity 0.08s ease'   // appear fast
            : 'opacity 0.20s ease',  // disappear slightly slower
        }}
      >
        <div className="loader" />
      </div>
      {children}
    </NavigationContext.Provider>
  )
}
