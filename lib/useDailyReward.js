'use client'

import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Animates 0 → target over `duration` ms using requestAnimationFrame.
// target === null means "not counting" (renders 0, but caller shouldn't show it).
export function useCountUp(target, duration = 700) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (target == null) { setVal(0); return }
    setVal(0)
    let startTs = null
    let raf
    function step(ts) {
      if (startTs === null) startTs = ts
      const progress = Math.min((ts - startTs) / duration, 1)
      setVal(Math.floor(progress * target))
      if (progress < 1) raf = requestAnimationFrame(step)
      else setVal(target)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return val
}

/**
 * Shared 7-day login streak data + claim logic. Used by both the auto-popup
 * notification (DailyRewardPopup) and the full /rewards page so they never
 * drift out of sync — status shape, claim flow, and count-up all live here
 * once instead of being duplicated per-surface.
 *
 * Missing a day resets the streak to Day 1 on next claim — there is
 * deliberately no "claim a skipped day" path here, don't add one.
 */
export function useDailyReward() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState(false)
  const [justClaimed, setJustClaimed] = useState(null)

  async function loadStatus() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setLoading(false); return }
    try {
      const res = await fetch('/api/daily-reward', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json()
      if (res.ok) setStatus(json)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadStatus() }, [])

  async function handleClaim() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    setClaiming(true)
    try {
      const res = await fetch('/api/daily-reward', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json()
      if (res.ok && json.success) {
        setJustClaimed(json)
        await loadStatus()
      }
    } finally {
      setClaiming(false)
    }
  }

  return { status, loading, claiming, justClaimed, handleClaim, loadStatus }
}
