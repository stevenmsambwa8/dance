'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from './AuthProvider'
import { supabase } from '../lib/supabase'
import { fetchPendingSubmissions } from '../lib/pendingSubmissions'
import styles from './PendingResultCard.module.css'

/**
 * A single nudge card for one pending fixture. The user's own avatar is
 * used as the background image — faded and darkened with a bottom-up
 * black gradient overlay so the text on top always stays readable.
 */
function Card({ item, avatarUrl, compact }) {
  const opponent = item.opponentName || 'your opponent'
  return (
    <Link href={`/tournaments/${item.tournamentSlug}`} className={styles.card}>
      {avatarUrl ? (
        <div className={styles.bg} style={{ backgroundImage: `url(${avatarUrl})` }} />
      ) : (
        <div className={styles.bgFallback} />
      )}
      <div className={styles.overlay} />
      <div className={`${styles.content} ${compact ? styles.contentCompact : ''}`}>
        <span className={styles.badge}><i className="ri-time-line" /> Result Needed</span>
        <div className={`${styles.title} ${compact ? styles.titleCompact : ''}`}>{item.tournamentName}</div>
        <div className={`${styles.sub} ${compact ? styles.subCompact : ''}`}>vs {opponent} — submit your score to confirm</div>
        <div className={styles.row}>
          <span className={`${styles.cta} ${compact ? styles.ctaCompact : ''}`}>
            <i className="ri-upload-2-line" /> Submit Proof
          </span>
        </div>
      </div>
    </Link>
  )
}

/**
 * Drop-in stack of pending-result nudge cards for the logged-in user.
 * Renders nothing if there's no pending submission (not logged in, no
 * active matches, or everything's already been submitted) — safe to
 * place on any page unconditionally.
 *
 * Props:
 *   limit    — max cards to show (default 1)
 *   compact  — smaller card, for tighter spots like a listing page header
 *   onlyTournamentId — if set, only shows pending items for that one
 *                      tournament (used on the tournament slug page so
 *                      the card only nudges about THIS tournament)
 */
export default function PendingResultCards({ limit = 1, compact = false, onlyTournamentId = null, className = '' }) {
  const { user, profile } = useAuth()
  const [items, setItems] = useState([])

  useEffect(() => {
    let cancelled = false
    if (!user) { setItems([]); return }
    fetchPendingSubmissions(supabase, user.id, onlyTournamentId ? 20 : limit).then(all => {
      if (cancelled) return
      const filtered = onlyTournamentId ? all.filter(i => i.tournamentId === onlyTournamentId) : all
      setItems(filtered.slice(0, limit))
    })
    return () => { cancelled = true }
  }, [user, onlyTournamentId, limit])

  if (!items.length) return null

  return (
    <div className={`${styles.stack} ${className}`}>
      {items.map(item => (
        <Card
          key={`${item.tournamentId}-${item.kind}-${item.fixtureId ?? `${item.rIdx}-${item.pIdx}`}`}
          item={item}
          avatarUrl={profile?.avatar_url}
          compact={compact}
        />
      ))}
    </div>
  )
}
