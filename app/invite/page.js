'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import usePageLoading from '../../components/usePageLoading'
import { useCurrency } from '../../lib/useCurrency'
import useTranslation from '../../lib/useTranslation'
import { ensureReferralCode, REFERRAL_BONUS_TZS, WEEKLY_REFERRAL_CAP } from '../../lib/referralBonus'
import styles from './page.module.css'

const STATUS_META = {
  pending:    { key: 'statusPending',   color: '#eab308', icon: 'ri-time-line' },
  processing: { key: 'statusProcessing', color: '#eab308', icon: 'ri-loader-4-line' },
  paid:       { key: 'statusPaid',      color: '#22c55e', icon: 'ri-checkbox-circle-fill' },
  capped:     { key: 'statusCapped',    color: '#94a3b8', icon: 'ri-forbid-line' },
}

export default function InvitePage() {
  const { user, profile } = useAuth()
  const { openAuthGate } = useAuthGate()
  const { fmtAmt } = useCurrency(profile?.country_flag)
  const { t } = useTranslation()
  const [code, setCode]           = useState(null)
  const [referrals, setReferrals] = useState([])
  const [friends, setFriends]     = useState({}) // referred_id -> { username, avatar_url }
  const [loading, setLoading]     = useState(true)
  const [linkFailed, setLinkFailed] = useState(false)
  const [copied, setCopied]       = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  usePageLoading(loading)

  useEffect(() => {
    if (!user || !profile) { setLoading(false); return }
    let cancelled = false

    ;(async () => {
      setLoading(true)
      setLinkFailed(false)
      try {
        const myCode = profile.referral_code || await ensureReferralCode(supabase, user.id, profile.username)
        if (cancelled) return
        if (!myCode) { setLinkFailed(true) } else { setCode(myCode) }

        const { data: refRows } = await supabase
          .from('referrals')
          .select('*')
          .eq('referrer_id', user.id)
          .order('created_at', { ascending: false })
        if (cancelled) return
        const rows = refRows || []
        setReferrals(rows)

        const ids = rows.map(r => r.referred_id)
        if (ids.length) {
          const { data: profiles } = await supabase
            .from('profiles').select('id, username, avatar_url').in('id', ids)
          if (!cancelled && profiles) {
            const map = {}
            profiles.forEach(p => { map[p.id] = p })
            setFriends(map)
          }
        }
      } catch (e) {
        console.error('Invite page load failed:', e)
        if (!cancelled) setLinkFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [user, profile, reloadTick])

  if (!user) {
    return (
      <div className={styles.page}>
        <p className={styles.empty}>{t('invitePage.signInPrompt')}</p>
        <button className={styles.signInBtn} onClick={() => openAuthGate()}>{t('invitePage.signIn')}</button>
      </div>
    )
  }

  const link = code && typeof window !== 'undefined' ? `${window.location.origin}/login?ref=${code}` : ''
  const bonusAmt = fmtAmt(REFERRAL_BONUS_TZS)

  const paidCount    = referrals.filter(r => r.status === 'paid').length
  const pendingCount = referrals.filter(r => r.status === 'pending' || r.status === 'processing').length
  const earnedTZS    = paidCount * REFERRAL_BONUS_TZS
  const weekAgo       = Date.now() - 7 * 24 * 60 * 60 * 1000
  const weeklyPaid    = referrals.filter(r => r.status === 'paid' && new Date(r.paid_at).getTime() >= weekAgo).length

  function copyLink() {
    if (!link) return
    navigator.clipboard?.writeText(link).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function shareLink() {
    if (!link) return
    // Default share message is always Swahili, regardless of app language.
    if (navigator.share) {
      navigator.share({
        title: t('invitePage.shareMessageTitle'),
        text: t('invitePage.shareMessageText'),
        url: link,
      }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(`${t('invitePage.shareMessageText')} ${link}`).catch(() => {})
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.heroBadge}>
          <i className="ri-gift-2-fill" />
          <span>{bonusAmt}</span>
        </div>
        <h1 className={styles.title}>{t('invitePage.title')}</h1>
        <p className={styles.sub}>{t('invitePage.subtitle').replace('{amount}', bonusAmt)}</p>
      </div>

      <div className={styles.linkCard}>
        {linkFailed ? (
          <div className={styles.linkErrorRow}>
            <span className={styles.linkErrorText}><i className="ri-error-warning-line" /> {t('invitePage.linkError')}</span>
            <button className={styles.retryBtn} onClick={() => setReloadTick(n => n + 1)}>
              <i className="ri-refresh-line" /> {t('invitePage.retry')}
            </button>
          </div>
        ) : (
          <>
            <div className={styles.codePill}>
              {code
                ? <span className={styles.codeText}>{code}</span>
                : <span className={styles.codeLoading}><i className="ri-loader-4-line" /> {t('invitePage.generating')}</span>}
            </div>
            <div className={styles.linkActions}>
              <button className={styles.copyBtn} onClick={copyLink} disabled={!link}>
                {copied ? <><i className="ri-check-line" /> {t('invitePage.copied')}</> : <><i className="ri-file-copy-line" /> {t('invitePage.copy')}</>}
              </button>
              <button className={styles.shareBtn} onClick={shareLink} disabled={!link}>
                <i className="ri-share-forward-line" /> {t('invitePage.share')}
              </button>
            </div>
          </>
        )}
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <i className={`ri-group-line ${styles.statIcon}`} />
          <span className={styles.statVal}>{referrals.length}</span>
          <span className={styles.statLabel}>{t('invitePage.invited')}</span>
        </div>
        <div className={styles.statCard}>
          <i className={`ri-time-line ${styles.statIcon}`} style={{ color: '#eab308' }} />
          <span className={styles.statVal} style={{ color: '#eab308' }}>{pendingCount}</span>
          <span className={styles.statLabel}>{t('invitePage.pending')}</span>
        </div>
        <div className={styles.statCard}>
          <i className={`ri-coins-line ${styles.statIcon}`} style={{ color: '#f59e0b' }} />
          <span className={styles.statVal} style={{ color: '#f59e0b' }}>{fmtAmt(earnedTZS)}</span>
          <span className={styles.statLabel}>{t('invitePage.earned')}</span>
        </div>
      </div>

      <div className={styles.capBar}>
        <div className={styles.capBarTrack}>
          <div className={styles.capBarFill} style={{ width: `${Math.min(100, (weeklyPaid / WEEKLY_REFERRAL_CAP) * 100)}%` }} />
        </div>
        <span className={styles.capBarLabel}>
          {t('invitePage.capLabel').replace('{used}', weeklyPaid).replace('{max}', WEEKLY_REFERRAL_CAP)}
        </span>
      </div>

      <div className={styles.list}>
        <h2 className={styles.listTitle}>{t('invitePage.yourInvites')}</h2>
        {referrals.length === 0 ? (
          <p className={styles.empty}>{t('invitePage.noInvitesYet')}</p>
        ) : (
          referrals.map(r => {
            const friend = friends[r.referred_id]
            const meta = STATUS_META[r.status] || STATUS_META.pending
            const label = t(`invitePage.${meta.key}`).replace('{amount}', bonusAmt)
            return (
              <div key={r.id} className={styles.row}>
                <div className={styles.rowAvatar}>
                  {friend?.avatar_url
                    ? <img src={friend.avatar_url} alt="" />
                    : <span>{(friend?.username || '?')[0].toUpperCase()}</span>}
                </div>
                <div className={styles.rowInfo}>
                  <span className={styles.rowName}>@{friend?.username || 'player'}</span>
                </div>
                <span className={styles.statusChip} style={{ color: meta.color, borderColor: meta.color }}>
                  <i className={meta.icon} /> {label}
                </span>
              </div>
            )
          })
        )}
      </div>

      <p className={styles.footNote}>
        <i className="ri-shield-check-line" /> {t('invitePage.footNote').replace('{max}', WEEKLY_REFERRAL_CAP)}
      </p>
    </div>
  )
}
