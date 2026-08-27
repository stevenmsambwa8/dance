'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './DailyRewardPopup.module.css'

const AUTO_DISMISS_MS = 5000

/**
 * Non-blocking daily-reward notice. Replaces the old forcing modal:
 * this never covers the screen and never traps input. It shows once per
 * mount when today's reward is unclaimed, sits top-of-screen for
 * AUTO_DISMISS_MS, and disappears on its own if untouched.
 *
 * Tapping "Collect Now" (or the popup body) takes the user to /rewards,
 * which is where the actual claim happens — this component never claims
 * anything itself.
 *
 * status/loading are passed in from Nav (which already fetches them for
 * the gift-icon badge) so mounting this doesn't trigger a second
 * /api/daily-reward request.
 */
export default function DailyRewardPopup({ status, loading }) {
  const [visible, setVisible] = useState(false)
  const [shown, setShown] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const timerRef = useRef(null)
  const router = useRouter()

  // Auto-show once per mount if today's reward is still unclaimed.
  useEffect(() => {
    if (!loading && status && !status.claimedToday && !shown) {
      setVisible(true)
      setShown(true)
    }
  }, [loading, status, shown])

  useEffect(() => {
    if (!visible) return
    timerRef.current = setTimeout(() => dismiss(), AUTO_DISMISS_MS)
    return () => clearTimeout(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  function dismiss() {
    clearTimeout(timerRef.current)
    setLeaving(true)
    setTimeout(() => { setVisible(false); setLeaving(false) }, 180)
  }

  function handleCollect() {
    clearTimeout(timerRef.current)
    setVisible(false)
    router.push('/rewards')
  }

  if (!visible || !status) return null

  const { nextDay, nextReward } = status

  return (
    <div className={`${styles.popup} ${leaving ? styles.leaving : ''}`} role="status">
      <div className={styles.icon}><i className="ri-gift-2-fill" /></div>
      <div className={styles.body} onClick={handleCollect}>
        <p className={styles.title}>Daily reward ready</p>
        <p className={styles.subtitle}>Day {nextDay} · +{nextReward} pts</p>
      </div>
      <button className={styles.collectBtn} onClick={handleCollect}>Collect Now</button>
      <button className={styles.dismissBtn} onClick={dismiss} aria-label="Dismiss">
        <i className="ri-close-line" />
      </button>
    </div>
  )
}
