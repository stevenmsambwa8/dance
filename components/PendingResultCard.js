'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from './AuthProvider'
import { supabase } from '../lib/supabase'
import { fetchPendingSubmissions } from '../lib/pendingSubmissions'
import { submitGroupFixtureResult, submitKnockoutResult } from '../lib/resultSubmission'
import { buildMatchupSlug } from '../lib/matchSlug'
import { getTimeStatus, formatDuration } from '../lib/roundTimers'
import styles from './PendingResultCard.module.css'

/**
 * A single nudge card for one pending fixture. The user's own avatar is
 * used as the background image — faded and darkened with a bottom-up
 * black gradient overlay so the text on top always stays readable.
 *
 * The score-submission form (your score / opponent's score + optional
 * proof screenshot) is shown directly on the card — no extra tap to
 * reveal it. If the organiser assigned this specific match its own time
 * slot, a personal countdown shows here too, and the form locks once
 * that match's window has passed. The tournament name itself is still a
 * link, for anyone who wants full bracket context before scoring.
 */
export function PendingResultCard({ item, avatarUrl, compact, userId, onResolved }) {
  const opponent = item.opponentName || 'your opponent'
  const [mine, setMine] = useState('')
  const [opp, setOpp] = useState('')
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null) // { status, message }

  // This match's own personal schedule slot (if the organiser assigned one)
  const hasSchedule = !!(item.scheduleStart || item.scheduleEnd)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!hasSchedule) return
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [hasSchedule])
  const schedStatus = hasSchedule ? getTimeStatus({ m: { start: item.scheduleStart, end: item.scheduleEnd } }, 'm', now) : null
  const locked = schedStatus?.phase === 'over'

  async function handleSubmit() {
    if (saving || mine === '' || opp === '' || locked) return
    setSaving(true)
    setResult(null)

    const payload = { tournamentId: item.tournamentId, userId, mine, opp, file }
    const res = item.kind === 'group'
      ? await submitGroupFixtureResult({ ...payload, groupId: item.groupId, fixtureId: item.fixtureId })
      : await submitKnockoutResult({ ...payload, rIdx: item.rIdx, pIdx: item.pIdx, mySlotIdx: item.mySlotIdx })

    setSaving(false)
    setResult(res)

    if (res.status === 'confirmed' || res.status === 'submitted' || res.status === 'disputed') {
      setTimeout(() => onResolved?.(item), 1400)
    }
  }

  // Deep link straight to this exact match — a readable "/matches/name-vs-name"
  // path (e.g. /tournaments/summer-clash/matches/abi-vs-seti) that resolves
  // to the right tab and scrolls/highlights the specific card once there.
  const matchHref = `/tournaments/${item.tournamentSlug}/matches/${buildMatchupSlug(item.myName, item.opponentName)}`

  return (
    <div className={styles.card}>
      {avatarUrl ? (
        <div className={styles.bg} style={{ backgroundImage: `url(${avatarUrl})` }} />
      ) : (
        <div className={styles.bgFallback} />
      )}
      <div className={styles.overlay} />
      <div className={`${styles.content} ${compact ? styles.contentCompact : ''}`}>
        <span className={styles.badge}><i className="ri-time-line" /> Result Needed</span>
        <Link href={matchHref} scroll={false} className={`${styles.title} ${compact ? styles.titleCompact : ''}`}>
          {item.tournamentName}
        </Link>
        <div className={`${styles.sub} ${compact ? styles.subCompact : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>vs {opponent} — submit your score to confirm</span>
          <Link href={matchHref} scroll={false} style={{ fontSize: 11, fontWeight: 800, color: 'inherit', opacity: 0.85, whiteSpace: 'nowrap' }}>
            <i className="ri-external-link-line" /> Open match
          </Link>
        </div>

        {schedStatus && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', margin: '2px 0 8px', borderRadius: 6, width: 'fit-content',
            fontSize: 10.5, fontWeight: 800,
            color: schedStatus.phase === 'over' ? '#ef4444' : schedStatus.phase === 'live' ? '#22c55e' : '#f59e0b',
            background: schedStatus.phase === 'over' ? 'rgba(239,68,68,0.15)' : schedStatus.phase === 'live' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
          }}>
            <i className={schedStatus.phase === 'over' ? 'ri-alarm-warning-fill' : schedStatus.phase === 'live' ? 'ri-timer-flash-line' : 'ri-hourglass-line'} />
            {schedStatus.phase === 'over' ? "Time's up for this match" : schedStatus.phase === 'live' ? `Ends in ${formatDuration(schedStatus.ms)}` : `Starts in ${formatDuration(schedStatus.ms)}`}
          </div>
        )}

        {!result && locked && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', padding: '8px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 11, fontWeight: 700, color: '#ef4444' }}>
            <i className="ri-lock-line" /> Submissions closed for this match
          </div>
        )}

        {!result && !locked && (
          <div className={styles.form}>
            <div className={styles.scoreRow}>
              <span className={styles.scoreLabel}>You</span>
              <input
                type="text" inputMode="numeric" value={mine} placeholder="0"
                onChange={e => setMine(e.target.value.replace(/[^0-9]/g, ''))}
                className={styles.scoreInput}
              />
              <span className={styles.scoreDash}>–</span>
              <input
                type="text" inputMode="numeric" value={opp} placeholder="0"
                onChange={e => setOpp(e.target.value.replace(/[^0-9]/g, ''))}
                className={styles.scoreInput}
              />
              <span className={styles.scoreLabel}>{opponent.length > 10 ? opponent.slice(0, 10) + '…' : opponent}</span>
            </div>
            <label className={styles.fileLabel}>
              <i className="ri-image-add-line" />
              <span>{file ? file.name : 'Attach proof screenshot (optional)'}</span>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setFile(e.target.files?.[0] || null)} />
            </label>
            <div className={styles.formActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => { setMine(''); setOpp(''); setFile(null) }}>
                Cancel
              </button>
              <button
                type="button" className={styles.submitBtn}
                disabled={saving || mine === '' || opp === ''}
                onClick={handleSubmit}
              >
                {saving ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className={`${styles.resultMsg} ${styles[`resultMsg_${result.status}`] || ''}`}>
            <i className={result.status === 'error' || result.status === 'tied' ? 'ri-error-warning-line' : 'ri-checkbox-circle-line'} />
            <span>{result.message}</span>
            {(result.status === 'error' || result.status === 'tied') && (
              <button type="button" className={styles.retryBtn} onClick={() => setResult(null)}>Try again</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Loads the logged-in user's pending-result items. Shared by the stack
 * widget below and by any page (like the tournament listing) that wants
 * to place individual cards itself instead of stacking them.
 */
export function usePendingResultItems(limit = 5, onlyTournamentId = null) {
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

  function resolve(resolvedItem) {
    setItems(prev => prev.filter(i => i !== resolvedItem))
  }

  return { items, userId: user?.id, avatarUrl: profile?.avatar_url, resolve }
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
  const { items, userId, avatarUrl, resolve } = usePendingResultItems(limit, onlyTournamentId)

  if (!items.length) return null

  return (
    <div className={`${styles.stack} ${className}`}>
      {items.map(item => (
        <PendingResultCard
          key={`${item.tournamentId}-${item.kind}-${item.fixtureId ?? `${item.rIdx}-${item.pIdx}`}`}
          item={item}
          avatarUrl={avatarUrl}
          compact={compact}
          userId={userId}
          onResolved={resolve}
        />
      ))}
    </div>
  )
}
