'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../../lib/supabase'
import { matchupSlugMatches } from '../../../../../lib/matchSlug'
import { GAME_META } from '../../../../../lib/constants'
import { getTimeStatus } from '../../../../../lib/roundTimers'
import { useAuth } from '../../../../../components/AuthProvider'
import { useAuthGate } from '../../../../../components/AuthGateModal'
import styles from './page.module.css'

// This is the branded, shareable landing page for one specific matchup —
// e.g. /tournaments/summer-clash/matches/abi-vs-seti — used when a link to
// a single match needs to stand on its own (shared in a group chat, a
// player's bio, etc.) rather than just deep-linking into the full bracket.
// Read-only: it never writes to bracket_data. To actually submit or manage
// a result, people are sent into the real tournament page.

// ── Small local helpers (mirrors of tournaments/[slug]/page.js) ─────────
function initials(name) {
  return String(name || '?').trim().slice(0, 2).toUpperCase()
}

// A "slot" is either a solo player { userId, name, avatar, status } or a
// team { members, teamName, clanSquadImage, status }.
function slotDisplay(entry) {
  if (!entry) return { name: 'TBD', avatar: null }
  if (entry.members) {
    const realMembers = (entry.members || []).filter(m => m?.userId)
    const name = entry.teamName || realMembers.map(m => m.name.slice(0, 3)).join('').slice(0, 8) || (entry.status === 'bye' ? 'BYE' : 'TBD')
    return { name, avatar: entry.clanSquadImage || null }
  }
  return { name: entry.name || (entry.status === 'open' ? 'Open Slot' : '?'), avatar: entry.avatar || null }
}

function hashtagify(name) {
  return String(name || 'Nabogaming')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join('')
}

function getRoundLabelSimple(rIdx, totalRounds, bracketSize, customNames) {
  if (customNames?.[rIdx]) return customNames[rIdx]
  const fromEnd = (totalRounds - 2) - rIdx
  if (fromEnd === 0) return 'Final'
  if (fromEnd === 1) return 'Semi Final'
  if (fromEnd === 2) return 'Quarter Final'
  if (bracketSize >= 16 && fromEnd === 3) return 'Round of 16'
  if (bracketSize >= 32 && fromEnd === 4) return 'Round of 32'
  if (bracketSize >= 64 && fromEnd === 5) return 'Round of 64'
  return `Round ${rIdx + 1}`
}

export default function MatchupPage() {
  const { slug, matchup } = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const { openAuthGate } = useAuthGate()
  const [state, setState] = useState('loading') // loading | notfound | ready
  const [tournament, setTournament] = useState(null)
  const [match, setMatch] = useState(null) // normalized match object, see below
  const [menuOpen, setMenuOpen] = useState(false)
  const [following, setFollowing] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)
      const { data: t } = await (isUUID
        ? supabase.from('tournaments').select('*').eq('id', slug).single()
        : supabase.from('tournaments').select('*').eq('slug', slug).single()
      )
      if (cancelled) return
      if (!t) { setState('notfound'); return }

      let bd = t.bracket_data
      try { bd = typeof bd === 'string' ? JSON.parse(bd) : bd } catch { bd = null }
      if (!bd) { setState('notfound'); return }

      // ── Search group/league fixtures ──
      for (const group of bd.groups || []) {
        for (const fx of group.fixtures || []) {
          const home = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.homeId)
          const away = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.awayId)
          if (!matchupSlugMatches(matchup, home?.name, away?.name)) continue

          const subs = fx.submissions || {}
          setTournament(t)
          setMatch({
            kind: 'group',
            groupName: group.name,
            played: fx.status === 'played',
            disputed: !!fx.disputed,
            scheduleStatus: getTimeStatus(bd.match_schedule, `fx:${fx.id}`),
            sides: [
              {
                key: 'home', ...slotDisplay(home),
                score: fx.status === 'played' ? fx.scoreHome : null,
                submission: subs.home || null,
              },
              {
                key: 'away', ...slotDisplay(away),
                score: fx.status === 'played' ? fx.scoreAway : null,
                submission: subs.away || null,
              },
            ],
          })
          setState('ready')
          return
        }
      }

      // ── Search knockout pairs ──
      const totalRounds = bd.rounds?.length || 0
      for (let rIdx = 0; rIdx < totalRounds; rIdx++) {
        const pairs = bd.rounds[rIdx] || []
        for (let pIdx = 0; pIdx < pairs.length; pIdx++) {
          const [a, b] = pairs[pIdx] || []
          if (!a || !b) continue
          const dispA = slotDisplay(a)
          const dispB = slotDisplay(b)
          if (!matchupSlugMatches(matchup, dispA.name, dispB.name)) continue

          const decided = a.status === 'winner' || b.status === 'winner'
          const isFinal = rIdx === totalRounds - 1
          setTournament(t)
          setMatch({
            kind: 'knockout',
            groupName: getRoundLabelSimple(rIdx, totalRounds, bd.bracketSize, bd.round_names),
            nextRoundLabel: decided ? (isFinal ? null : getRoundLabelSimple(rIdx + 1, totalRounds, bd.bracketSize, bd.round_names)) : null,
            isFinal,
            played: decided,
            disputed: !!(a.disputed || b.disputed),
            scheduleStatus: getTimeStatus(bd.match_schedule, `ko:${rIdx}-${pIdx}`),
            sides: [
              {
                key: 'a', ...dispA,
                won: a.status === 'winner',
                submission: a.pendingSubmission || null,
              },
              {
                key: 'b', ...dispB,
                won: b.status === 'winner',
                submission: b.pendingSubmission || null,
              },
            ],
          })
          setState('ready')
          return
        }
      }

      setState('notfound')
    }

    if (slug && matchup) load()
    return () => { cancelled = true }
  }, [slug, matchup])

  // ── Follow-creator status ──
  useEffect(() => {
    let cancelled = false
    async function checkFollow() {
      if (!user || !tournament?.created_by || tournament.created_by === user.id) return
      const { data } = await supabase.from('follows').select('id').eq('follower_id', user.id).eq('following_id', tournament.created_by).maybeSingle()
      if (!cancelled) setFollowing(!!data)
    }
    checkFollow()
    return () => { cancelled = true }
  }, [user, tournament?.created_by])

  async function toggleFollow() {
    if (!user) { openAuthGate(); return }
    if (!tournament?.created_by || followLoading) return
    setFollowLoading(true)
    try {
      if (following) {
        await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', tournament.created_by)
        setFollowing(false)
      } else {
        await supabase.from('follows').insert({ follower_id: user.id, following_id: tournament.created_by })
        setFollowing(true)
      }
    } catch (e) { console.error('toggleFollow:', e) }
    setFollowLoading(false)
  }

  if (state === 'loading') {
    return (
      <div className={styles.centerState}>
        <i className="ri-loader-4-line" style={{ animation: 'spin 0.8s linear infinite' }} />
        <span>Loading match…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (state === 'notfound') {
    return (
      <div className={styles.centerState}>
        <i className="ri-error-warning-line" style={{ color: '#ef4444' }} />
        <span>We couldn't find that match</span>
        {slug && (
          <Link href={`/tournaments/${slug}`} className={styles.notfoundBtn}>
            View tournament
          </Link>
        )}
      </div>
    )
  }

  const { sides, played, disputed, groupName, scheduleStatus, kind, nextRoundLabel, isFinal } = match
  const [left, right] = sides
  const gameArt = GAME_META[tournament.game_slug]?.image
  const hasAnySubmission = sides.some(s => s.submission)

  // For knockout, score comes from whichever pendingSubmission exists —
  // a/b there are already normalized to slot0/slot1 at submit time.
  // For a decided (played) knockout match with no lingering submission on
  // file, there's no numeric score to show (knockout is win/lose), so the
  // score strip is skipped in favor of a simple "won" highlight.
  let leftScore = kind === 'group' ? left.score : null
  let rightScore = kind === 'group' ? right.score : null
  if (kind === 'knockout') {
    const anySub = left.submission || right.submission
    if (anySub) { leftScore = anySub.a; rightScore = anySub.b }
  }
  const showScoreStrip = leftScore != null && rightScore != null
  const leftWon = kind === 'knockout' ? left.won : (played && leftScore > rightScore)
  const rightWon = kind === 'knockout' ? right.won : (played && rightScore > leftScore)

  const statusLabel = disputed ? 'Disputed' : played ? 'Completed' : hasAnySubmission ? 'Awaiting review' : (scheduleStatus?.phase === 'live' || scheduleStatus?.phase === 'live-noend') ? 'Live' : 'Upcoming'
  const statusClass = disputed ? 'disputed' : played ? 'final' : (hasAnySubmission || scheduleStatus?.phase === 'live') ? 'live' : 'waiting'
  const statusIcon = disputed ? 'ri-error-warning-line' : played ? 'ri-trophy-line' : hasAnySubmission ? 'ri-time-line' : 'ri-hourglass-line'
  const winnerSide = leftWon ? left : rightWon ? right : null

  function shareLink() {
    const url = typeof window !== 'undefined' ? window.location.href : ''
    const text = `${left.name} vs ${right.name} — ${tournament.name}\n${url}`
    if (navigator.share) { navigator.share({ title: `${left.name} vs ${right.name}`, text, url }).catch(() => {}); return }
    navigator.clipboard?.writeText(url).catch(() => {})
  }

  return (
    <div className={styles.wrap}>
      {/* ── Custom header: back button + overflow menu trigger ── */}
      <div className={styles.headerBar}>
        <button className={styles.iconBtn} onClick={() => router.push(`/tournaments/${tournament.slug || slug}`)} aria-label="Back to tournament">
          <i className="ri-arrow-left-line" />
        </button>
        <button className={styles.iconBtn} onClick={() => setMenuOpen(true)} aria-label="More options">
          <i className="ri-more-2-fill" />
        </button>
      </div>

      <div className={styles.card}>
        {/* Arena backdrop: light rays + dot texture */}
        <div className={styles.arenaGlow} />
        <div className={styles.arenaDots} />
        {gameArt && <img src={gameArt} alt="" className={styles.heroArt} />}

        <div className={styles.cardInner}>
          {/* Brand mark */}
          <div className={styles.brandRow}>
            <img src="/logo-black.png" alt="" className={styles.brandMark} />
            <span className={styles.brandWord}>Nabogaming</span>
          </div>

          {/* Headline */}
          <h1 className={styles.headline}>{tournament.name}</h1>
          <div className={styles.roundRow}>
            <span className={styles.roundLine} />
            <span className={styles.roundLabel}>{groupName || 'Matchup'}</span>
            <span className={styles.roundLine} />
          </div>

          <span className={`${styles.statusChip} ${styles[statusClass]}`}>
            <i className={statusIcon} /> {statusLabel}
          </span>

          {/* Duel */}
          <div className={styles.duel}>
            <i className={`ri-trophy-fill ${styles.trophyWatermark}`} aria-hidden="true" />
            <Side side={left} played={played} won={leftWon} />
            <div className={styles.seam}>VS</div>
            <Side side={right} played={played} won={rightWon} />
          </div>

          {showScoreStrip ? (
            <div className={styles.scoreStrip}>
              <span className={`${styles.scoreNum} ${leftScore > rightScore ? styles.winner : ''}`}>{leftScore}</span>
              <span className={styles.scoreDash}>–</span>
              <span className={`${styles.scoreNum} ${rightScore > leftScore ? styles.winner : ''}`}>{rightScore}</span>
            </div>
          ) : (
            <div className={styles.awaitingLabel}>
              {disputed ? "Scores don't match — awaiting review" : played ? `${left.won ? left.name : right.name} won` : hasAnySubmission ? 'One side has submitted a result' : (scheduleStatus?.phase === 'upcoming' && scheduleStatus.start) ? `Plays at ${new Date(scheduleStatus.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Result not yet submitted'}
            </div>
          )}

          {/* Winner banner */}
          {winnerSide && (
            <div className={styles.winnerBanner}>
              <i className="ri-trophy-fill" />
              <div className={styles.winnerLabel}>Winner</div>
              <div className={styles.winnerName}>{winnerSide.name}</div>
              <div className={styles.advancesPill}>
                <i className="ri-arrow-right-double-line" />
                {isFinal ? 'Tournament Champion' : nextRoundLabel ? `Advances to ${nextRoundLabel}` : 'Advances to next round'}
                <i className="ri-arrow-left-double-line" />
              </div>
            </div>
          )}

          <div className={styles.footer}>
            <img src="/logo-black.png" alt="" className={styles.footerMark} />
            <span className={styles.footerSite}>nabogaming.live</span>
            <span className={styles.footerTag}>#{hashtagify(tournament.name)}</span>
          </div>
        </div>
      </div>

      {disputed && (
        <div className={styles.disputeBanner}>
          <i className="ri-error-warning-line" style={{ marginTop: 1 }} />
          <span>Both sides submitted different scores for this match. An organiser needs to review it before it's final.</span>
        </div>
      )}

      {/* ── Overflow menu: sidebar sliding in from the right ── */}
      {menuOpen && (
        <>
          <div className={styles.menuOverlay} onClick={() => setMenuOpen(false)} />
          <div className={styles.menuSheet}>
            <div className={styles.menuHeader}>
              <span>Options</span>
              <button className={styles.menuClose} onClick={() => setMenuOpen(false)} aria-label="Close">
                <i className="ri-close-line" />
              </button>
            </div>
            <button className={styles.menuItem} onClick={() => { shareLink(); setMenuOpen(false) }}>
              <i className="ri-share-line" /> Share
            </button>
            <Link href={`/tournaments/${tournament.slug || slug}`} className={styles.menuItem} onClick={() => setMenuOpen(false)}>
              <i className="ri-trophy-line" /> View Tournament
            </Link>
            <button className={styles.menuItem} onClick={toggleFollow} disabled={followLoading}>
              <i className={following ? 'ri-user-follow-fill' : 'ri-user-add-line'} /> {following ? 'Following Creator' : 'Follow Creator'}
            </button>
            <Link href="/tournaments/create" className={styles.menuItem} onClick={() => setMenuOpen(false)}>
              <i className="ri-add-circle-line" /> Create Your Tournament
            </Link>
          </div>
        </>
      )}
    </div>
  )
}

function Side({ side, played, won }) {
  const label = played
    ? (won ? <><i className="ri-trophy-line" /> Winner</> : side.submission ? <><i className="ri-check-line" /> Submitted</> : null)
    : (side.submission ? <><i className="ri-check-line" /> Submitted</> : null)
  return (
    <div className={styles.side}>
      <div className={`${styles.avatarRing} ${won ? styles.winner : ''}`}>
        {side.avatar ? <img src={side.avatar} alt="" /> : <span>{initials(side.name)}</span>}
        {won && <span className={styles.avatarBadge}><i className="ri-trophy-fill" /></span>}
      </div>
      <div className={styles.sideName}>{side.name}</div>
      {label && (
        <div className={`${styles.sideSub} ${(won || side.submission) ? styles.submitted : ''}`}>
          {label}
        </div>
      )}
    </div>
  )
}


