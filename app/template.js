'use client'
import { useLayoutEffect, useRef } from 'react'

/**
 * Prevents the "page paints unstyled, then styles pop in ~1s later" flash.
 *
 * On client navigation the new page's CSS <link> is injected into <head> in
 * the same commit as the page content, but the stylesheet itself finishes
 * downloading later. This watches <head> and, the instant a stylesheet that
 * hasn't loaded yet is added, hides the page content (visibility only, so
 * layout and data fetching continue) until that stylesheet is ready.
 * MutationObserver callbacks run before the browser paints, so the unstyled
 * frame is never shown. A safety timeout guarantees it can never stay hidden.
 */
const MAX_HIDE_MS = 1500

export default function Template({ children }) {
  const ref = useRef(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const waiting = new Set()
    let timer = null

    const release = () => {
      clearTimeout(timer)
      timer = null
      waiting.clear()
      el.style.visibility = ''
    }

    const watch = (link) => {
      if (link.sheet || waiting.has(link)) return
      waiting.add(link)
      el.style.visibility = 'hidden'
      const done = () => {
        link.removeEventListener('load', done)
        link.removeEventListener('error', done)
        waiting.delete(link)
        if (waiting.size === 0) release()
      }
      link.addEventListener('load', done)
      link.addEventListener('error', done)
      if (!timer) timer = setTimeout(release, MAX_HIDE_MS)
    }

    // Stylesheets that are already pending when this page mounts
    document.querySelectorAll('link[rel="stylesheet"]').forEach(watch)

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (n.nodeName === 'LINK' && n.rel === 'stylesheet') watch(n)
        })
      }
    })
    obs.observe(document.head, { childList: true })

    return () => {
      obs.disconnect()
      clearTimeout(timer)
      el.style.visibility = ''
    }
  }, [])

  return (
    <div ref={ref} style={{ display: 'contents' }}>
      {children}
    </div>
  )
}
