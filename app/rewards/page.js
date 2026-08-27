'use client'

import { useRouter } from 'next/navigation'
import { useDailyReward, useCountUp } from '../../lib/useDailyReward'
import usePageLoading from '../../components/usePageLoading'
import styles from './page.module.css'

/**
 * Full-page version of the old DailyRewardModal. Reached from the
 * DailyRewardPopup's "Collect Now" button (or the gift icon in Nav) —
 * everything the modal showed (glow, day pips, claim button, footnote)
 * lives here intact, just as a page instead of something forced over
 * whatever the user was doing.
 */
export default function RewardsPage() {
  const router = useRouter()
  const { status, loading, claiming, justClaimed, handleClaim } = useDailyReward()
  usePageLoading(loading)
  const countedReward = useCountUp(justClaimed?.reward ?? null, 700)

  if (loading) return <div className={styles.page} />

  if (!status) {
    return (
      <div className={styles.page}>
        <button className={styles.backBtn} onClick={() => router.back()}>
          <i className="ri-arrow-left-line" />
        </button>
        <p className={styles.signedOutNote}>Sign in to see your daily reward.</p>
      </div>
    )
  }

  const { tiers, currentDay, claimedToday, nextDay, nextReward } = status

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <button className={styles.closeBtn} onClick={() => router.back()}>
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
          <h1 className={styles.title}>Daily Login Rewards</h1>
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

        <p className={styles.footNote}>Earn as you go · Provided by Atollmark T &amp; C Applied</p>
      </div>
    </div>
  )
}
