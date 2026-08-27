'use client'

import { useEffect, useRef, useState } from 'react'
import { useCountUp } from '../lib/useDailyReward'
import styles from './DailyRewardPopup.module.css'

const AUTO_DISMISS_MS = 5000
const CLAIMED_DISMISS_MS = 2200

/**
 * Non-blocking daily-reward notice. Shows once per mount when today's
 * reward is unclaimed, sits top-of-screen for AUTO_DISMISS_MS, and
 * disappears on its own if untouched.
 *
 * Tapping anywhere on the popup EXCEPT "Collect Now" opens the full
 * DailyRewardModal (the 7-day grid). "Collect Now" itself claims the
 * reward right there, in place — no modal, no navigation — and the
 * popup swaps to a short success message before it dismisses.
 *
 * status/loading/claiming/justClaimed/handleClaim all come from the
 * single useDailyReward() instance in Nav, so this never fetches on
 * its own and always agrees with the modal/badge.
 */
export default function DailyRewardPopup({ status, loading, claiming, justClaimed, handleClaim, onOpenModal }) {
  const [visible, setVisible] = useState(false)
  const [shown, setShown] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const timerRef = useRef(null)
  const countedReward = useCountUp(justClaimed?.reward ?? null, 500)

  // Auto-show once per mount if today's reward is still unclaimed.
  useEffect(() => {
    if (!loading && status && !status.claimedToday && !shown) {
      setVisible(true)
      setShown(true)
    }
  }, [loading, status, shown])

  // Reset the dismiss timer whenever visibility changes, and shorten it
  // once a claim just landed (no need to linger once the job's done).
  useEffect(() => {
    if (!visible) return
    const ms = justClaimed ? CLAIMED_DISMISS_MS : AUTO_DISMISS_MS
    timerRef.current = setTimeout(() => dismiss(), ms)
    return () => clearTimeout(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, justClaimed])

  function dismiss() {
    clearTimeout(timerRef.current)
    setLeaving(true)
    setTimeout(() => { setVisible(false); setLeaving(false) }, 180)
  }

  function handleOpenModal() {
    dismiss()
    onOpenModal?.()
  }

  function handleCollectClick(e) {
    e.stopPropagation()
    if (claiming || justClaimed) return
    handleClaim()
  }

  function handleDismissClick(e) {
    e.stopPropagation()
    dismiss()
  }

  if (!visible || !status) return null

  const { nextDay, nextReward } = status

  return (
    <div
      className={`${styles.popup} ${leaving ? styles.leaving : ''}`}
      role="status"
      onClick={handleOpenModal}
    >
      <div className={styles.icon}><i className="ri-gift-2-fill" /></div>

      {justClaimed ? (
        <div className={styles.body}>
          <p className={styles.title}>+{countedReward} pts collected</p>
          <p className={styles.subtitle}>
            Day {justClaimed.day}/7{justClaimed.streakBroken ? ' · Streak restarted' : ''}
          </p>
        </div>
      ) : (
        <>
          <div className={styles.body}>
            <p className={styles.title}>Daily reward ready</p>
            <p className={styles.subtitle}>Day {nextDay} · +{nextReward} pts</p>
          </div>
          <button className={styles.collectBtn} onClick={handleCollectClick} disabled={claiming}>
            {claiming ? 'Collecting…' : 'Collect Now'}
          </button>
        </>
      )}

      <button className={styles.dismissBtn} onClick={handleDismissClick} aria-label="Dismiss">
        <i className="ri-close-line" />
      </button>
    </div>
  )
}
