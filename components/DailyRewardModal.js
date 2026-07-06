'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import styles from './DailyRewardModal.module.css'

// Animates 0 → target over `duration` ms using requestAnimationFrame.
// target === null means "not counting" (renders 0, but caller shouldn't show it).
function useCountUp(target, duration = 700) {
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
 * 7-day login streak modal. Auto-opens once per mount when today's reward
 * hasn't been claimed yet.
 *
 * Renders no trigger of its own — the caller supplies one via
 * `renderTrigger({ onClick, claimedToday })` (Nav.js uses this to show a
 * gift icon styled to match its other header buttons). Homepage-only
 * gating happens in NavWrapper.js (passed down as Nav's `showDailyReward`
 * prop, which controls whether Nav mounts this component at all) — don't
 * re-add path checks in here, that gate already lives one level up.
 *
 * Missing a day resets the streak to Day 1 on next claim — there is
 * deliberately no "claim a skipped day" path here, don't add one.
 */
export default function DailyRewardModal({ renderTrigger }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [autoPromptDone, setAutoPromptDone] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [justClaimed, setJustClaimed] = useState(null)
  const countedReward = useCountUp(justClaimed?.reward ?? null, 700)

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

  // Auto-open once per mount if today's reward is still unclaimed.
  useEffect(() => {
    if (!loading && status && !status.claimedToday && !autoPromptDone) {
      setOpen(true)
      setAutoPromptDone(true)
    }
  }, [loading, status, autoPromptDone])

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [open])

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

  if (loading || !status) return null

  const { tiers, currentDay, claimedToday, nextDay, nextReward } = status

  return (
    <>
      {renderTrigger && renderTrigger({ onClick: () => setOpen(true), claimedToday })}

      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <button className={styles.closeBtn} onClick={() => setOpen(false)}>
              <i className="ri-close-line" />
            </button>

            <div className={styles.glow}>
              <div className={styles.glowTrack}>
                <div className={styles.glowSeg} />
                <div className={styles.glowSeg} />
              </div>
            </div>

            <div className={styles.header}>
              <div className={styles.giftIcon}><i className="ri-gift-2-fill" /></div>
              <h3 className={styles.title}>Daily Login Rewards</h3>
              <p className={styles.subtitle}>Log in 7 days in a row for the big bonus 🔥</p>
            </div>

            <div className={styles.days}>
              {tiers.map((pts, i) => {
                const day = i + 1
                const isDone   = claimedToday ? day <= currentDay : day < nextDay
                const isTarget = !claimedToday && day === nextDay
                const isFinal  = day === 7
                return (
                  <div
                    key={day}
                    className={[
                      styles.dayPip,
                      isDone ? styles.dayDone : '',
                      isTarget ? styles.dayTarget : '',
                      isFinal ? styles.dayFinal : '',
                    ].join(' ')}
                  >
                    {isDone && <i className={`ri-check-line ${styles.dayCheck}`} />}
                    <span className={styles.dayNum}>{day}</span>
                    <span className={styles.dayPts}>{isFinal ? '🔥' : ''}+{pts}</span>
                  </div>
                )
              })}
            </div>

            {justClaimed ? (
              <div className={styles.claimedMsg}>
                <i className="ri-checkbox-circle-fill" />
                <span>+{countedReward} points — Day {justClaimed.day}/7</span>
                {justClaimed.streakBroken && <span className={styles.brokenNote}>Streak restarted</span>}
              </div>
            ) : (
              <button
                className={styles.claimBtn}
                disabled={claimedToday || claiming}
                onClick={handleClaim}
              >
                {claiming ? 'Claiming…' : claimedToday ? 'Come back tomorrow' : `Claim Day ${nextDay} · +${nextReward} pts`}
              </button>
            )}

            <p className={styles.footNote}>Earn as you go · Provided by Atollmark T & C Applied</p>
          </div>
        </div>
      )}
    </>
  )
}
