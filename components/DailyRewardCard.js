'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import styles from './DailyRewardCard.module.css'

/**
 * 7-day login streak tracker. Drop <DailyRewardCard /> anywhere a logged-in
 * user will see it (top of homepage works well). Renders nothing for
 * logged-out users.
 *
 * Missing a day is NOT recoverable — the API resets the streak to day 1 on
 * the next claim rather than letting you pick up a skipped day later, so
 * don't add a "claim yesterday" path here even if asked; that would fight
 * the whole point of a login streak.
 */
export default function DailyRewardCard() {
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

  if (loading || !status) return null

  const { tiers, currentDay, claimedToday, nextDay, nextReward } = status

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.title}><i className="ri-gift-line" /> Daily Login Rewards</span>
        {claimedToday && <span className={styles.claimedPill}>Claimed today ✓</span>}
      </div>

      <div className={styles.days}>
        {tiers.map((pts, i) => {
          const day = i + 1
          const isDone   = claimedToday ? day <= currentDay : day < nextDay
          const isTarget = !claimedToday && day === nextDay
          return (
            <div
              key={day}
              className={`${styles.dayPip} ${isDone ? styles.dayDone : ''} ${isTarget ? styles.dayTarget : ''}`}
            >
              <span className={styles.dayNum}>Day {day}</span>
              <span className={styles.dayPts}>{day === 7 ? '🔥' : ''}+{pts}</span>
              {isDone && <i className={`ri-check-line ${styles.dayCheck}`} />}
            </div>
          )
        })}
      </div>

      {justClaimed ? (
        <div className={styles.claimedMsg}>
          <i className="ri-checkbox-circle-fill" /> +{justClaimed.reward} points — Day {justClaimed.day}/7
          {justClaimed.streakBroken && <span className={styles.brokenNote}> (streak restarted)</span>}
        </div>
      ) : (
        <button
          className={styles.claimBtn}
          disabled={claimedToday || claiming}
          onClick={handleClaim}
        >
          {claiming ? 'Claiming…' : claimedToday ? 'Come back tomorrow' : `Claim Day ${nextDay} — +${nextReward} pts`}
        </button>
      )}

      <p className={styles.warning}>Miss a day and your streak resets to Day 1 — skipped days can't be claimed later.</p>
    </div>
  )
}
