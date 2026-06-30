'use client'
import { useState, useEffect, useRef } from 'react'

// Measures whether `text` overflows its container; if so, applies a
// pause → scroll-left → pause → scroll-back animation so the full text
// is readable. If it fits, it just renders statically.
//
// Consumer must supply CSS classes that define the animation itself —
// this component only measures and sets --marquee-distance / duration.
// Expected CSS shape (per consumer):
//   .wrapClass { overflow: hidden; display: block; min-width: 0; }
//   .textClass { display: inline-block; white-space: nowrap;
//                animation-name: someMarquee; animation-timing-function: ease-in-out;
//                animation-iteration-count: infinite; }
//   @keyframes someMarquee {
//     0%, 15%   { transform: translateX(0); }
//     45%, 55%  { transform: translateX(var(--marquee-distance, 0px)); }
//     85%, 100% { transform: translateX(0); }
//   }
export default function MarqueeText({ text, wrapClassName, textClassName }) {
  const wrapRef = useRef(null)
  const textRef = useRef(null)
  const [distance, setDistance] = useState(0)
  const [duration, setDuration] = useState(7)

  useEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current
      const inner = textRef.current
      if (!wrap || !inner) return
      const overflow = inner.scrollWidth - wrap.clientWidth
      if (overflow > 2) {
        setDistance(overflow)
        setDuration(Math.max(7, overflow / 7))
      } else {
        setDistance(0)
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [text])

  return (
    <span className={wrapClassName} ref={wrapRef}>
      <span
        ref={textRef}
        className={textClassName}
        style={distance > 0 ? {
          '--marquee-distance': `-${distance}px`,
          animationDuration: `${duration}s`,
        } : undefined}
      >{text}</span>
    </span>
  )
}
