'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import DailyRewardModal from '../../components/DailyRewardModal'
import { useDailyReward } from '../../lib/useDailyReward'
import useTranslation from '../../lib/useTranslation'
import styles from './page.module.css'

/**
 * Static changelog. Add a new entry to the top of PATCHES whenever a
 * feature ships — no data fetching, this is hand-written release copy
 * pulled through t() so it follows the language toggle.
 *
 * cta.action === 'daily-reward-modal' opens DailyRewardModal in place
 * (same pattern as the gift icon in Nav) instead of navigating to /rewards.
 */
function buildPatches(t) {
  return [
    {
      id: 'cpm2',
      date: t('patches.cpm2Date'),
      tag: t('patches.tagNewGame'),
      tagIcon: 'ri-gamepad-line',
      title: t('patches.cpm2Title'),
      body: t('patches.cpm2Body'),
      bullets: [t('patches.cpm2Bullet1'), t('patches.cpm2Bullet2'), t('patches.cpm2Bullet3')],
      cta: { href: '/games/cpm2', label: t('patches.cpm2Cta') },
    },
    {
      id: 'clans',
      date: t('patches.clansDate'),
      tag: t('patches.tagFeature'),
      tagIcon: 'ri-shield-star-line',
      title: t('patches.clansTitle'),
      body: t('patches.clansBody'),
      bullets: [t('patches.clansBullet1'), t('patches.clansBullet2'), t('patches.clansBullet3')],
      cta: { href: '/clans', label: t('patches.clansCta') },
    },
    {
      id: 'daily-rewards',
      date: t('patches.dailyDate'),
      tag: t('patches.tagFeature'),
      tagIcon: 'ri-gift-line',
      title: t('patches.dailyTitle'),
      body: t('patches.dailyBody'),
      bullets: [t('patches.dailyBullet1'), t('patches.dailyBullet2')],
      cta: { action: 'daily-reward-modal', label: t('patches.dailyCta') },
    },
  ]
}

export default function PatchesPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { openAuthGate } = useAuthGate()
  const dailyReward = useDailyReward()
  const [rewardModalOpen, setRewardModalOpen] = useState(false)

  const patches = buildPatches(t)

  function handleCta(cta, e) {
    if (cta.action === 'daily-reward-modal') {
      e.preventDefault()
      if (!user) { openAuthGate(); return }
      setRewardModalOpen(true)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>{t('patches.eyebrow')}</p>
        <h1 className={styles.headline}>{t('patches.title')}</h1>
        <p className={styles.sub}>{t('patches.sub')}</p>
      </div>

      <div className={styles.timeline}>
        {patches.map((p, i) => (
          <div key={p.id} className={styles.entry}>
            <div className={styles.rail}>
              <div className={styles.dot}>
                {i === 0 && <span className={styles.dotPulse} />}
              </div>
              {i < patches.length - 1 && <div className={styles.line} />}
            </div>

            <div className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.tagChip}><i className={p.tagIcon} />{p.tag}</span>
                <span className={styles.date}>{p.date}</span>
              </div>
              <h2 className={styles.title}>{p.title}</h2>
              <p className={styles.body}>{p.body}</p>
              {p.bullets && (
                <ul className={styles.bullets}>
                  {p.bullets.map((b, bi) => <li key={bi}>{b}</li>)}
                </ul>
              )}
              {p.cta && (
                p.cta.action ? (
                  <button className={styles.cta} onClick={(e) => handleCta(p.cta, e)}>
                    {p.cta.label}
                    <i className="ri-arrow-right-line" />
                  </button>
                ) : (
                  <Link href={p.cta.href} className={styles.cta}>
                    {p.cta.label}
                    <i className="ri-arrow-right-line" />
                  </Link>
                )
              )}
            </div>
          </div>
        ))}
      </div>

      <DailyRewardModal
        open={rewardModalOpen}
        onClose={() => setRewardModalOpen(false)}
        status={dailyReward.status}
        claiming={dailyReward.claiming}
        justClaimed={dailyReward.justClaimed}
        handleClaim={dailyReward.handleClaim}
      />
    </div>
  )
}
