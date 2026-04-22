'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '../../../components/AuthProvider'
import { supabase } from '../../../lib/supabase'
import styles from './page.module.css'
import UserBadges from '../../../components/UserBadges'
import usePageLoading from '../../../components/usePageLoading'
import { getCurrentSeason, computeLevelAfterWin } from '../../../lib/seasons'

const STATUS_OPTIONS = ['pending', 'confirmed', 'live', 'completed', 'declined', 'cancelled']

export default function MatchPage() {
  const { slug } = useParams()
  const router = useRouter()
  const { user, isAdmin, refreshProfile } = useAuth()

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

  useEffect(() => { if (slug) loadMatch() }, [slug])

  async function recalculateRanks() {
    const { data: players } = await supabase.from('profiles').select('id, points').order('points', { ascending: false })
    if (!players) return
    await Promise.all(players.map((p, i) => supabase.from('profiles').update({ rank: i + 1 }).eq('id', p.id)))
  }

  async function loadMatch() {
    setLoading(true); setLoadError(null)
    try {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)
      const { data, error } = await supabase
        .from('matches')
        .select(`*, challenger:profiles!matches_challenger_id_fkey(id,username,tier,level,wins,losses,avatar_url,email,country_flag,is_season_winner), challenged:profiles!matches_challenged_id_fkey(id,username,tier,level,wins,losses,avatar_url,email,country_flag,is_season_winner)`)
        .eq(isUUID ? 'id' : 'slug', slug)
        .single()
      if (error) { setLoadError(error.message); setLoading(false); return }
      if (data) {
        setMatch(data)
        setResultForm({ winner_id: data.winner_id || '', score_challenger: data.score_challenger ?? '', score_challenged: data.score_challenged ?? '', notes: data.notes || '' })
        setTicker(data.ticker_text || '')
        setTickerInput(data.ticker_text || '')
        // Load tournament creator if match is linked to a tournament
        if (data.tournament_id) {
          supabase.from('tournaments').select('id, created_by').eq('id', data.tournament_id).maybeSingle()
            .then(({ data: t }) => { if (t) setTournament(t) })
        }
      }
    } catch (err) { setLoadError(err.message || 'Network error') }
    setLoading(false)
  }

  async function updateResult() {
    setSaving(true)
    const winnerId = resultForm.winner_id || null
    const { error } = await supabase.from('matches').update({
      status: 'completed', winner_id: winnerId,
      score_challenger: resultForm.score_challenger !== '' ? Number(resultForm.score_challenger) : null,
      score_challenged: resultForm.score_challenged !== '' ? Number(resultForm.score_challenged) : null,
      notes: resultForm.notes,
    }).eq('id', match.id)
    if (error) { alert(error.message); setSaving(false); return }
    if (winnerId && match.status !== 'completed') {
      const loserId = winnerId === match.challenger_id ? match.challenged_id : match.challenger_id
      const [{ data: wData }, { data: lData }] = await Promise.all([
        supabase.from('profiles').select('wins, points, season_wins, level, current_season').eq('id', winnerId).single(),
        supabase.from('profiles').select('losses, points, season_losses, current_season').eq('id', loserId).single(),
      ])
      await Promise.all([
        supabase.from('profiles').update({
          wins: (wData?.wins ?? 0) + 1,
          points: (wData?.points ?? 0) + 12,
          season_wins: (wData?.season_wins ?? 0) + 1,
          level: computeLevelAfterWin(wData?.level ?? 1, (wData?.season_wins ?? 0) + 1),
          current_season: getCurrentSeason(),
        }).eq('id', winnerId),
        supabase.from('profiles').update({
          losses: (lData?.losses ?? 0) + 1,
          points: Math.max(0, (lData?.points ?? 0) + 4),
          season_losses: (lData?.season_losses ?? 0) + 1,
          current_season: getCurrentSeason(),
        }).eq('id', loserId),
      ])
      await Promise.all([
        supabase.rpc('log_earning', {
          p_user_id: winnerId, p_type: 'match_win', p_points: 12,
          p_description: `Beat ${(winnerId === match.challenger_id ? cd : ch)?.username ?? 'opponent'}`,
          p_ref_id: match.id,
        }),
        supabase.rpc('log_earning', {
          p_user_id: loserId, p_type: 'match_loss', p_points: 4,
          p_description: `Lost to ${(loserId === match.challenger_id ? cd : ch)?.username ?? 'opponent'}`,
          p_ref_id: match.id,
        }),
      ])
      if (user?.id === winnerId || user?.id === loserId) refreshProfile?.()
    }
    setSaving(false); loadMatch()
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
        supabase.rpc('log_earning', {
          p_user_id: opponentId, p_type: 'match_win', p_points: 12,
          p_description: `${me?.username ?? 'Opponent'} forfeited`,
          p_ref_id: match.id,
        }),
        supabase.rpc('log_earning', {
          p_user_id: user.id, p_type: 'match_loss', p_points: 4,
          p_description: 'Forfeit',
          p_ref_id: match.id,
        }),
      ])
      refreshProfile?.()
    }
    setForfeitLoading(false); loadMatch()
  }

  function formatDate(iso) {
    if (!iso) return 'TBD'
    return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const STATUS_COLOR = { live: '#22c55e', confirmed: 'var(--text)', pending: '#f59e0b', completed: 'var(--text-muted)', declined: '#ef4444', cancelled: '#ef4444' }

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
  const isActive = ['pending', 'confirmed', 'live'].includes(match.status)
  const isCompetitor = user && (user.id === match.challenger_id || user.id === match.challenged_id)
  const canManage = isAdmin || (user && tournament?.created_by === user.id)
  const statusColor = STATUS_COLOR[match.status] || 'var(--text-muted)'
  const chWon = isCompleted && match.winner_id === match.challenger_id
  const cdWon = isCompleted && match.winner_id === match.challenged_id
  const showScore = isLive || isCompleted

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
            {match.status?.toUpperCase()}
          </span>
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
                <UserBadges email={ch?.email} countryFlag={ch?.country_flag} isSeasonWinner={ch?.is_season_winner} size={12} gap={2} />
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
                <UserBadges email={cd?.email} countryFlag={cd?.country_flag} isSeasonWinner={cd?.is_season_winner} size={12} gap={2} />
                {cd?.username || '—'}
              </span>
              <span className={styles.sideMeta}>{cd?.tier} · Lv.{cd?.level ?? 1} · {cd?.wins ?? 0}W {cd?.losses ?? 0}L</span>
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
          {match.status === 'pending' && user?.id === match.challenged_id && (<>
            <button className={styles.btn} onClick={() => updateStatus('confirmed')} disabled={saving}>
              <i className="ri-check-line" /> Accept Match
            </button>
            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => updateStatus('declined')} disabled={saving}>
              <i className="ri-close-line" /> Decline
            </button>
          </>)}
          {isActive && match.status !== 'pending' && (
            <button className={`${styles.btn} ${styles.btnGhost}`} onClick={forfeitMatch} disabled={forfeitLoading}>
              <i className="ri-flag-line" /> {forfeitLoading ? 'Forfeiting…' : 'Forfeit Match'}
            </button>
          )}
        </div>
      )}

      {/* ── ADMIN PANEL ── */}
      {canManage && (
        <div className={styles.adminPanel}>
          <p className={styles.adminTitle}><i className="ri-shield-line" /> {isAdmin ? 'Admin Controls' : 'Organiser Controls'}</p>

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
            <label className={styles.adminLabel}>Set Result</label>
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
