'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import styles from './page.module.css'
import { getCurrentSeason } from '../../lib/seasons'
import UserBadges from '../../components/UserBadges'
import usePageLoading from '../../components/usePageLoading'
import { GAME_SLUGS, GAME_META } from '../../lib/constants'

export default function Matches() {
  const { user } = useAuth()
  const { openAuthGate } = useAuthGate()
  const router = useRouter()

  // Top-level tabs — 'live' is public, 'mine' and 'tournament' need login
  const [mainTab, setMainTab] = useState('live')

  // Live & Open (public) state
  const [liveMatches, setLiveMatches] = useState([])
  const [loadingLive, setLoadingLive] = useState(true)
  const [gameFilter, setGameFilter] = useState('all')
  const [joiningId, setJoiningId] = useState(null)

  // My Matches state
  const [matches, setMatches] = useState([])
  const [loadingMine, setLoadingMine] = useState(true)
  const [filter, setFilter] = useState('all')

  // Tournament Matches state
  const [tournaments, setTournaments] = useState([])
  const [activeTournId, setActiveTournId] = useState(null)
  const [tournMatches, setTournMatches] = useState([])
  const [loadingTourn, setLoadingTourn] = useState(true)
  const [loadingTournMatches, setLoadingTournMatches] = useState(false)

  usePageLoading(
    (mainTab === 'live' && loadingLive) ||
    (mainTab === 'mine' && loadingMine)
  )

  // ── Load Live & Open matches — PUBLIC, no auth needed ──────────────
  useEffect(() => {
    if (mainTab === 'live') loadLiveMatches()
  }, [mainTab, gameFilter])

  async function loadLiveMatches() {
    setLoadingLive(true)
    let q = supabase
      .from('matches')
      .select('*, challenger:profiles!matches_challenger_id_fkey(username, tier, level, avatar_url, email, country_flag, is_season_winner, plan, plan_expires_at), challenged:profiles!matches_challenged_id_fkey(username, tier, level, avatar_url, email, country_flag, is_season_winner, plan, plan_expires_at)')
      .in('status', ['live', 'recruiting', 'confirmed'])
      .order('created_at', { ascending: false })
      .limit(60)
    if (gameFilter !== 'all') q = q.eq('game', gameFilter)
    const { data } = await q
    setLiveMatches(data || [])
    setLoadingLive(false)
  }

  // Anyone logged in can tap "Join" on an open recruiting match
  async function joinMatch(m) {
    if (!user) { openAuthGate(); return }
    if (m.challenger_id === user.id) return
    setJoiningId(m.id)
    const { error } = await supabase
      .from('matches')
      .update({ challenged_id: user.id, status: 'pending', recruiting: false, recruit_closed_at: new Date().toISOString() })
      .eq('id', m.id)
      .eq('recruiting', true) // guard against a race where two people tap join at once
      .is('challenged_id', null)
    setJoiningId(null)
    if (!error) router.push(`/matches/${m.slug || m.id}`)
    else loadLiveMatches() // someone beat them to it — refresh list
  }

  // ── Load My Matches ──────────────────────────────────────────────
  useEffect(() => {
    if (!user) { setLoadingMine(false); return }
    if (mainTab === 'mine') loadMyMatches()
  }, [user, filter, mainTab])

  async function loadMyMatches() {
    setLoadingMine(true)
    let q = supabase
      .from('matches')
      .select('*, challenger:profiles!matches_challenger_id_fkey(username, tier, level, avatar_url, email, country_flag, is_season_winner, plan, plan_expires_at), challenged:profiles!matches_challenged_id_fkey(username, tier, level, avatar_url, email, country_flag, is_season_winner, plan, plan_expires_at)')
      .or(`challenger_id.eq.${user.id},challenged_id.eq.${user.id}`)
      .order('scheduled_at', { ascending: true, nullsFirst: false })
    if (filter !== 'all') q = q.eq('status', filter)
    const { data } = await q
    setMatches(data || [])
    setLoadingMine(false)
  }

  // ── Load Tournament list for Tournament Matches tab ──────────────
  useEffect(() => {
    if (!user) { setLoadingTourn(false); return }
    if (mainTab === 'tournament') loadTournaments()
  }, [user, mainTab])

  async function loadTournaments() {
    setLoadingTourn(true)
    const [{ data: created }, { data: participated }] = await Promise.all([
      supabase.from('tournaments').select('id, name, status, slug, bracket_data').eq('created_by', user.id).order('created_at', { ascending: false }),
      supabase.from('tournament_participants').select('tournament_id, tournaments(id, name, status, slug, bracket_data)').eq('user_id', user.id),
    ])

    const createdList = created || []
    const participatedList = (participated || []).map(r => r.tournaments).filter(Boolean)

    const seen = new Set()
    const merged = []
    for (const t of [...createdList, ...participatedList]) {
      if (t && !seen.has(t.id)) { seen.add(t.id); merged.push(t) }
    }

    setTournaments(merged)
    const first = merged.find(t => t.bracket_data) || merged[0]
    if (first) {
      setActiveTournId(first.id)
      loadTournamentMatchups(first)
    }
    setLoadingTourn(false)
  }

  function loadTournamentMatchups(tourn) {
    setLoadingTournMatches(true)
    let bd = tourn.bracket_data
    if (typeof bd === 'string') { try { bd = JSON.parse(bd) } catch { bd = null } }
    if (!bd?.rounds) { setTournMatches([]); setLoadingTournMatches(false); return }

    const totalRounds = bd.rounds.length
    const matchups = []
    bd.rounds.slice(0, totalRounds - 1).forEach((pairs, rIdx) => {
      const fromEnd = (totalRounds - 1) - 1 - rIdx
      let roundLabel = `Round ${rIdx + 1}`
      if (fromEnd === 0) roundLabel = 'Final'
      else if (fromEnd === 1) roundLabel = 'Semi Final'
      else if (fromEnd === 2) roundLabel = 'Quarter Final'
      else if (bd.bracketSize >= 16 && fromEnd === 3) roundLabel = 'Round of 16'
      else if (bd.bracketSize >= 32 && fromEnd === 4) roundLabel = 'Round of 32'

      pairs.forEach((pair, pIdx) => {
        const [a, b] = pair
        const isBye = (!a || a?.status === 'bye') || (!b || b?.status === 'bye')
        matchups.push({ rIdx, pIdx, roundLabel, a, b, isBye, tournId: tourn.id, tournSlug: tourn.slug })
      })
    })

    setTournMatches(matchups)
    setLoadingTournMatches(false)
  }

  async function selectTournament(tourn) {
    setActiveTournId(tourn.id)
    const { data: fresh } = await supabase.from('tournaments').select('id, name, status, slug, bracket_data').eq('id', tourn.id).single()
    if (fresh) loadTournamentMatchups(fresh)
  }

  // ── Helpers ─────────────────────────────────────────────────────
  function formatDate(iso) {
    if (!iso) return 'TBD'
    const d = new Date(iso)
    const today = new Date()
    if (d.toDateString() === today.toDateString())
      return 'Today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const STATUS_COLOR = {
    live: '#22c55e', confirmed: 'var(--text)', pending: '#f59e0b',
    completed: 'var(--text-muted)', declined: '#ef4444', cancelled: '#ef4444',
    recruiting: '#3b82f6', awaiting_review: '#f59e0b',
  }

  // Group tournament matchups by round
  const byRound = {}
  tournMatches.forEach(m => {
    if (!byRound[m.roundLabel]) byRound[m.roundLabel] = []
    byRound[m.roundLabel].push(m)
  })

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Season {getCurrentSeason()}</p>
        <h1 className={styles.headline}>MATCHES</h1>
      </div>

      {/* ── Main Tabs ── */}
      <div className={styles.mainTabs}>
        <button
          className={`${styles.mainTab} ${mainTab === 'live' ? styles.mainTabActive : ''}`}
          onClick={() => setMainTab('live')}
        >
          <i className="ri-broadcast-line" /> Live & Open
        </button>
        <button
          className={`${styles.mainTab} ${mainTab === 'mine' ? styles.mainTabActive : ''}`}
          onClick={() => { if (!user) { openAuthGate(); return } setMainTab('mine') }}
        >
          <i className="ri-sword-line" /> My Matches
        </button>
        <button
          className={`${styles.mainTab} ${mainTab === 'tournament' ? styles.mainTabActive : ''}`}
          onClick={() => { if (!user) { openAuthGate(); return } setMainTab('tournament') }}
        >
          <i className="ri-node-tree" /> Tournament Matches
        </button>
      </div>

      {/* ══════════ LIVE & OPEN TAB — public, anyone can browse ══════════ */}
      {mainTab === 'live' && (
        <>
          <div className={styles.filters}>
            <button className={`${styles.pill} ${gameFilter === 'all' ? styles.pillActive : ''}`} onClick={() => setGameFilter('all')}>All Games</button>
            {GAME_SLUGS.map(g => (
              <button key={g} className={`${styles.pill} ${gameFilter === g ? styles.pillActive : ''}`} onClick={() => setGameFilter(g)}>
                {GAME_META[g]?.name || g}
              </button>
            ))}
          </div>

          {loadingLive ? (
            <div className={styles.empty} style={{ paddingTop: 40 }}>
              <i className="ri-loader-4-line" style={{ fontSize: 24, color: 'var(--text-muted)' }} />
              <p style={{ fontSize: 13, fontWeight: 500 }}>Loading…</p>
            </div>
          ) : liveMatches.length === 0 ? (
            <div className={styles.empty}>
              <i className="ri-broadcast-line" />
              <p>Nothing live right now</p>
              <span>Open matches and live games will show up here for everyone to see</span>
            </div>
          ) : (
            <div className={styles.list}>
              {liveMatches.map((m, i) => {
                const isLive = m.status === 'live'
                const isRecruiting = m.status === 'recruiting'
                const sc = STATUS_COLOR[m.status] || 'var(--text-muted)'
                const canJoin = isRecruiting && user?.id !== m.challenger_id

                return (
                  <div key={m.id}
                    className={`${styles.row} ${isLive ? styles.rowLive : ''}`}
                    onClick={() => !canJoin && router.push(`/matches/${m.slug || m.id}`)}>

                    <span className={styles.num}>{String(i + 1).padStart(2, '0')}</span>

                    <div className={styles.content}>
                      <div className={styles.players}>
                        <span className={styles.pname}>
                          {m.challenger?.username || '—'}
                          <UserBadges email={m.challenger?.email} plan={m.challenger?.plan} planExpiresAt={m.challenger?.plan_expires_at} countryFlag={m.challenger?.country_flag} isSeasonWinner={m.challenger?.is_season_winner} size={11} gap={2} />
                        </span>
                        <span className={styles.vs}>vs</span>
                        <span className={styles.pname}>
                          {isRecruiting ? <em style={{ color: 'var(--text-muted)', fontStyle: 'normal' }}>Open slot</em> : (m.challenged?.username || '—')}
                          {!isRecruiting && <UserBadges email={m.challenged?.email} plan={m.challenged?.plan} planExpiresAt={m.challenged?.plan_expires_at} countryFlag={m.challenged?.country_flag} isSeasonWinner={m.challenged?.is_season_winner} size={11} gap={2} />}
                        </span>
                      </div>
                      <div className={styles.meta}>
                        {m.game && <span><i className={GAME_META[m.game]?.icon} style={{ marginRight: 3 }} />{GAME_META[m.game]?.name || m.game}</span>}
                        {(m.game_mode || m.format) && <span>{m.game_mode || m.format}</span>}
                        {isRecruiting && m.recruit_message && <span>"{m.recruit_message}"</span>}
                        {!isRecruiting && <span>{formatDate(m.scheduled_at)}</span>}
                      </div>
                    </div>

                    <div className={styles.right}>
                      <span className={styles.status} style={{ color: sc }}>
                        {isLive && <span className={styles.liveDot} />}
                        {isRecruiting ? 'OPEN' : m.status?.toUpperCase()}
                      </span>
                    </div>

                    {canJoin ? (
                      <button
                        className={styles.joinBtn}
                        disabled={joiningId === m.id}
                        onClick={(e) => { e.stopPropagation(); joinMatch(m) }}
                      >
                        {joiningId === m.id ? '…' : 'Join'}
                      </button>
                    ) : (
                      <i className="ri-arrow-right-s-line" style={{ color: 'var(--text-muted)', fontSize: 18, flexShrink: 0 }} />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ══════════ MY MATCHES TAB ══════════ */}
      {mainTab === 'mine' && user && (
        <>
          <div className={styles.filters}>
            {['all', 'pending', 'recruiting', 'confirmed', 'live', 'awaiting_review', 'completed'].map(f => (
              <button key={f} className={`${styles.pill} ${filter === f ? styles.pillActive : ''}`}
                onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'awaiting_review' ? 'In Review' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {!loadingMine && matches.length === 0 && (
            <div className={styles.empty}>
              <i className="ri-sword-line" />
              <p>No matches yet</p>
              <span>Challenge someone from the Players page</span>
            </div>
          )}

          <div className={styles.list}>
            {!loadingMine && matches.map((m, i) => {
              const isLive = m.status === 'live'
              const isCompleted = m.status === 'completed'
              const myTurn = m.status === 'pending' && m.challenged_id === user?.id
              const needsMyScore = m.status === 'awaiting_review'
              const chWon = isCompleted && m.winner_id === m.challenger_id
              const cdWon = isCompleted && m.winner_id === m.challenged_id
              const sc = STATUS_COLOR[m.status] || 'var(--text-muted)'

              return (
                <div key={m.id}
                  className={`${styles.row} ${isLive ? styles.rowLive : ''} ${myTurn || needsMyScore ? styles.rowMyTurn : ''}`}
                  onClick={() => router.push(`/matches/${m.slug || m.id}`)}>

                  <span className={styles.num}>{String(i + 1).padStart(2, '0')}</span>

                  <div className={styles.content}>
                    <div className={styles.players}>
                      <span className={`${styles.pname} ${chWon ? styles.pnameWon : ''} ${isCompleted && !chWon && m.winner_id ? styles.pnameLost : ''}`}>
                        {m.challenger?.username || '—'}
                        <UserBadges email={m.challenger?.email} plan={m.challenger?.plan} planExpiresAt={m.challenger?.plan_expires_at} countryFlag={m.challenger?.country_flag} isSeasonWinner={m.challenger?.is_season_winner} size={11} gap={2} />
                      </span>
                      <span className={styles.vs}>vs</span>
                      <span className={`${styles.pname} ${cdWon ? styles.pnameWon : ''} ${isCompleted && !cdWon && m.winner_id ? styles.pnameLost : ''}`}>
                        {m.challenged?.username || '—'}
                        <UserBadges email={m.challenged?.email} plan={m.challenged?.plan} planExpiresAt={m.challenged?.plan_expires_at} countryFlag={m.challenged?.country_flag} isSeasonWinner={m.challenged?.is_season_winner} size={11} gap={2} />
                      </span>
                      {isCompleted && m.score_challenger != null && (
                        <span className={styles.score}>{m.score_challenger} – {m.score_challenged}</span>
                      )}
                    </div>
                    <div className={styles.meta}>
                      {m.game && <span><i className={GAME_META[m.game]?.icon} style={{ marginRight: 3 }} />{GAME_META[m.game]?.name || m.game}</span>}
                      {(m.game_mode || m.format) && <span>{m.game_mode || m.format}</span>}
                      {m.challenger?.tier && m.challenged?.tier && <span>{m.challenger.tier} vs {m.challenged.tier}</span>}
                      <span>{formatDate(m.scheduled_at)}</span>
                    </div>
                  </div>

                  <div className={styles.right}>
                    <span className={styles.status} style={{ color: sc }}>
                      {isLive && <span className={styles.liveDot} />}
                      {m.status === 'awaiting_review' ? 'IN REVIEW' : m.status?.toUpperCase()}
                    </span>
                    {myTurn && <span className={styles.turnBadge}>Your turn</span>}
                    {needsMyScore && <span className={styles.turnBadge}>Submit score</span>}
                  </div>

                  <i className="ri-arrow-right-s-line" style={{ color: 'var(--text-muted)', fontSize: 18, flexShrink: 0 }} />
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ══════════ TOURNAMENT MATCHES TAB ══════════ */}
      {mainTab === 'tournament' && user && (
        <>
          {loadingTourn ? (
            <div className={styles.empty} style={{ paddingTop: 40 }}>
              <i className="ri-loader-4-line" style={{ fontSize: 24, color: 'var(--text-muted)' }} />
              <p style={{ fontSize: 13, fontWeight: 500 }}>Loading…</p>
            </div>
          ) : tournaments.length === 0 ? (
            <div className={styles.empty}>
              <i className="ri-node-tree" />
              <p>No tournaments</p>
              <span>Join or create a tournament to see bracket matches here</span>
            </div>
          ) : (
            <>
              <div className={styles.tournPills}>
                {tournaments.map(t => (
                  <button
                    key={t.id}
                    className={`${styles.tournPill} ${activeTournId === t.id ? styles.tournPillActive : ''}`}
                    onClick={() => selectTournament(t)}
                  >
                    <span className={styles.tournPillDot} style={{
                      background: t.status === 'active' ? '#22c55e' : t.status === 'completed' ? '#f59e0b' : 'var(--text-muted)'
                    }} />
                    {t.name}
                  </button>
                ))}
              </div>

              {loadingTournMatches ? (
                <div className={styles.list} style={{ marginTop: 16 }}>
                  {[1,2,3].map(i => (
                    <div key={i} className={styles.row} style={{ pointerEvents: 'none', opacity: 0.4 }}>
                      <div className={styles.content}>
                        <div style={{ height: 14, borderRadius: 6, background: 'var(--surface-raised)', width: '50%', marginBottom: 6 }} />
                        <div style={{ height: 10, borderRadius: 6, background: 'var(--surface-raised)', width: '30%' }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : tournMatches.length === 0 ? (
                <div className={styles.empty} style={{ paddingTop: 40 }}>
                  <i className="ri-node-tree" />
                  <p>No bracket yet</p>
                  <span>The bracket hasn't been generated for this tournament</span>
                </div>
              ) : (
                <div className={styles.tournMatchList}>
                  {Object.entries(byRound).map(([roundLabel, matchups]) => (
                    <div key={roundLabel} className={styles.tournRoundGroup}>
                      <div className={styles.tournRoundLabel}>
                        <i className="ri-git-branch-line" /> {roundLabel}
                      </div>
                      {matchups.map(({ rIdx, pIdx, a, b, isBye }) => {
                        const aWon = a?.status === 'winner'
                        const bWon = b?.status === 'winner'
                        const aOut = a?.status === 'eliminated' || a?.status === 'disqualified'
                        const bOut = b?.status === 'eliminated' || b?.status === 'disqualified'

                        let statusLabel = 'Pending'
                        let statusColor = 'var(--text-muted)'
                        if (isBye) { statusLabel = 'BYE' }
                        else if (aWon || bWon) { statusLabel = 'Done'; statusColor = '#22c55e' }

                        const aName = a?.name || (isBye && !a?.userId ? 'BYE' : '—')
                        const bName = b?.name || (isBye && !b?.userId ? 'BYE' : '—')

                        return (
                          <div key={`${rIdx}-${pIdx}`} className={`${styles.row} ${isBye ? styles.tournRowBye : ''}`}
                            style={{ cursor: 'default', alignItems: 'flex-start' }}>

                            <span className={styles.num}>{String(pIdx + 1).padStart(2, '0')}</span>

                            <div className={styles.content}>
                              <div className={styles.players}>
                                <span className={`${styles.pname} ${aWon ? styles.pnameWon : ''} ${aOut ? styles.pnameLost : ''}`}>
                                  {aName}
                                  {aWon && <i className="ri-arrow-right-circle-fill" style={{ color: '#f59e0b', fontSize: 11 }} />}
                                </span>
                                <span className={styles.vs}>vs</span>
                                <span className={`${styles.pname} ${bWon ? styles.pnameWon : ''} ${bOut ? styles.pnameLost : ''}`}>
                                  {bName}
                                  {bWon && <i className="ri-arrow-right-circle-fill" style={{ color: '#f59e0b', fontSize: 11 }} />}
                                </span>
                              </div>
                              <div className={styles.meta}>
                                <span>Match {pIdx + 1}</span>
                              </div>
                            </div>

                            <div className={styles.right}>
                              <span className={styles.status} style={{ color: statusColor }}>
                                {statusLabel}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
