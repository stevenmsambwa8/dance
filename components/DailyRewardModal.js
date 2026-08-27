'use client'

import { useEffect } from 'react'
import { useCountUp } from '../lib/useDailyReward'
import styles from './DailyRewardModal.module.css'

/**
 * Full detail view of the daily login streak. Purely presentational —
 * all data/claim logic (status, claiming, justClaimed, handleClaim) is
 * passed down from the single useDailyReward() instance in Nav, so this
 * never fetches on its own and always agrees with the popup/badge.
 *
 * Opened from: the popup's body tap (DailyRewardPopup), or the gift icon
 * in Nav directly. Closes on backdrop click, the X, or Escape.
 */
export default function DailyRewardModal({ open, onClose, status, claiming, justClaimed, handleClaim }) {
  const countedReward = useCountUp(justClaimed?.reward ?? null, 700)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open || !status) return null

  const { tiers, currentDay, claimedToday, nextDay, nextReward } = status

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>
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
  )
}
