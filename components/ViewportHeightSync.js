'use client'
import { useEffect } from 'react'

// Keeps a `--app-vh` custom property pinned to the *live* visual viewport
// height, updated on every resize/scroll tick of window.visualViewport.
//
// Why: `100dvh` only settles once the browser considers the keyboard
// resize "finished" — on Android Chrome in particular that update lands
// noticeably after the keyboard has already animated open, so any layout
// pinned to `100dvh` (and anything flexed against it, like a chat
// composer or a bottom CTA row) visibly lags a beat behind the real
// keyboard. `visualViewport` fires progressively *during* that animation,
// so mirroring it into a CSS var and consuming that instead of `dvh`
// closes most of the gap.
export default function ViewportHeightSync() {
  useEffect(() => {
    const vv = window.visualViewport
    const root = document.documentElement

    let raf = null
    function apply() {
      raf = null
      const h = vv ? vv.height : window.innerHeight
      root.style.setProperty('--app-vh', `${h}px`)
    }
    function onChange() {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(apply)
    }

    apply()
    vv?.addEventListener('resize', onChange)
    vv?.addEventListener('scroll', onChange)
    window.addEventListener('resize', onChange)

    return () => {
      vv?.removeEventListener('resize', onChange)
      vv?.removeEventListener('scroll', onChange)
      window.removeEventListener('resize', onChange)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return null
}
