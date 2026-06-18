'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '../../../components/AuthProvider'
import { useAuthGate } from '../../../components/AuthGateModal'
import { supabase } from '../../../lib/supabase'
import styles from './page.module.css'
import UserBadges from '../../../components/UserBadges'
import usePageLoading from '../../../components/usePageLoading'
import { getCurrentSeason, computeLevelAfterWin } from '../../../lib/seasons'
import { GAME_META } from '../../../lib/constants'

const STATUS_OPTIONS = ['pending', 'confirmed', 'live', 'awaiting_review', 'completed', 'declined', 'cancelled']

export default function MatchPage() {
  const { slug } = useParams()
  const router = useRouter()
  const { user, isAdmin, refreshProfile } = useAuth()
  const { openAuthGate } = useAuthGate()

  const [match, setMatch]           = useState(null)
  const [loading, setLoading]       = useState(true)
  const [tournament, setTournament] = useState(null)
  usePageLoading(loading)
  const [loadError, setLoadError]   = useState(null)
  const [saving, setSaving]         = useState(false)
  const [forfeitLoading, setForfeitLoading] = useState(false)
  const [resultForm, setResultForm] = useState({ winner_id: '', score_challenger: '', score_challenged: '', notes: '' })
  const [ticker, setTicker]         = useState('')
  const [tickerInput, setTickerInput] = useState('')
  const [tickerSaving, setTickerSaving] = useState(false)

  // Score submission — each competitor submits their own side independently
  const [scoreGoals, setScoreGoals]     = useState({ challenger: 0, challenged: 0 })
  const [scoreSubmitting, setScoreSubmitting] = useState(false)
  const [scoreRequest, setScoreRequest] = useState(null) // active score_requests row for this match

  useEffect(() => { if (slug) loadMatch() }, [slug])

  async function loadMatch() {
    setLoading(true); setLoadError(null)
    try {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)
      const { data, error } = await supabase
        .from('matches')
        .select(`*, challenger:profiles!matches_challenger_id_fkey(id,username,tier,level,wins,losses,avatar_url,email,country_flag,is_season_winner,plan,plan_expires_at), challenged:profiles!matches_challenged_id_fkey(id,username,tier,level,wins,losses,avatar_url,email,country_flag,is_season_winner,plan,plan_expires_at)`)
        .eq(isUUID ? 'id' : 'slug', slug)
        .single()
      if (error) { setLoadError(error.message); setLoading(false); return }
      if (data) {
        setMatch(data)
        setResultForm({ winner_id: data.winner_id || '', score_challenger: data.score_challenger ?? '', score_challenged: data.score_challenged ?? '', notes: data.notes || '' })
        setTicker(data.ticker_text || '')
        setTickerInput(data.ticker_text || '')
        // Load the active score_requests row (pending = still collecting one or both sides)
        const { data: sr } = await supabase
          .from('score_requests')
          .select('*')
          .eq('match_id', data.id)
          .in('status', ['pending'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        setScoreRequest(sr || null)
        if (sr) {
          const mySide = user?.id === data.challenger_id ? 'challenger' : 'challenged'
          const myChallengerVal = mySide === 'challenger' ? sr.challenger_score_challenger : sr.challenged_score_challenger
          const myChallengedVal = mySide === 'challenger' ? sr.challenger_score_challenged : sr.challenged_score_challenged
          setScoreGoals({ challenger: myChallengerVal ?? 0, challenged: myChallengedVal ?? 0 })
        }
        if (data.tournament_id) {
          supabase.from('tournaments').select('id, created_by').eq('id', data.tournament_id).maybeSingle()
            .then(({ data: t }) => { if (t) setTournament(t) })
        }
      }
    } catch (err) { setLoadError(err.message || 'Network error') }
    setLoading(false)
  }

  async function updateStatus(status) {
    setSaving(true)
    await supabase.from('matches').update({ status }).eq('id', match.id)
    setSaving(false); loadMatch()
  }

  async function saveTicker() {
    setTickerSaving(true)
    await supabase.from('matches').update({ ticker_text: tickerInput }).eq('id', match.id)
    setTicker(tickerInput); setTickerSaving(false)
  }

  async function forfeitMatch() {
    if (!confirm('Forfeit this match? Your opponent will be declared winner.')) return
    setForfeitLoading(true)
    const opponentId = user.id === match.challenger_id ? match.challenged_id : match.challenger_id
    const me = user.id === match.challenger_id ? match.challenger : match.challenged
    await supabase.from('matches').update({
      status: 'completed', winner_id: opponentId,
      notes: (match.notes ? match.notes + '\n' : '') + `[${me?.username} forfeited]`,
    }).eq('id', match.id)
    if (match.status !== 'completed') {
      const [{ data: oppData }, { data: meData }] = await Promise.all([
        supabase.from('profiles').select('wins,points').eq('id', opponentId).single(),
        supabase.from('profiles').select('losses,points').eq('id', user.id).single(),
      ])
      await Promise.all([
        supabase.from('profiles').update({ wins: (oppData?.wins || 0) + 1, points: (oppData?.points || 0) + 12 }).eq('id', opponentId),
        supabase.from('profiles').update({ losses: (meData?.losses || 0) + 1, points: Math.max(0, (meData?.points || 0) + 4) }).eq('id', user.id),
      ])
      await Promise.all([
        supabase.rpc('log_earning', { p_user_id: opponentId, p_type: 'match_win', p_points: 12, p_description: `${me?.username ?? 'Opponent'} forfeited`, p_ref_id: match.id }),
        supabase.rpc('log_earning', { p_user_id: user.id, p_type: 'match_loss', p_points: 4, p_description: 'Forfeit', p_ref_id: match.id }),
      ])
      refreshProfile?.()
    }
    setForfeitLoading(false); loadMatch()
  }

  // Each competitor submits their own read of the score independently.
  // The submit_match_score RPC handles: waiting for the other side, then
  // either auto-completing (scores agree) or flagging for admin (conflict).
  async function submitMyScore() {
    if (!user) { openAuthGate(); return }
    if (!confirm('Submit this score? If your opponent reports the same result, the match completes automatically.')) return
    setScoreSubmitting(true)
    const { data, error } = await supabase.rpc('submit_match_score', {
      p_match_id: match.id,
      p_user_id: user.id,
      p_score_challenger: scoreGoals.challenger,
      p_score_challenged: scoreGoals.challenged,
    })
    setScoreSubmitting(false)
    if (error) { alert(error.message); return }
    if (data?.status === 'auto_completed' && (user.id === match.challenger_id || user.id === match.challenged_id)) {
      refreshProfile?.()
    }
    loadMatch()
  }

  // Admin manually resolves a conflicted score_request (both sides disagreed)
  async function adminResolveConflict(winnerId, scoreCh, scoreCd) {
    setSaving(true)
    const { error } = await supabase.from('matches').update({
      status: 'completed', winner_id: winnerId || null,
      score_challenger: scoreCh, score_challenged: scoreCd,
      notes: resultForm.notes,
    }).eq('id', match.id)
    if (error) { alert(error.message); setSaving(false); return }
    if (scoreRequest) await supabase.from('score_requests').update({ status: 'accepted', resolution: 'admin_override' }).eq('id', scoreRequest.id)

    if (winnerId && match.status !== 'completed') {
      const loserId = winnerId === match.challenger_id ? match.challenged_id : match.challenger_id
      const [{ data: wData }, { data: lData }] = await Promise.all([
        supabase.from('profiles').select('wins, points, season_wins, level, current_season').eq('id', winnerId).single(),
        supabase.from('profiles').select('losses, points, season_losses, current_season').eq('id', loserId).single(),
      ])
      await Promise.all([
        supabase.from('profiles').update({
          wins: (wData?.wins ?? 0) + 1, points: (wData?.points ?? 0) + 12,
          season_wins: (wData?.season_wins ?? 0) + 1,
          level: computeLevelAfterWin(wData?.level ?? 1, (wData?.season_wins ?? 0) + 1),
          current_season: getCurrentSeason(),
        }).eq('id', winnerId),
        supabase.from('profiles').update({
          losses: (lData?.losses ?? 0) + 1, points: Math.max(0, (lData?.points ?? 0) + 4),
          season_losses: (lData?.season_losses ?? 0) + 1, current_season: getCurrentSeason(),
        }).eq('id', loserId),
      ])
      await Promise.all([
        supabase.rpc('log_earning', { p_user_id: winnerId, p_type: 'match_win', p_points: 12, p_description: `Beat ${(winnerId === match.challenger_id ? cd : ch)?.username ?? 'opponent'}`, p_ref_id: match.id }),
        supabase.rpc('log_earning', { p_user_id: loserId, p_type: 'match_loss', p_points: 4, p_description: `Lost to ${(loserId === match.challenger_id ? cd : ch)?.username ?? 'opponent'}`, p_ref_id: match.id }),
      ])
      await supabase.from('notifications').insert([
        { user_id: winnerId, type: 'match_result', title: '🏆 Match Result: You Won!', body: 'An admin reviewed and confirmed your result. +12 pts', meta: { match_id: match.id }, read: false },
        { user_id: loserId, type: 'match_result', title: 'Match Result: Defeat', body: 'An admin reviewed and confirmed your result. +4 pts', meta: { match_id: match.id }, read: false },
      ])
      if (user?.id === winnerId || user?.id === loserId) refreshProfile?.()
    }
    setSaving(false); loadMatch()
  }

  // Admin overrides result manually, bypassing score_requests entirely
  async function updateResult() {
    setSaving(true)
    const winnerId = resultForm.winner_id || null
    const scoreCh = resultForm.score_challenger !== '' ? Number(resultForm.score_challenger) : null
    const scoreCd = resultForm.score_challenged !== '' ? Number(resultForm.score_challenged) : null
    await adminResolveConflict(winnerId, scoreCh, scoreCd)
  }

  function formatDate(iso) {
    if (!iso) return 'TBD'
    return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const STATUS_COLOR = { live: '#22c55e', confirmed: 'var(--text)', pending: '#f59e0b', recruiting: '#3b82f6', awaiting_review: '#a855f7', completed: 'var(--text-muted)', declined: '#ef4444', cancelled: '#ef4444' }

  if (loading) return null

  if (loadError || !match) return (
    <div className={styles.page}>
      <button className={styles.back} onClick={() => router.back()}><i className="ri-arrow-left-line" /> Back</button>
      <div className={styles.notFound}>
        <i className={loadError ? 'ri-wifi-off-line' : 'ri-error-warning-line'} />
        <h2>{loadError ? 'Failed to load' : 'Match not found'}</h2>
        {loadError && <p>{loadError}</p>}
        <button className={styles.btn} onClick={loadError ? loadMatch : () => router.back()}>
          {loadError ? 'Retry' : 'Go back'}
        </button>
      </div>
    </div>
  )

  const ch = match.challenger
  const cd = match.challenged
  const isLive = match.status === 'live'
  const isCompleted = match.status === 'completed'
  const isAwaitingReview = match.status === 'awaiting_review'
  const isRecruiting = match.status === 'recruiting'
  const isActive = ['pending', 'confirmed', 'live'].includes(match.status)
  const isCompetitor = user && (user.id === match.challenger_id || user.id === match.challenged_id)
  const canManage = isAdmin || (user && tournament?.created_by === user.id)
  const statusColor = STATUS_COLOR[match.status] || 'var(--text-muted)'
  const chWon = isCompleted && match.winner_id === match.challenger_id
  const cdWon = isCompleted && match.winner_id === match.challenged_id
  const showScore = isLive || isCompleted || isAwaitingReview

  // Has *this* user already submitted their side of the active score request?
  const mySide = user?.id === match.challenger_id ? 'challenger' : user?.id === match.challenged_id ? 'challenged' : null
  const iHaveSubmitted = scoreRequest && mySide && (
    mySide === 'challenger' ? !!scoreRequest.challenger_submitted_at : !!scoreRequest.challenged_submitted_at
  )
  const opponentHasSubmitted = scoreRequest && mySide && (
    mySide === 'challenger' ? !!scoreRequest.challenged_submitted_at : !!scoreRequest.challenger_submitted_at
  )
  const isConflict = scoreRequest?.resolution === 'conflict'

  return (
    <div className={styles.page}>
      <button className={styles.back} onClick={() => router.back()}>
        <i className="ri-arrow-left-line" /> Back
      </button>

      {/* ── MATCH CARD ── */}
      <div className={`${styles.card} ${isLive ? styles.cardLive : ''}`}>

        {/* Status row */}
        <div className={styles.statusRow}>
          <span className={styles.statusChip} style={{ color: statusColor }}>
            {isLive && <span className={styles.liveDot} />}
            {isRecruiting ? 'OPEN — RECRUITING' : match.status === 'awaiting_review' ? 'IN REVIEW' : match.status?.toUpperCase()}
          </span>
          {match.game && <span className={styles.tag}><i className={GAME_META[match.game]?.icon} style={{ marginRight: 4 }} />{GAME_META[match.game]?.name || match.game}</span>}
          {match.format && <span className={styles.tag}>{match.format}</span>}
          {match.game_mode && <span className={styles.tag}>{match.game_mode}</span>}
          {match.scheduled_at && <span className={styles.dateText}>{formatDate(match.scheduled_at)}</span>}
        </div>

        {/* Players + score */}
        <div className={styles.matchup}>
          {/* Challenger */}
          <div className={`${styles.side} ${chWon ? styles.sideWon : ''} ${isCompleted && !chWon && match.winner_id ? styles.sideLost : ''}`}>
            <Avatar profile={ch} size={64} />
            <div className={styles.sideInfo}>
              <span className={styles.sideName}>
                {ch?.username || '—'}
                <UserBadges email={ch?.email} plan={ch?.plan} planExpiresAt={ch?.plan_expires_at} countryFlag={ch?.country_flag} isSeasonWinner={ch?.is_season_winner} size={12} gap={2} />
              </span>
              <span className={styles.sideMeta}>{ch?.tier} · Lv.{ch?.level ?? 1} · {ch?.wins ?? 0}W {ch?.losses ?? 0}L</span>
            </div>
            {chWon && <span className={styles.winLabel}>🏆 Winner</span>}
          </div>

          {/* Score / VS */}
          <div className={styles.middle}>
            {showScore ? (
              <div className={styles.scoreBox}>
                <span className={`${styles.scoreNum} ${isLive ? styles.scoreLive : ''} ${chWon ? styles.scoreWin : ''}`}>{match.score_challenger ?? 0}</span>
                <span className={styles.scoreSep}>—</span>
                <span className={`${styles.scoreNum} ${isLive ? styles.scoreLive : ''} ${cdWon ? styles.scoreWin : ''}`}>{match.score_challenged ?? 0}</span>
              </div>
            ) : (
              <span className={styles.vsText}>VS</span>
            )}
          </div>

          {/* Challenged */}
          <div className={`${styles.side} ${styles.sideRight} ${cdWon ? styles.sideWon : ''} ${isCompleted && !cdWon && match.winner_id ? styles.sideLost : ''}`}>
            {cdWon && <span className={styles.winLabel}>🏆 Winner</span>}
            <div className={`${styles.sideInfo} ${styles.sideInfoRight}`}>
              <span className={styles.sideName}>
                <UserBadges email={cd?.email} plan={cd?.plan} planExpiresAt={cd?.plan_expires_at} countryFlag={cd?.country_flag} isSeasonWinner={cd?.is_season_winner} size={12} gap={2} />
                {isRecruiting ? <em style={{ fontStyle: 'normal', color: 'var(--text-muted)' }}>Open slot</em> : (cd?.username || '—')}
              </span>
              <span className={styles.sideMeta}>{isRecruiting ? 'Waiting for a challenger' : `${cd?.tier ?? ''} · Lv.${cd?.level ?? 1} · ${cd?.wins ?? 0}W ${cd?.losses ?? 0}L`}</span>
            </div>
            <Avatar profile={cd} size={64} />
          </div>
        </div>

        {/* Live ticker */}
        {isLive && ticker && (
          <div className={styles.ticker}>
            <span className={styles.tickerBadge}><i className="ri-live-line" /> LIVE</span>
            <div className={styles.tickerScroll}>
              <span className={styles.tickerText}>{ticker}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── RECRUITING — anyone (not just the page-loader) can join from here too ── */}
      {isRecruiting && (
        <div className={styles.section}>
          {match.recruit_message && <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>"{match.recruit_message}"</p>}
          {user?.id === match.challenger_id ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Your open call-out is live — waiting for someone to join.</p>
          ) : (
            <button className={styles.btn} onClick={async () => {
              if (!user) { openAuthGate(); return }
              const { error } = await supabase.from('matches')
                .update({ challenged_id: user.id, status: 'pending', recruiting: false, recruit_closed_at: new Date().toISOString() })
                .eq('id', match.id).eq('recruiting', true).is('challenged_id', null)
              if (!error) loadMatch()
              else alert('Someone already joined this match.')
            }}>
              <i className="ri-sword-line" /> Join This Match
            </button>
          )}
        </div>
      )}

      {/* ── NOTES ── */}
      {match.notes && (
        <div className={styles.section}>
          <p className={styles.sectionLabel}><i className="ri-file-text-line" /> Notes</p>
          <div className={styles.notes} dangerouslySetInnerHTML={{ __html: match.notes }} />
        </div>
      )}

      {/* ── INFO ROWS ── */}
      <div className={styles.infoGrid}>
        {[
          { icon: 'ri-calendar-line', label: 'Date', value: formatDate(match.scheduled_at) },
          { icon: 'ri-gamepad-line', label: 'Mode', value: match.game_mode || '—' },
          { icon: 'ri-award-line', label: 'Format', value: match.format || '—' },
        ].map(r => (
          <div key={r.label} className={styles.infoRow}>
            <span className={styles.infoLabel}><i className={r.icon} /> {r.label}</span>
            <span className={styles.infoValue}>{r.value}</span>
          </div>
        ))}
      </div>

      {/* ── COMPETITOR ACTIONS ── */}
      {!canManage && isCompetitor && (
        <div className={styles.actions}>
          {/* Accept / Decline when pending */}
          {match.status === 'pending' && user?.id === match.challenged_id && (<>
            <button className={styles.btn} onClick={() => updateStatus('confirmed')} disabled={saving}>
              <i className="ri-check-line" /> Accept Match
            </button>
            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => updateStatus('declined')} disabled={saving}>
              <i className="ri-close-line" /> Decline
            </button>
          </>)}

          {/* Score submission — available once live, or still open if awaiting review and I haven't submitted yet */}
          {(isLive || (isAwaitingReview && !iHaveSubmitted && !isConflict)) && (
            <div className={styles.scorePanel}>
              <p className={styles.scorePanelTitle}><i className="ri-gamepad-line" /> Submit Match Score</p>
              <p className={styles.scorePanelHint}>
                Enter the final score as you saw it. {opponentHasSubmitted
                  ? "Your opponent already submitted — if yours matches, the match completes instantly."
                  : "Once both players submit, matching scores auto-complete the match. Mismatched scores go to admin."}
              </p>

              <div className={styles.stepperRow}>
                <span className={styles.stepperName}>{ch?.username}</span>
                <div className={styles.stepper}>
                  <button className={styles.stepBtn} onClick={() => setScoreGoals(g => ({ ...g, challenger: Math.max(0, g.challenger - 1) }))}>−</button>
                  <span className={styles.stepVal}>{scoreGoals.challenger}</span>
                  <button className={styles.stepBtn} onClick={() => setScoreGoals(g => ({ ...g, challenger: g.challenger + 1 }))}>+</button>
                </div>
              </div>

              <div className={styles.stepperRow}>
                <span className={styles.stepperName}>{cd?.username}</span>
                <div className={styles.stepper}>
                  <button className={styles.stepBtn} onClick={() => setScoreGoals(g => ({ ...g, challenged: Math.max(0, g.challenged - 1) }))}>−</button>
                  <span className={styles.stepVal}>{scoreGoals.challenged}</span>
                  <button className={styles.stepBtn} onClick={() => setScoreGoals(g => ({ ...g, challenged: g.challenged + 1 }))}>+</button>
                </div>
              </div>

              <button className={styles.btn} onClick={submitMyScore} disabled={scoreSubmitting}>
                <i className="ri-send-plane-line" /> {scoreSubmitting ? 'Submitting…' : 'Submit My Score'}
              </button>
            </div>
          )}

          {/* I've submitted, waiting on opponent */}
          {isAwaitingReview && iHaveSubmitted && !opponentHasSubmitted && (
            <div className={styles.reviewBanner}>
              <i className="ri-time-line" />
              <div>
                <p className={styles.reviewBannerTitle}>Your score is in — waiting on your opponent</p>
                <p className={styles.reviewBannerSub}>It'll auto-complete the moment they submit a matching result.</p>
              </div>
            </div>
          )}

          {/* Conflict — both submitted but disagreed, admin needed */}
          {isAwaitingReview && isConflict && (
            <div className={styles.reviewBanner} style={{ borderColor: '#ef4444' }}>
              <i className="ri-error-warning-line" style={{ color: '#ef4444' }} />
              <div>
                <p className={styles.reviewBannerTitle}>Score mismatch — sent to admin</p>
                <p className={styles.reviewBannerSub}>
                  {ch?.username}: {scoreRequest.challenger_score_challenger}–{scoreRequest.challenger_score_challenged} ·{' '}
                  {cd?.username}: {scoreRequest.challenged_score_challenger}–{scoreRequest.challenged_score_challenged}
                </p>
              </div>
            </div>
          )}

          {/* Forfeit — available on confirmed/live */}
          {isActive && match.status !== 'pending' && (
            <button className={`${styles.btn} ${styles.btnGhost}`} onClick={forfeitMatch} disabled={forfeitLoading}>
              <i className="ri-flag-line" /> {forfeitLoading ? 'Forfeiting…' : 'Forfeit Match'}
            </button>
          )}
        </div>
      )}

      {/* ── SPECTATOR NOTE — visible to non-competitors viewing a live/open match ── */}
      {!isCompetitor && !canManage && (isLive || isAwaitingReview || isRecruiting) && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>
          {isRecruiting ? 'Anyone can join this open match.' : 'You\'re viewing this match as a spectator.'}
        </p>
      )}

      {/* ── ADMIN PANEL ── */}
      {canManage && (
        <div className={styles.adminPanel}>
          <p className={styles.adminTitle}><i className="ri-shield-line" /> {isAdmin ? 'Admin Controls' : 'Organiser Controls'}</p>

          {/* ── Conflict resolution — only shown when both sides disagreed ── */}
          {isConflict && scoreRequest && (
            <div className={styles.adminBlock}>
              <label className={styles.adminLabel} style={{ color: '#ef4444' }}>
                <i className="ri-error-warning-line" style={{ marginRight: 4 }} /> Score Conflict — Manual Decision Needed
              </label>
              <div className={styles.scoreRequestCard}>
                <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>Each player reported a different result:</p>
                <div className={styles.scoreRequestPlayers}>
                  <div className={styles.srPlayer}>
                    <span className={styles.srName}>{ch?.username} says</span>
                    <span className={styles.srScore}>{scoreRequest.challenger_score_challenger ?? '?'}–{scoreRequest.challenger_score_challenged ?? '?'}</span>
                  </div>
                  <span className={styles.srSep}>vs</span>
                  <div className={`${styles.srPlayer} ${styles.srPlayerRight}`}>
                    <span className={styles.srScore}>{scoreRequest.challenged_score_challenger ?? '?'}–{scoreRequest.challenged_score_challenged ?? '?'}</span>
                    <span className={styles.srName}>{cd?.username} says</span>
                  </div>
                </div>
                <div className={styles.field} style={{ marginTop: 10 }}>
                  <label className={styles.fieldLabel}>Pick which report to accept</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className={`${styles.btn} ${styles.btnSm}`} style={{ flex: 1 }}
                      onClick={() => adminResolveConflict(
                        scoreRequest.challenger_score_challenger > scoreRequest.challenger_score_challenged ? match.challenger_id : scoreRequest.challenger_score_challenged > scoreRequest.challenger_score_challenger ? match.challenged_id : null,
                        scoreRequest.challenger_score_challenger, scoreRequest.challenger_score_challenged
                      )}>
                      Accept {ch?.username}'s
                    </button>
                    <button className={`${styles.btn} ${styles.btnSm}`} style={{ flex: 1 }}
                      onClick={() => adminResolveConflict(
                        scoreRequest.challenged_score_challenger > scoreRequest.challenged_score_challenged ? match.challenger_id : scoreRequest.challenged_score_challenged > scoreRequest.challenged_score_challenger ? match.challenged_id : null,
                        scoreRequest.challenged_score_challenger, scoreRequest.challenged_score_challenged
                      )}>
                      Accept {cd?.username}'s
                    </button>
                  </div>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Or use "Override Result" below to set a custom score instead.</p>
              </div>
            </div>
          )}

          <div className={styles.adminBlock}>
            <label className={styles.adminLabel}>Status</label>
            <div className={styles.statusBtns}>
              {STATUS_OPTIONS.map(s => (
                <button key={s} className={`${styles.statusBtn} ${match.status === s ? styles.statusBtnActive : ''}`}
                  onClick={() => updateStatus(s)} disabled={saving}>{s}</button>
              ))}
            </div>
          </div>

          <div className={styles.adminBlock}>
            <label className={styles.adminLabel}>Live Ticker <span className={styles.adminHint}>(shown only while Live)</span></label>
            <div className={styles.tickerRow}>
              <input className={styles.input} placeholder="e.g. Round 2 · Player A leads 3-1…"
                value={tickerInput} onChange={e => setTickerInput(e.target.value)} />
              <button className={`${styles.btn} ${styles.btnSm}`} onClick={saveTicker} disabled={tickerSaving}>
                {tickerSaving ? '…' : <i className="ri-check-line" />}
              </button>
            </div>
          </div>

          <div className={styles.adminBlock}>
            <label className={styles.adminLabel}>Override Result <span className={styles.adminHint}>(bypasses score requests entirely)</span></label>
            <div className={styles.resultForm}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Winner</label>
                <select className={styles.input} value={resultForm.winner_id} onChange={e => setResultForm(x => ({ ...x, winner_id: e.target.value }))}>
                  <option value="">— No winner yet —</option>
                  <option value={match.challenger_id}>{ch?.username} (Challenger)</option>
                  <option value={match.challenged_id}>{cd?.username} (Challenged)</option>
                </select>
              </div>
              <div className={styles.scoreRow}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>{ch?.username}</label>
                  <input className={styles.input} type="number" min="0" placeholder="0"
                    value={resultForm.score_challenger} onChange={e => setResultForm(x => ({ ...x, score_challenger: e.target.value }))} />
                </div>
                <span className={styles.scoreSep} style={{ padding: '0 4px', fontSize: 20 }}>:</span>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>{cd?.username}</label>
                  <input className={styles.input} type="number" min="0" placeholder="0"
                    value={resultForm.score_challenged} onChange={e => setResultForm(x => ({ ...x, score_challenged: e.target.value }))} />
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Notes (HTML supported)</label>
                <textarea className={styles.input} rows={3} value={resultForm.notes}
                  onChange={e => setResultForm(x => ({ ...x, notes: e.target.value }))} />
              </div>
              <button className={styles.btn} onClick={updateResult} disabled={saving}>
                <i className="ri-check-double-line" /> {saving ? 'Saving…' : 'Save Result'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Avatar({ profile, size }) {
  const s = { width: size, height: size, borderRadius: '50%', flexShrink: 0 }
  if (!profile) return <div style={{ ...s, background: 'var(--surface)', border: '1px solid var(--border-dark)' }} />
  return profile.avatar_url
    ? <img src={profile.avatar_url} style={{ ...s, objectFit: 'cover' }} alt="" />
    : <div style={{ ...s, background: 'var(--surface)', border: '1px solid var(--border-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: size * 0.3, color: 'var(--text-dim)' }}>
        {(profile.username || '?').slice(0, 2).toUpperCase()}
      </div>
}
