'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import usePageLoading from '../../components/usePageLoading'
import { useCurrency } from '../../lib/useCurrency'
import { ensureReferralCode, REFERRAL_BONUS_TZS, WEEKLY_REFERRAL_CAP } from '../../lib/referralBonus'
import styles from './page.module.css'

const STATUS_META = {
  pending:    { label: 'Pending phone verification', color: '#eab308', icon: 'ri-time-line' },
  processing: { label: 'Verifying…',                 color: '#eab308', icon: 'ri-loader-4-line' },
  paid:       { label: `+TZS ${REFERRAL_BONUS_TZS} paid`, color: '#22c55e', icon: 'ri-checkbox-circle-fill' },
  capped:     { label: 'Weekly cap reached',          color: '#94a3b8', icon: 'ri-forbid-line' },
}

export default function InvitePage() {
  const { user, profile } = useAuth()
  const { openAuthGate } = useAuthGate()
  const { fmtAmt } = useCurrency(profile?.country_flag)
  const [code, setCode]           = useState(null)
  const [referrals, setReferrals] = useState([])
  const [friends, setFriends]     = useState({}) // referred_id -> { username, avatar_url }
  const [loading, setLoading]     = useState(true)
  const [copied, setCopied]       = useState(false)
  usePageLoading(loading)

  useEffect(() => {
    if (!user || !profile) { setLoading(false); return }
    let cancelled = false

    ;(async () => {
      setLoading(true)
      const myCode = profile.referral_code || await ensureReferralCode(supabase, user.id, profile.username)
      if (cancelled) return
      setCode(myCode)

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
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [user, profile])

  if (!user) {
    return (
      <div className={styles.page}>
        <p className={styles.empty}>Sign in to get your invite link.</p>
        <button className={styles.signInBtn} onClick={() => openAuthGate()}>Sign In</button>
      </div>
    )
  }

  const link = code && typeof window !== 'undefined' ? `${window.location.origin}/login?ref=${code}` : ''

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
    if (navigator.share) {
      navigator.share({ title: 'Join me on Nabogaming', text: 'Sign up on Nabogaming with my invite link:', url: link }).catch(() => {})
    } else {
      copyLink()
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}><i className="ri-user-add-line" /> Invite &amp; Earn</h1>
        <p className={styles.sub}>Get TZS {REFERRAL_BONUS_TZS} for every friend who joins and verifies their phone number.</p>
      </div>

      <div className={styles.linkCard}>
        <span className={styles.linkText}>{link || 'Generating your link…'}</span>
        <div className={styles.linkActions}>
          <button className={styles.copyBtn} onClick={copyLink} disabled={!link}>
            {copied ? <><i className="ri-check-line" /> Copied</> : <><i className="ri-file-copy-line" /> Copy</>}
          </button>
          <button className={styles.shareBtn} onClick={shareLink} disabled={!link}>
            <i className="ri-share-forward-line" /> Share
          </button>
        </div>
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statVal}>{referrals.length}</span>
          <span className={styles.statLabel}>Invited</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statVal} style={{ color: '#eab308' }}>{pendingCount}</span>
          <span className={styles.statLabel}>Pending</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statVal} style={{ color: '#f59e0b' }}>{fmtAmt(earnedTZS)}</span>
          <span className={styles.statLabel}>Earned</span>
        </div>
      </div>

      <div className={styles.capBar}>
        <div className={styles.capBarTrack}>
          <div className={styles.capBarFill} style={{ width: `${Math.min(100, (weeklyPaid / WEEKLY_REFERRAL_CAP) * 100)}%` }} />
        </div>
        <span className={styles.capBarLabel}>{weeklyPaid}/{WEEKLY_REFERRAL_CAP} paid invites used this week</span>
      </div>

      <div className={styles.list}>
        <h2 className={styles.listTitle}>Your invites</h2>
        {referrals.length === 0 ? (
          <p className={styles.empty}>No invites yet — share your link to start earning.</p>
        ) : (
          referrals.map(r => {
            const friend = friends[r.referred_id]
            const meta = STATUS_META[r.status] || STATUS_META.pending
            return (
              <div key={r.id} className={styles.row}>
                <div className={styles.rowAvatar}>
                  {friend?.avatar_url
                    ? <img src={friend.avatar_url} alt="" />
                    : <span>{(friend?.username || '?')[0].toUpperCase()}</span>}
                </div>
                <div className={styles.rowInfo}>
                  <span className={styles.rowName}>@{friend?.username || 'player'}</span>
                  <span className={styles.rowStatus} style={{ color: meta.color }}>
                    <i className={meta.icon} /> {meta.label}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>

      <p className={styles.footNote}>
        Bonus unlocks once your friend verifies their phone number · One phone number per account ·
        Max {WEEKLY_REFERRAL_CAP} paid invites per week
      </p>
    </div>
  )
}
