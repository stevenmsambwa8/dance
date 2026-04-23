'use client'
import { getCurrentSeason, computeLevelAfterWin } from '@/lib/seasons'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '../../../components/AuthProvider'
import { supabase } from '../../../lib/supabase'
import { GAME_META } from '../../../lib/constants'
import styles from './page.module.css'
import UserBadges from '../../../components/UserBadges'
import usePageLoading from '../../../components/usePageLoading'

const ADMIN_EMAIL = 'stevenmsambwa8@gmail.com'

// ─── Pure helpers ────────────────────────────────────────────────────────────

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
}
function parsePrize(raw) {
  if (!raw) return null
  const n = Number(String(raw).replace(/[^0-9.]/g, ''))
  return isNaN(n) || n <= 0 ? null : n
}
function fmtTZS(n) { return `TZS ${Number(n).toLocaleString('en-TZ')}` }

/** Smallest power-of-2 >= n */
function nextPow2(n) {
  let s = 1; while (s < n) s *= 2; return s
}

function getRoundLabelSimple(rIdx, totalRounds, bracketSize) {
  const fromEnd = (totalRounds - 2) - rIdx   // 0=Final,1=Semi,2=QF,...
  if (fromEnd === 0) return 'Final'
  if (fromEnd === 1) return 'Semi Final'
  if (fromEnd === 2) return 'Quarter Final'
  if (bracketSize >= 16 && fromEnd === 3) return 'Round of 16'
  if (bracketSize >= 32 && fromEnd === 4) return 'Round of 32'
  if (bracketSize >= 64 && fromEnd === 5) return 'Round of 64'
  return `Round ${rIdx + 1}`
}
function getRoundLabel(rIdx, totalRounds, bracketSize) {
  if (rIdx === totalRounds - 1) return 'Champion'
  return getRoundLabelSimple(rIdx, totalRounds, bracketSize)
}

/**
 * Build a proper single-elimination bracket from a list of participants.
 *
 * Rules:
 *  - Size is always the next power-of-2 >= participant count.
 *  - Real players fill the first slots; BYE pads are appended at the end
 *    so BYEs are concentrated in early pairs at the bottom, not scattered.
 *  - A BYE match is one where BOTH slots hold a real player vs a BYE — the
 *    real player auto-advances; the bracket displays it transparently.
 *  - If the slot count exactly equals a power-of-2 (e.g. 32 players → 32
 *    slots) there are zero BYEs and nothing needs padding.
 */
function buildBracket(parts) {
  if (!parts || parts.length < 2) return null
  const size = nextPow2(parts.length)
  const byeCount = size - parts.length

  // Shuffle players randomly for seeding
  const shuffled = [...parts].sort(() => Math.random() - 0.5)
  const playerSlots = shuffled.map(p => ({
    userId: p.user_id,
    name: p.profiles?.username || '?',
    avatar: p.profiles?.avatar_url || null,
    status: 'active',
  }))

  // Pad with BYEs at the END so all real matchups are at the top
  for (let i = 0; i < byeCount; i++) {
    playerSlots.push({ userId: null, name: 'BYE', avatar: null, status: 'bye' })
  }

  // Build round-0 pairs
  const rounds = []
  let current = playerSlots
  while (current.length > 1) {
    const pairs = []
    for (let i = 0; i < current.length; i += 2) {
      pairs.push([{ ...current[i] }, { ...current[i + 1] }])
    }
    rounds.push(pairs)
    // Subsequent rounds start as pending — admin explicitly passes players
    current = pairs.map(() => ({ userId: null, name: '?', avatar: null, status: 'pending' }))
  }
  // Champion slot
  rounds.push([[{ userId: null, name: 'TBD', avatar: null, status: 'pending' }, null]])

  return { rounds, bracketSize: size, byeCount }
}

/**
 * Build an empty "lobby" bracket for a tournament that hasn't started yet.
 * All slots show as open so users can click to join.
 * Size is locked to the tournament's configured slot count (not power-of-2)
 * so it displays correctly before the admin generates the real bracket.
 */
function buildLobbyBracket(maxSlots) {
  if (!maxSlots || maxSlots < 2) return null
  const size = nextPow2(maxSlots)
  const open = Array.from({ length: size }, () => ({
    userId: null, name: 'Open', avatar: null, status: 'open',
  }))
  const rounds = []
  let current = open
  while (current.length > 1) {
    const pairs = []
    for (let i = 0; i < current.length; i += 2) {
      pairs.push([{ ...current[i] }, { ...current[i + 1] }])
    }
    rounds.push(pairs)
    current = pairs.map(() => ({ userId: null, name: '?', avatar: null, status: 'pending' }))
  }
  rounds.push([[{ userId: null, name: 'TBD', avatar: null, status: 'pending' }, null]])
  return { rounds, bracketSize: size, isEmpty: true }
}

function parseBracketData(raw) {
  if (!raw) return null
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch { return null }
}

function computeMVP(bracketData, participants) {
  if (!bracketData?.rounds || !participants?.length) return null
  const wins = {}
  const totalRounds = bracketData.rounds.length
  bracketData.rounds.slice(0, totalRounds - 1).forEach(pairs => {
    pairs.forEach(pair => {
      pair.forEach(slot => {
        if (slot?.userId && slot.status === 'winner') wins[slot.userId] = (wins[slot.userId] || 0) + 1
      })
    })
  })
  if (!Object.keys(wins).length) return null
  const [topId, topWins] = Object.entries(wins).sort((a, b) => b[1] - a[1])[0]
  const p = participants.find(p => p.user_id === topId)
  return { userId: topId, wins: topWins, username: p?.profiles?.username || '?', avatar: p?.profiles?.avatar_url || null }
}

function getPlayerBracketStatus(userId, bracketData) {
  if (!bracketData?.rounds || !userId) return null
  const totalRounds = bracketData.rounds.length
  let found = false, out = false
  bracketData.rounds.slice(0, totalRounds - 1).forEach(pairs => {
    pairs.forEach(pair => {
      pair.forEach(slot => {
        if (slot?.userId !== userId) return
        found = true
        if (slot.status === 'eliminated' || slot.status === 'disqualified') out = true
      })
    })
  })
  bracketData.rounds[totalRounds - 1]?.forEach(pair => {
    pair.forEach(slot => { if (slot?.userId === userId) found = true })
  })
  if (!found) return null
  return out ? 'out' : 'in'
}

function buildMatchHistory(userId, bracketData) {
  if (!bracketData?.rounds || !userId) return []
  const history = []
  const totalRounds = bracketData.rounds.length
  bracketData.rounds.slice(0, totalRounds - 1).forEach((pairs, rIdx) => {
    pairs.forEach(pair => {
      const me = pair.find(s => s?.userId === userId)
      const opp = pair.find(s => s?.userId !== userId)
      if (!me) return
      history.push({
        round: getRoundLabelSimple(rIdx, totalRounds, bracketData.bracketSize),
        opponentName: opp?.name || 'BYE',
        status: me.status,
      })
    })
  })
  return history
}

function buildShareText(tournament, rankedLeaderboard) {
  const lines = [`🏆 ${tournament.name}`]
  if (tournament.date) lines.push(`📅 ${tournament.date}`)
  lines.push('', 'STANDINGS', '─────────────────')
  rankedLeaderboard.forEach((e, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${e.position}`
    const pts = e.points > 0 ? ` · ${e.points} pts` : ''
    lines.push(`${medal} ${e.profiles?.username || '—'}${pts}`)
  })
  lines.push('', 'Generated via Nabogaming App')
  return lines.join('\n')
}

function buildBracketShareText(tournament, bracketData, participants) {
  if (!bracketData?.rounds) return ''
  const lines = [`🏆 ${tournament.name} — Bracket`, '']
  const totalRounds = bracketData.rounds.length
  bracketData.rounds.slice(0, totalRounds - 1).forEach((pairs, rIdx) => {
    const label = getRoundLabelSimple(rIdx, totalRounds, bracketData.bracketSize)
    lines.push(`── ${label} ──`)
    pairs.forEach((pair) => {
      const [a, b] = pair
      const aName = a?.name || '?'
      const bName = b?.name || (b?.status === 'bye' ? 'BYE' : '?')
      const aStatus = a?.status === 'winner' ? ' ✅' : a?.status === 'eliminated' ? ' ❌' : ''
      const bStatus = b?.status === 'winner' ? ' ✅' : b?.status === 'eliminated' ? ' ❌' : ''
      lines.push(`  ${aName}${aStatus} vs ${bName}${bStatus}`)
    })
    lines.push('')
  })
  lines.push('Generated via Nabogaming')
  return lines.join('\n')
}

// ─── Points model ─────────────────────────────────────────────────────────────

function getRoundPts(rIdx, totalRounds) {
  // fromEnd: 0=Final, 1=Semi, 2=QF, 3=R16, 4+=earlier
  const fromEnd = (totalRounds - 2) - rIdx
  return {
    winnerPts: fromEnd === 0 ? 55 : fromEnd === 1 ? 35 : fromEnd === 2 ? 18 : fromEnd === 3 ? 10 : 8,
    loserPts:  fromEnd === 0 ? 35 : fromEnd === 1 ? 18 : fromEnd === 2 ? 10 : fromEnd === 3 ? 6  : 4,
  }
}

// ─── FIX #1: PlayerSide extracted to module scope (was defined inside .map()) ─
// isBye is now passed as an explicit prop instead of captured from outer scope.

function PlayerSide({ entry, profile, won, lost, side, isBye }) {
  const name = profile?.username || entry?.name || (entry?.status === 'open' ? 'Open' : '?')
  const isPending = !entry?.userId && !isBye
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: side === 'left' ? 'flex-start' : 'flex-end',
      gap: 5,
      opacity: lost ? 0.38 : 1,
      minWidth: 0,
    }}>
      {/* Avatar */}
      <div style={{
        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
        background: won ? 'rgba(245,158,11,0.15)' : 'var(--surface)',
        border: won ? '2px solid #f59e0b' : '1.5px solid var(--border-dark)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', fontSize: 12, fontWeight: 800, color: 'var(--text-dim)',
      }}>
        {profile?.avatar_url
          ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : isPending
            ? <i className="ri-question-mark" style={{ fontSize: 14, color: 'var(--text-muted)' }} />
            : <span>{name.slice(0, 2).toUpperCase()}</span>
        }
      </div>
      {/* Name */}
      <span style={{
        fontSize: 12, fontWeight: won ? 800 : 600,
        color: won ? '#f59e0b' : isPending ? 'var(--text-muted)' : 'var(--text)',
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textAlign: side === 'left' ? 'left' : 'right',
      }}>
        {name}
      </span>
      {/* Badges */}
      {profile && <UserBadges email={profile.email} countryFlag={profile.country_flag} isSeasonWinner={profile.is_season_winner} size={10} gap={2} />}
      {/* Winner tag */}
      {won && <span style={{ fontSize: 9, fontWeight: 800, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', padding: '2px 6px', borderRadius: 5, letterSpacing: '0.06em' }}>WINNER</span>}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TournamentDetail() {
  const { slug } = useParams()
  const router = useRouter()
  const { user, isAdmin } = useAuth()

  const [id, setId] = useState(null)
  const [tournament, setTournament] = useState(null)
  const [participants, setParticipants] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [bracketData, setBracketData] = useState(null)
  const [registered, setRegistered] = useState(false)

  const [loadingTournament, setLoadingTournament] = useState(true)
  const [loadingParticipants, setLoadingParticipants] = useState(true)
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(true)
  usePageLoading(loadingTournament)

  const [registering, setRegistering] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [bracketSaving, setBracketSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('bracket')
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [showAdminPanel, setShowAdminPanel] = useState(false)
  const [historyModal, setHistoryModal] = useState(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [bracketShareCopied, setBracketShareCopied] = useState(false)
  const [lbActionMenu, setLbActionMenu] = useState(null)
  const [lbEntry, setLbEntry] = useState({ userId: '', points: '', position: '' })
  const [lbUpdating, setLbUpdating] = useState(false)
  const [confirmModal, setConfirmModal] = useState(null)
  const [toast, setToast] = useState(null)
  const [prizeDistribOpen, setPrizeDistribOpen] = useState(false)
  const [prizeDistrib, setPrizeDistrib] = useState({})
  const [prizeDistribSaving, setPrizeDistribSaving] = useState(false)

  // ── Per-pair score state for Matches tab ─────────────────────────────────
  // scoreMap[`${rIdx}-${pIdx}`] = { a: string, b: string }
  const [scoreMap, setScoreMap]       = useState({})
  const [scoreSaving, setScoreSaving] = useState(null)  // key being saved

  // ── Entrance fee payment ──────────────────────────────────────────────────
  const [paymentStatus, setPaymentStatus] = useState(null)
  const [showPayModal, setShowPayModal]   = useState(false)
  const [payRef, setPayRef]               = useState('')
  const [payPhone, setPayPhone]           = useState('')
  const [payLoading, setPayLoading]       = useState(false)
  const [payErr, setPayErr]               = useState('')
  const [testTimeLeft, setTestTimeLeft]   = useState(null) // ms remaining for test tournament

  const toastTimer   = useRef(null)
  const testExpireTimer = useRef(null)

  function showToast(text, type = 'error') {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, type })
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }

  // ── Data loading ─────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoadingTournament(true)
    setLoadingParticipants(true)
    setLoadingLeaderboard(true)

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)
    const { data: t } = await (isUUID
      ? supabase.from('tournaments').select('*').eq('id', slug).single()
      : supabase.from('tournaments').select('*').eq('slug', slug).single()
    )

    if (!t) { setLoadingTournament(false); return }

    setId(t.id)
    setTournament(t)
    setEditForm(t)
    setBracketData(parseBracketData(t.bracket_data) ?? (t.slots >= 2 ? buildLobbyBracket(t.slots) : null))
    setLoadingTournament(false)

    const [partsRes, lbRes] = await Promise.all([
      supabase.from('tournament_participants')
        .select('*, profiles(username, avatar_url, email, country_flag, is_season_winner)')
        .eq('tournament_id', t.id),
      supabase.from('tournament_leaderboard')
        .select('*, profiles(username, avatar_url, email, country_flag, is_season_winner)')
        .eq('tournament_id', t.id)
        .order('position', { ascending: true }),
    ])

    setParticipants(partsRes.data || [])
    setLoadingParticipants(false)
    setLeaderboard(lbRes.data || [])
    setLoadingLeaderboard(false)

    if (user) {
      const { data: reg } = await supabase
        .from('tournament_participants')
        .select('tournament_id')
        .eq('tournament_id', t.id)
        .eq('user_id', user.id)
        .maybeSingle()
      setRegistered(!!reg)

      // Load entrance-fee payment status
      if ((t.entrance_fee || 0) > 0) {
        const { data: pmt } = await supabase
          .from('tournament_payments')
          .select('status')
          .eq('tournament_id', t.id)
          .eq('user_id', user.id)
          .maybeSingle()
        setPaymentStatus(pmt?.status ?? null)
      }
    }
  }, [slug, user])

  useEffect(() => { if (slug) load() }, [load])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  // ── Live countdown display for test tournament ───────────────────────────
  useEffect(() => {
    if (!tournament?.is_test || !tournament?.created_at) { setTestTimeLeft(null); return }
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000
    const tick = () => {
      const elapsed = Date.now() - new Date(tournament.created_at).getTime()
      setTestTimeLeft(Math.max(0, THREE_HOURS_MS - elapsed))
    }
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [tournament?.is_test, tournament?.created_at])

  // ── Auto-delete test tournaments after 3 hours ─────────────────────────────
  useEffect(() => {
    if (!tournament?.is_test || !tournament?.created_at || !id) return
    if (testExpireTimer.current) clearTimeout(testExpireTimer.current)

    const THREE_HOURS_MS = 3 * 60 * 60 * 1000
    const createdAt = new Date(tournament.created_at).getTime()
    const elapsed   = Date.now() - createdAt
    const remaining = THREE_HOURS_MS - elapsed

    async function autoDelete() {
      // silently delete all related data then redirect
      await supabase.from('tournament_leaderboard').delete().eq('tournament_id', id)
      await supabase.from('tournament_participants').delete().eq('tournament_id', id)
      await supabase.from('tournament_payments').delete().eq('tournament_id', id)
      await supabase.from('tournaments').delete().eq('id', id)
      router.replace('/tournaments')
    }

    if (remaining <= 0) {
      // Already expired — delete immediately
      autoDelete()
    } else {
      testExpireTimer.current = setTimeout(autoDelete, remaining)
    }

    return () => { if (testExpireTimer.current) clearTimeout(testExpireTimer.current) }
  }, [tournament?.is_test, tournament?.created_at, id])

  // ── Realtime subscriptions ─────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return
    const ch = supabase
      .channel(`tournament-main-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tournaments', filter: `id=eq.${id}` }, payload => {
        const t = payload.new
        setTournament(t)
        setBracketData(parseBracketData(t.bracket_data) ?? (t.slots >= 2 ? buildLobbyBracket(t.slots) : null))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_participants', filter: `tournament_id=eq.${id}` }, () => {
        supabase.from('tournament_participants')
          .select('*, profiles(username, avatar_url, email, country_flag, is_season_winner)')
          .eq('tournament_id', id)
          .then(({ data }) => { if (data) setParticipants(data) })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_leaderboard', filter: `tournament_id=eq.${id}` }, () => {
        supabase.from('tournament_leaderboard')
          .select('*, profiles(username, avatar_url, email, country_flag, is_season_winner)')
          .eq('tournament_id', id)
          .order('position', { ascending: true })
          .then(({ data }) => { if (data) setLeaderboard(data) })
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [id])

  // ── Utility helpers ───────────────────────────────────────────────────────

  async function syncCount() {
    const { count } = await supabase
      .from('tournament_participants')
      .select('*', { count: 'exact', head: true })
      .eq('tournament_id', id)
    if (count !== null) await supabase.from('tournaments').update({ registered_count: count }).eq('id', id)
    return count ?? 0
  }

  async function sendNotification(userId, title, body, type = 'tournament', meta = null) {
    if (!userId) return
    try {
      await supabase.from('notifications').insert({
        user_id: userId, title, body: body || null, type, meta: meta || null, read: false,
      })
    } catch (e) { console.error('sendNotification:', e) }
  }

  async function awardBracketPoints(userId, points) {
    if (!userId || points <= 0) return
    // Upsert tournament leaderboard
    const { data: ex } = await supabase.from('tournament_leaderboard').select('id, points').eq('tournament_id', id).eq('user_id', userId).maybeSingle()
    if (ex) {
      await supabase.from('tournament_leaderboard').update({ points: (ex.points || 0) + points }).eq('id', ex.id)
    } else {
      await supabase.from('tournament_leaderboard').insert({ tournament_id: id, user_id: userId, points, position: 99 })
    }
    // Always update global profile points — try RPC first, then manual fallback unconditionally
    const { error: rpcErr } = await supabase.rpc('increment_points', { uid: userId, amount: points })
    if (rpcErr) {
      const { data: p } = await supabase.from('profiles').select('points').eq('id', userId).maybeSingle()
      if (p) await supabase.from('profiles').update({ points: Math.max(0, (p.points || 0) + points) }).eq('id', userId)
    }
  }

  async function awardAchievement(userId, icon, label, description) {
    if (!userId) return
    // Only insert if not already unlocked
    const { data: existing } = await supabase
      .from('achievements')
      .select('id')
      .eq('user_id', userId)
      .eq('label', label)
      .maybeSingle()
    if (existing) return // already has it
    await supabase.from('achievements').insert({
      user_id: userId,
      icon,
      label,
      description,
      unlocked_at: new Date().toISOString(),
    })
  }

  async function recalcPositions() {
    const { error } = await supabase.rpc('recalc_tournament_positions', { p_tournament_id: id })
    if (error) {
      const { data: entries } = await supabase
        .from('tournament_leaderboard').select('id, points').eq('tournament_id', id).order('points', { ascending: false })
      if (!entries) return
      let pos = 1
      await Promise.all(entries.map((entry, i) => {
        if (i > 0 && entries[i].points < entries[i - 1].points) pos = i + 1
        return supabase.from('tournament_leaderboard').update({ position: pos }).eq('id', entry.id)
      }))
    }
  }

  async function saveBracket(newBd) {
    setBracketSaving(true)
    await supabase.from('tournaments').update({ bracket_data: newBd }).eq('id', id)
    setBracketSaving(false)
  }

  // ── FIX #2 & #3: isFull declared early so it's available to joinViaSlot
  // and rankedLeaderboard is computed before any early returns so it's
  // always defined (with a safe empty fallback) regardless of render path. ──

  const realCount = participants.length
  const isFull = !!(tournament?.slots) && realCount >= tournament.slots

  // Bracket-aware ranking: deepest bracket round reached beats raw points
  const rankedLeaderboard = (() => {
    if (!tournament) return []
    const lbMap = {}
    leaderboard.forEach(e => { lbMap[e.user_id] = e })
    const full = participants.map(p => ({
      user_id: p.user_id,
      id: lbMap[p.user_id]?.id || null,
      points: lbMap[p.user_id]?.points || 0,
      profiles: p.profiles,
      lbEntry: lbMap[p.user_id] || null,
    }))

    function getBracketTier(userId) {
      if (!bracketData?.rounds || !userId) return 99
      const totalRounds = bracketData.rounds.length
      const champRound = bracketData.rounds[totalRounds - 1]
      const inChamp = champRound?.some(pair => pair?.some(s =>
        s?.userId === userId && s.status !== 'eliminated' && s.status !== 'disqualified' && s.status !== 'bye'
      ))
      if (inChamp) return 0
      for (let rIdx = totalRounds - 2; rIdx >= 0; rIdx--) {
        const fromEnd = (totalRounds - 2) - rIdx
        const appeared = bracketData.rounds[rIdx]?.some(pair => pair?.some(s => s?.userId === userId && s.status !== 'bye'))
        if (appeared) return fromEnd + 1
      }
      return 99
    }

    full.forEach(e => { e._tier = getBracketTier(e.user_id) })
    full.sort((a, b) => a._tier !== b._tier ? a._tier - b._tier : b.points - a.points)
    let pos = 1
    full.forEach((e, i) => {
      if (i > 0 && (e._tier !== full[i - 1]._tier || e.points !== full[i - 1].points)) pos = i + 1
      e.position = pos
    })
    return full
  })()

  // ── Registration ──────────────────────────────────────────────────────────

  // ── Submit entrance-fee payment proof ────────────────────────────────────
  async function submitPayment() {
    if (!payRef.trim() && !payPhone.trim()) { setPayErr('Enter your transaction ID or phone number'); return }
    setPayLoading(true); setPayErr('')
    const fee = tournament.entrance_fee

    const { data: existing } = await supabase
      .from('tournament_payments').select('id,status')
      .eq('tournament_id', id).eq('user_id', user.id).maybeSingle()

    if (existing?.status === 'approved')          { setPayErr('Already approved — refresh.'); setPayLoading(false); return }
    if (existing?.status === 'payment_submitted') { setPayErr('Already submitted — awaiting admin.'); setPayLoading(false); return }

    const { error } = await supabase.from('tournament_payments').upsert({
      tournament_id: id, user_id: user.id,
      payment_ref: payRef.trim() || null, payment_phone: payPhone.trim() || null,
      amount: fee, status: 'payment_submitted',
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'tournament_id,user_id' })
    if (error) { setPayErr(error.message); setPayLoading(false); return }

    const { data: admins } = await supabase.from('profiles').select('id')
      .in('email', ['stevenmsambwa8@gmail.com', 'nabogamingss1@gmail.com'])
    if (admins?.length) {
      const { data: prof } = await supabase.from('profiles').select('username').eq('id', user.id).single()
      await supabase.from('notifications').insert(admins.map(a => ({
        user_id: a.id, title: '💳 Tournament Payment — Verify',
        body: `${prof?.username || 'A player'} submitted TZS ${Number(fee).toLocaleString()} entry fee for "${tournament.name}". Ref: ${payRef.trim()}`,
        type: 'payment', meta: { tournament_id: id, action: 'verify_tournament_payment' }, read: false,
      })))
    }
    await supabase.from('notifications').insert({
      user_id: user.id, title: '⏳ Payment Submitted',
      body: `Your entry fee for "${tournament.name}" is pending admin approval. Ref: ${payRef.trim()}`,
      type: 'tournament', meta: { tournament_id: id }, read: false,
    })
    setPaymentStatus('payment_submitted')
    setShowPayModal(false); setPayRef(''); setPayPhone('')
    showToast('Payment submitted! Admin will verify shortly.', 'success')
    setPayLoading(false)
  }

  async function register() {
    if (!user) { router.push('/login'); return }
    if (!isAdmin && tournament?.created_by === user.id) {
      showToast("You can't join your own tournament.", 'error'); return
    }
    setRegistering(true)
    const { error } = await supabase.from('tournament_participants').insert({ tournament_id: id, user_id: user.id })
    if (!error) {
      const count = await syncCount()
      setRegistered(true)
      setTournament(t => ({ ...t, registered_count: count }))

      // Place user in an open bracket slot (works for both lobby and generated brackets)
      if (bracketData) {
        const { data: profile } = await supabase.from('profiles').select('username, avatar_url').eq('id', user.id).maybeSingle()
        const playerSlot = { userId: user.id, name: profile?.username || 'Player', avatar: profile?.avatar_url || null, status: 'active' }

        // Collect all open slots in round 0
        const openSlots = []
        bracketData.rounds[0]?.forEach((pair, pi) => {
          pair.forEach((s, si) => {
            if (!s?.userId && (s?.status === 'open' || s?.status === 'bye')) {
              openSlots.push({ pi, si })
            }
          })
        })

        if (openSlots.length > 0) {
          const pick = openSlots[Math.floor(Math.random() * openSlots.length)]
          const newRounds = bracketData.rounds.map((r, ri) => ri !== 0 ? r : r.map((pair, pi) => {
            if (pi !== pick.pi) return pair
            return pair.map((s, si) => si === pick.si ? playerSlot : s)
          }))
          const updatedBd = { ...bracketData, rounds: newRounds, isEmpty: false }
          await supabase.from('tournaments').update({ bracket_data: updatedBd }).eq('id', id)
          setBracketData(updatedBd)
        }
      }

      await sendNotification(user.id, `Joined — ${tournament?.name}`,
        `You've registered and been placed in the bracket!`, 'tournament', { tournament_id: id })
      // Award participant achievement
      awardAchievement(user.id, 'ri-group-line', 'Tournament Player', 'Registered for your first tournament')
    }
    setRegistering(false)
    load()
  }

  /** Register + immediately claim an open slot in round-0 */
  async function joinViaSlot(targetPIdx, targetSIdx) {
    if (!user) { router.push('/login'); return }
    if (!isAdmin && tournament?.created_by === user.id) {
      showToast("You can't join your own tournament.", 'error'); return
    }
    if (registered) { showToast('You are already registered.', 'info'); return }
    if (isFull) { showToast('Tournament is full.', 'error'); return }
    if (!bracketData) return

    // Guard: verify the slot is still open (race condition safety)
    const targetSlot = bracketData.rounds[0]?.[targetPIdx]?.[targetSIdx]
    if (targetSlot?.userId || (targetSlot?.status !== 'open' && targetSlot?.status !== 'bye')) {
      showToast('That slot was just taken. Pick another.', 'error'); return
    }

    setRegistering(true)
    const { error: regErr } = await supabase.from('tournament_participants').insert({ tournament_id: id, user_id: user.id })
    if (regErr) { showToast('Failed to register. Try again.', 'error'); setRegistering(false); return }

    const { data: profile } = await supabase.from('profiles').select('username, avatar_url').eq('id', user.id).maybeSingle()
    const playerSlot = { userId: user.id, name: profile?.username || 'Player', avatar: profile?.avatar_url || null, status: 'active' }

    const newRounds = bracketData.rounds.map((r, ri) => ri !== 0 ? r : r.map((pair, pi) => {
      if (pi !== targetPIdx) return pair
      return pair.map((s, si) => si === targetSIdx ? playerSlot : s)
    }))
    const updatedBd = { ...bracketData, rounds: newRounds, isEmpty: false }
    await supabase.from('tournaments').update({ bracket_data: updatedBd }).eq('id', id)
    setBracketData(updatedBd)

    const count = await syncCount()
    setRegistered(true)
    setTournament(t => ({ ...t, registered_count: count }))
    await sendNotification(user.id, `Joined — ${tournament?.name}`, `You've joined and claimed a bracket slot!`, 'tournament', { tournament_id: id })
    setRegistering(false)
    load()
  }

  async function leave() {
    if (!user) return
    setConfirmModal({
      message: 'Leave this tournament? Your spot and bracket history will be removed.',
      onConfirm: async () => {
        setLeaving(true)
        await supabase.from('tournament_participants').delete().eq('tournament_id', id).eq('user_id', user.id)
        await supabase.from('tournament_leaderboard').delete().eq('tournament_id', id).eq('user_id', user.id)
        if (bracketData) {
          // Always restore the leaving player's slot(s) to 'open' so they can be claimed again.
          // For a generated bracket, also clear any advanced copies of the player in later rounds.
          const openSlot = { userId: null, name: 'Open', avatar: null, status: 'open' }

          const scrubbed = {
            ...bracketData,
            rounds: bracketData.rounds.map((round) =>
              round.map(pair =>
                pair.map(s => s?.userId === user.id ? openSlot : s)
              )
            ),
          }

          // If all round-0 slots are open/empty again, mark bracket as isEmpty
          const anyRealPlayer = scrubbed.rounds[0]?.some(pair => pair.some(s => s?.userId))
          if (!anyRealPlayer) scrubbed.isEmpty = true

          await supabase.from('tournaments').update({ bracket_data: scrubbed }).eq('id', id)
          setBracketData(scrubbed)
        }
        const count = await syncCount()
        setRegistered(false)
        setTournament(t => ({ ...t, registered_count: count }))
        setLeaving(false)
        load()
      },
    })
  }

  // ── Bracket management ────────────────────────────────────────────────────

  async function initBracket() {
    const bd = buildBracket(participants)
    if (!bd) { showToast('Need at least 2 players.', 'error'); return }

    const { error } = await supabase.from('tournaments').update({ bracket_data: bd }).eq('id', id)
    if (error) { showToast('Failed to save bracket. Try again.', 'error'); return }
    setBracketData(bd)

    const tName = tournament?.name || 'the tournament'
    const notifRows = participants.filter(p => p.user_id).map(p => ({
      user_id: p.user_id,
      title: `Bracket generated — ${tName}`,
      body: `The bracket has been set. You've been placed into a slot — good luck!`,
      type: 'tournament', meta: { tournament_id: id }, read: false,
    }))
    for (let i = 0; i < notifRows.length; i += 50) {
      await supabase.from('notifications').insert(notifRows.slice(i, i + 50))
    }
  }

  async function resetBracket() {
    setConfirmModal({
      message: 'Reset the entire bracket? All match progress and points will be lost.',
      onConfirm: async () => {
        const bd = buildBracket(participants)
        if (!bd) return
        await supabase.from('tournament_leaderboard').delete().eq('tournament_id', id)
        setBracketData(bd)
        saveBracket(bd)
        load()
      },
    })
  }

  // ── Admin: set slot status (pass / eliminate / DQ) ────────────────────────

  async function adminSetSlotStatus(rIdx, pIdx, slotIdx, status) {
    const loserIdx = slotIdx === 0 ? 1 : 0

    // Always read fresh from DB to avoid stale-state overwrite bugs
    const { data: freshT } = await supabase.from('tournaments').select('bracket_data').eq('id', id).single()
    const freshBd = parseBracketData(freshT?.bracket_data) ?? bracketData
    if (!freshBd) return

    const currentSlot = freshBd.rounds[rIdx]?.[pIdx]?.[slotIdx]
    if (!currentSlot?.userId) return          // nothing to act on
    if (currentSlot.status === status) return // no-op

    // ── Remove from bracket — reset slot to open ──────────────────────────
    if (status === 'remove') {
      const openSlot = { userId: null, name: 'Open', avatar: null, status: 'open' }
      const newRounds = freshBd.rounds.map((r, ri) => {
        if (ri !== rIdx) return r
        return r.map((pair, pi) => {
          if (pi !== pIdx) return pair
          return pair.map((s, si) => si === slotIdx ? openSlot : s)
        })
      })
      const newBd = { ...freshBd, rounds: newRounds }
      setBracketData(newBd)
      await saveBracket(newBd)
      // Notify the removed player
      if (currentSlot.userId) {
        await supabase.from('notifications').insert({
          user_id: currentSlot.userId,
          title: `Removed from bracket — ${tournament?.name || 'Tournament'}`,
          body: 'An organiser removed you from the bracket. The slot is now open.',
          type: 'tournament', meta: { tournament_id: id }, read: false,
        })
      }
      await load()
      return
    }

    const totalRounds = freshBd.rounds.length
    const isFinalRound = rIdx === totalRounds - 2
    const actedSlot = currentSlot
    const oppositeSlot = freshBd.rounds[rIdx]?.[pIdx]?.[loserIdx]
    const tName = tournament?.name || 'the tournament'
    const hasOpp = !!(oppositeSlot?.userId
      && oppositeSlot.status !== 'bye'
      && oppositeSlot.status !== 'eliminated'
      && oppositeSlot.status !== 'disqualified')

    // 1. Mutate the current round
    let newRounds = freshBd.rounds.map((r, ri) => {
      if (ri !== rIdx) return r
      return r.map((pair, pi) => {
        if (pi !== pIdx) return pair
        return pair.map((s, si) => {
          if (si === slotIdx) return { ...s, status }
          // Auto-eliminate the opponent when passing someone
          if (status === 'winner' && s?.userId && s.status !== 'bye') return { ...s, status: 'eliminated' }
          return s
        })
      })
    })

    // 2. Advance winner into next round (always overwrite — prevents duplicates)
    if (status === 'winner') {
      const advanced = { ...newRounds[rIdx][pIdx][slotIdx], status: 'active' }
      const destRound = isFinalRound ? totalRounds - 1 : rIdx + 1
      const destPair  = Math.floor(pIdx / 2)
      const destSlot  = pIdx % 2

      newRounds = newRounds.map((r, ri) => {
        if (ri !== destRound) return r
        return r.map((pair, pi) => {
          if (pi !== destPair) return pair
          return pair.map((s, si) => si === destSlot ? advanced : s)
        })
      })
    }

    const newBd = { ...freshBd, rounds: newRounds }
    setBracketData(newBd)
    await saveBracket(newBd)

    // 3. Notifications (fire immediately after save, before slow RPCs)
    const roundName = getRoundLabelSimple(rIdx, totalRounds, freshBd.bracketSize)
    const notifRows = []

    if (status === 'winner' && actedSlot.userId) {
      const { winnerPts, loserPts } = getRoundPts(rIdx, totalRounds)
      // Award match win achievement
      awardAchievement(actedSlot.userId, 'ri-sword-fill', 'First Win', 'Won your first tournament match')
      if (isFinalRound) awardAchievement(actedSlot.userId, 'ri-trophy-fill', 'Finalist', 'Reached the Final of a tournament')
      notifRows.push({
        user_id: actedSlot.userId,
        title: isFinalRound ? `Final won — ${tName}` : `Advanced from ${roundName} — ${tName}`,
        body: isFinalRound
          ? `You defeated ${oppositeSlot?.name || 'your opponent'} in the Final! +${winnerPts} pts. Check your wallet for prize & pts details.`
          : `You beat ${oppositeSlot?.name || 'your opponent'} and advance! +${winnerPts} pts.`,
        type: isFinalRound ? 'tournament_win' : 'tournament_advance',
        meta: { tournament_id: id }, read: false,
      })
      if (hasOpp) notifRows.push({
        user_id: oppositeSlot.userId,
        title: `Eliminated in ${roundName} — ${tName}`,
        body: `You were knocked out by ${actedSlot.name}. +${loserPts} pts for reaching this stage.`,
        type: 'tournament_eliminate', meta: { tournament_id: id }, read: false,
      })
    } else if (status === 'eliminated' && actedSlot.userId) {
      notifRows.push({
        user_id: actedSlot.userId,
        title: `Eliminated — ${tName}`,
        body: `You have been eliminated from ${roundName}. Check your wallet for your earned pts.`,
        type: 'tournament_eliminate', meta: { tournament_id: id }, read: false,
      })
      if (hasOpp) notifRows.push({
        user_id: oppositeSlot.userId,
        title: `Opponent eliminated — ${tName}`,
        body: `Your opponent ${actedSlot.name} was eliminated from ${roundName}. You advance!`,
        type: 'tournament_advance', meta: { tournament_id: id }, read: false,
      })
    } else if (status === 'disqualified' && actedSlot.userId) {
      notifRows.push({
        user_id: actedSlot.userId,
        title: `Disqualified — ${tName}`,
        body: `You have been disqualified from ${roundName}. Go to your wallet to review your earnings.`,
        type: 'tournament', meta: { tournament_id: id }, read: false,
      })
      if (hasOpp) notifRows.push({
        user_id: oppositeSlot.userId,
        title: `Opponent DQ'd — ${tName}`,
        body: `Your opponent ${actedSlot.name} was disqualified from ${roundName}. You advance!`,
        type: 'tournament_advance', meta: { tournament_id: id }, read: false,
      })
    }
    if (notifRows.length > 0) await supabase.from('notifications').insert(notifRows)

    // 4. Points + logging (after notifications)
    if (status === 'winner' && actedSlot.userId) {
      const { winnerPts, loserPts } = getRoundPts(rIdx, totalRounds)
      await awardBracketPoints(actedSlot.userId, winnerPts)
      if (oppositeSlot?.userId && oppositeSlot.status !== 'bye' && oppositeSlot.userId !== actedSlot.userId) {
        await awardBracketPoints(oppositeSlot.userId, loserPts)
      }
      await Promise.all([
        supabase.rpc('log_earning', {
          p_user_id: actedSlot.userId,
          p_type: isFinalRound ? 'tournament_win' : 'tournament_advance',
          p_points: winnerPts,
          p_description: `${isFinalRound ? 'Won Final' : `Advanced from ${roundName}`} — ${tName}`,
          p_ref_id: id,
        }),
        ...(oppositeSlot?.userId && oppositeSlot.status !== 'bye' && oppositeSlot.userId !== actedSlot.userId
          ? [supabase.rpc('log_earning', {
              p_user_id: oppositeSlot.userId,
              p_type: 'tournament_eliminate',
              p_points: loserPts,
              p_description: `Eliminated in ${roundName} — ${tName}`,
              p_ref_id: id,
            })]
          : []),
      ])
      await recalcPositions()
    }

    await load()
  }

  // ── Admin: add registered participant to an open bracket slot ───────────────
  async function adminAddToBracket(userId) {
    if (!bracketData) { showToast('No bracket yet. Generate it first.', 'error'); return }
    // Check not already in bracket
    let alreadyIn = false
    bracketData.rounds[0]?.forEach(pair => pair.forEach(s => { if (s?.userId === userId) alreadyIn = true }))
    if (alreadyIn) { showToast('Player is already in the bracket.', 'info'); return }

    const { data: freshT } = await supabase.from('tournaments').select('bracket_data').eq('id', id).single()
    const freshBd = parseBracketData(freshT?.bracket_data) ?? bracketData
    if (!freshBd) return

    const { data: profile } = await supabase.from('profiles').select('username, avatar_url').eq('id', userId).maybeSingle()
    const playerSlot = { userId, name: profile?.username || 'Player', avatar: profile?.avatar_url || null, status: 'active' }

    // Find first open slot in round 0
    let pick = null
    freshBd.rounds[0]?.forEach((pair, pi) => {
      pair.forEach((s, si) => {
        if (!pick && !s?.userId && (s?.status === 'open' || s?.status === 'bye')) pick = { pi, si }
      })
    })

    if (!pick) { showToast('No open slots in the bracket.', 'error'); return }

    const newRounds = freshBd.rounds.map((r, ri) => ri !== 0 ? r : r.map((pair, pi) => {
      if (pi !== pick.pi) return pair
      return pair.map((s, si) => si === pick.si ? playerSlot : s)
    }))
    const newBd = { ...freshBd, rounds: newRounds, isEmpty: false }
    setBracketData(newBd)
    await saveBracket(newBd)
    showToast(`${profile?.username || 'Player'} added to bracket!`, 'success')
    await supabase.from('notifications').insert({
      user_id: userId,
      title: `Added to bracket — ${tournament?.name || 'Tournament'}`,
      body: 'An organiser has placed you in the tournament bracket. Good luck!',
      type: 'tournament', meta: { tournament_id: id }, read: false,
    })
    const newCount = await syncCount()
    setTournament(t => ({ ...t, registered_count: newCount }))
    await load()
  }

  // ── Admin: swap two players between bracket slots ───────────────────────────
  async function adminSwapSlots(r1, p1, s1, r2, p2, s2) {
    const { data: freshT } = await supabase.from('tournaments').select('bracket_data').eq('id', id).single()
    const freshBd = parseBracketData(freshT?.bracket_data) ?? bracketData
    if (!freshBd) return

    const slotA = freshBd.rounds[r1]?.[p1]?.[s1]
    const slotB = freshBd.rounds[r2]?.[p2]?.[s2]
    if (!slotA || !slotB) return

    const newRounds = freshBd.rounds.map((round, ri) =>
      round.map((pair, pi) =>
        pair.map((s, si) => {
          if (ri === r1 && pi === p1 && si === s1) return { ...slotB }
          if (ri === r2 && pi === p2 && si === s2) return { ...slotA }
          return s
        })
      )
    )
    const newBd = { ...freshBd, rounds: newRounds }
    setBracketData(newBd)
    await saveBracket(newBd)
    showToast('Players swapped!', 'success')
    await load()
  }

  // ── Admin: crown champion ─────────────────────────────────────────────────

  async function adminSetChampion(rIdx, pIdx) {
    if (!bracketData) return
    const { data: freshT } = await supabase.from('tournaments').select('bracket_data').eq('id', id).single()
    const freshBd = parseBracketData(freshT?.bracket_data) ?? bracketData
    const champion = freshBd.rounds[rIdx]?.[pIdx]?.[0]
    if (!champion?.userId) { showToast('No player in the champion slot yet.', 'error'); return }

    const newRounds = freshBd.rounds.map((r, ri) =>
      ri !== rIdx ? r : r.map((pair, pi) =>
        pi !== pIdx ? pair : [{ ...pair[0], status: 'winner' }, null]
      )
    )
    const newBd = { ...freshBd, rounds: newRounds }
    setBracketData(newBd)
    await saveBracket(newBd)
    await supabase.from('tournaments').update({ status: 'completed' }).eq('id', id)
    setTournament(t => ({ ...t, status: 'completed' }))

    const CHAMPION_BONUS = 30
    const currentSeason = getCurrentSeason()
    await awardBracketPoints(champion.userId, CHAMPION_BONUS)
    await supabase.from('profiles').update({ is_season_winner: true }).eq('id', champion.userId)
    // Award champion achievement
    await awardAchievement(champion.userId, 'ri-vip-crown-fill', 'Tournament Champion', `Won ${tournament?.name || 'a tournament'}`)

    // Season wins: champion +3, runner-up +2, 3rd +1
    const { data: finalLb } = await supabase
      .from('tournament_leaderboard').select('user_id, position, points').eq('tournament_id', id)
      .order('position', { ascending: true }).limit(3)

    async function applySeasonWins(userId, bonus) {
      const { data: prof } = await supabase.from('profiles').select('wins, season_wins, level, current_season').eq('id', userId).single()
      if (!prof) return
      const registeredSeason = prof.current_season ?? currentSeason
      const newSeasonWins = registeredSeason < currentSeason ? 1 : (prof.season_wins ?? 0) + bonus
      const newWins = (prof.wins ?? 0) + bonus
      let newLevel = prof.level ?? 1
      for (let i = 0; i < bonus; i++) newLevel = computeLevelAfterWin(newLevel, (prof.season_wins ?? 0) + i + 1)
      await supabase.from('profiles').update({ wins: newWins, season_wins: newSeasonWins, level: newLevel, current_season: currentSeason }).eq('id', userId)
    }

    await applySeasonWins(champion.userId, 3)
    const p2 = finalLb?.find(e => e.position === 2)
    const p3 = finalLb?.find(e => e.position === 3)
    if (p2?.user_id) await applySeasonWins(p2.user_id, 2)
    if (p3?.user_id) await applySeasonWins(p3.user_id, 1)

    await recalcPositions()

    // Notifications
    const tName = tournament?.name || 'the tournament'
    const champRow = finalLb?.find(e => e.user_id === champion.userId)
    const allNotifs = [
      { user_id: champion.userId, title: `CHAMPION — ${tName}`,
        body: `You are the Tournament Champion! +${CHAMPION_BONUS} bonus pts. Final: ${champRow?.points || 0} pts. Check your wallet for prize & pts details.`,
        type: 'tournament_champion', meta: { tournament_id: id }, read: false },
      ...(p2 ? [{ user_id: p2.user_id, title: `2nd Place — ${tName}`,
        body: `Runner-up with ${p2.points} pts. Great run all the way to the Final!`,
        type: 'tournament_podium', meta: { tournament_id: id }, read: false }] : []),
      ...(p3 ? [{ user_id: p3.user_id, title: `3rd Place — ${tName}`,
        body: `Podium finish at #3 with ${p3.points} pts. Top 3 is elite!`,
        type: 'tournament_podium', meta: { tournament_id: id }, read: false }] : []),
    ]
    const { data: allParts } = await supabase.from('tournament_participants').select('user_id').eq('tournament_id', id)
    const podiumIds = new Set([champion.userId, p2?.user_id, p3?.user_id].filter(Boolean))
    const broadcasts = (allParts || [])
      .filter(p => p.user_id && !podiumIds.has(p.user_id))
      .map(p => ({
        user_id: p.user_id,
        title: `Tournament complete — ${tName}`,
        body: `${champion.name || 'A player'} has been crowned Champion! See the final standings.`,
        type: 'tournament', meta: { tournament_id: id }, read: false,
      }))
    const allNotifsFull = [...allNotifs, ...broadcasts]
    if (allNotifsFull.length) await supabase.from('notifications').insert(allNotifsFull)

    await Promise.all([
      supabase.rpc('log_earning', { p_user_id: champion.userId, p_type: 'tournament_champion', p_points: CHAMPION_BONUS, p_description: `Champion — ${tName}`, p_ref_id: id }),
      ...(p2?.user_id ? [supabase.rpc('log_earning', { p_user_id: p2.user_id, p_type: 'tournament_podium', p_points: 0, p_description: `Runner-up — ${tName}`, p_ref_id: id })] : []),
      ...(p3?.user_id ? [supabase.rpc('log_earning', { p_user_id: p3.user_id, p_type: 'tournament_podium', p_points: 0, p_description: `3rd place — ${tName}`, p_ref_id: id })] : []),
    ])
    await load()
  }

  // ── Admin: leaderboard management ─────────────────────────────────────────

  async function addLeaderboardEntry() {
    if (!lbEntry.userId) { showToast('Select a player first', 'error'); return }
    setLbUpdating(true)
    await supabase.from('tournament_leaderboard').upsert(
      { tournament_id: id, user_id: lbEntry.userId, position: Number(lbEntry.position), points: Number(lbEntry.points) },
      { onConflict: 'tournament_id,user_id' }
    )
    await supabase.rpc('increment_points', { uid: lbEntry.userId, amount: Number(lbEntry.points) }).catch(() => {})
    setLbEntry({ userId: '', points: '', position: '' })
    load()
    setLbUpdating(false)
  }

  async function deleteLeaderboardEntry(entryId) {
    const entry = leaderboard.find(e => e.id === entryId)
    setConfirmModal({
      message: 'Remove this entry? Their points will also be deducted from their global profile.',
      onConfirm: async () => {
        const pts = entry?.points || 0
        const userId = entry?.user_id
        await supabase.from('tournament_leaderboard').delete().eq('id', entryId)
        if (userId && pts > 0) {
          const { error } = await supabase.rpc('increment_points', { uid: userId, amount: -pts })
          if (error) {
            const { data: prof } = await supabase.from('profiles').select('points').eq('id', userId).maybeSingle()
            if (prof) await supabase.from('profiles').update({ points: Math.max(0, (prof.points || 0) - pts) }).eq('id', userId)
          }
          await sendNotification(userId, `Leaderboard entry removed — ${tournament?.name}`,
            `An admin removed your entry. ${pts} pts deducted from your global profile.`, 'tournament', { tournament_id: id })
        }
        setLeaderboard(lb => lb.filter(e => e.id !== entryId))
      },
    })
  }

  async function adminDeductWinner(entry) {
    setConfirmModal({
      message: `Remove all ${entry.points} pts from ${entry.profiles?.username}? Also deducted from global profile.`,
      onConfirm: async () => {
        setLbActionMenu(null)
        const { data: fresh } = await supabase.from('tournament_leaderboard').select('points').eq('id', entry.id).maybeSingle()
        const pts = fresh?.points ?? entry.points
        await supabase.from('tournament_leaderboard').update({ points: 0, position: 99 }).eq('id', entry.id)
        const { error } = await supabase.rpc('increment_points', { uid: entry.user_id, amount: -pts })
        if (error) {
          const { data: prof } = await supabase.from('profiles').select('points').eq('id', entry.user_id).maybeSingle()
          if (prof) await supabase.from('profiles').update({ points: Math.max(0, (prof.points || 0) - pts) }).eq('id', entry.user_id)
        }
        await recalcPositions()
        await sendNotification(entry.user_id, `Points removed — ${tournament?.name}`,
          `An admin removed ${pts} pts from your leaderboard score.`, 'tournament', { tournament_id: id })
        load()
      },
    })
  }

  async function adminDQWinner(entry) {
    setConfirmModal({
      message: `Disqualify ${entry.profiles?.username}? Points reset to 0 and bracket marked DQ.`,
      onConfirm: async () => {
        setLbActionMenu(null)
        const { data: fresh } = await supabase.from('tournament_leaderboard').select('points').eq('id', entry.id).maybeSingle()
        const pts = fresh?.points ?? entry.points
        await supabase.from('tournament_leaderboard').update({ points: 0, position: 99 }).eq('id', entry.id)
        const { error } = await supabase.rpc('increment_points', { uid: entry.user_id, amount: -pts })
        if (error) {
          const { data: prof } = await supabase.from('profiles').select('points').eq('id', entry.user_id).maybeSingle()
          if (prof) await supabase.from('profiles').update({ points: Math.max(0, (prof.points || 0) - pts) }).eq('id', entry.user_id)
        }
        if (bracketData) {
          const newRounds = bracketData.rounds.map(pairs =>
            pairs.map(pair => pair.map(s =>
              s?.userId === entry.user_id && s.status === 'winner' ? { ...s, status: 'disqualified' } : s
            ))
          )
          const newBd = { ...bracketData, rounds: newRounds }
          await supabase.from('tournaments').update({ bracket_data: newBd }).eq('id', id)
          setBracketData(newBd)
        }
        await recalcPositions()
        await sendNotification(entry.user_id, `Disqualified — ${tournament?.name}`,
          `You've been disqualified. ${pts} pts removed from leaderboard and global profile.`, 'tournament', { tournament_id: id })
        load()
      },
    })
  }

  // ── Prize distribution ────────────────────────────────────────────────────

  function openPrizeDistrib() {
    const total = parsePrize(tournament?.prize)
    const distributeToTop = participants.length >= 16 ? 10 : 3
    const ratios3  = [0.60, 0.25, 0.15]
    const ratios10 = [0.30, 0.20, 0.15, 0.10, 0.08, 0.05, 0.04, 0.03, 0.03, 0.02]
    const prefill = {}
    rankedLeaderboard.slice(0, distributeToTop).forEach((e, i) => {
      if (!total) { prefill[e.user_id] = ''; return }
      const ratio = distributeToTop === 10 ? (ratios10[i] ?? 0) : (ratios3[i] ?? 0)
      prefill[e.user_id] = String(Math.round(total * ratio))
    })
    setPrizeDistrib(prefill)
    setPrizeDistribOpen(true)
  }

  async function savePrizeDistrib() {
    setPrizeDistribSaving(true)
    const tName = tournament?.name || 'the tournament'
    for (const [userId, amtStr] of Object.entries(prizeDistrib)) {
      const amt = Number(amtStr)
      if (!amt || isNaN(amt)) continue
      const player = rankedLeaderboard.find(e => e.user_id === userId)
      await supabase.from('tournament_leaderboard').upsert(
        { tournament_id: id, user_id: userId, prize_amount: amt, points: player?.points || 0, position: player?.position || null },
        { onConflict: 'tournament_id,user_id' }
      )
      const posLabel = player?.position === 1 ? '1st place' : player?.position === 2 ? '2nd place' : player?.position === 3 ? '3rd place' : `#${player?.position}`
      await sendNotification(userId, `Prize awarded — ${tName}`,
        `${posLabel} finish — you've been awarded ${fmtTZS(amt)}! Check your wallet — your prize has been logged there.`, 'tournament_podium', { tournament_id: id })
      await supabase.rpc('log_earning', { p_user_id: userId, p_type: 'prize', p_points: amt, p_description: `Prize · ${posLabel} — ${tName}`, p_ref_id: id })
    }
    await load()
    setPrizeDistribSaving(false)
    setPrizeDistribOpen(false)
    showToast('Prizes distributed!', 'success')
  }

  // ── Tournament edit / delete ──────────────────────────────────────────────

  async function saveEdit() {
    setSaving(true)
    const newSlug = slugify(editForm.name)
    const { error } = await supabase.from('tournaments').update({
      name: editForm.name, slug: newSlug, description: editForm.description,
      prize: editForm.prize, slots: Number(editForm.slots), date: editForm.date,
      format: editForm.format, status: editForm.status,
    }).eq('id', id)
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    setEditMode(false)
    if (newSlug !== slug) router.replace(`/tournaments/${newSlug}`)
    else load()
  }

  async function deleteTournament() {
    setConfirmModal({
      message: 'Permanently delete this tournament? Cannot be undone.',
      onConfirm: async () => {
        await supabase.from('tournament_leaderboard').delete().eq('tournament_id', id)
        await supabase.from('tournament_participants').delete().eq('tournament_id', id)
        await supabase.from('tournaments').delete().eq('id', id)
        router.replace('/tournaments')
      },
    })
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  function statusColor(s) { return { active: 'var(--accent)', ongoing: '#eab308', completed: 'var(--text-muted)', cancelled: '#dc2626' }[s] || 'var(--text-muted)' }
  function statusIcon(s)  { return { active: 'ri-live-line', ongoing: 'ri-play-circle-line', completed: 'ri-checkbox-circle-line', cancelled: 'ri-close-circle-line' }[s] || 'ri-circle-line' }

  function handleShare() {
    const text = buildShareText(tournament, rankedLeaderboard)
    const fallback = () => {
      const ta = document.createElement('textarea')
      ta.value = text; document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }
    navigator.clipboard?.writeText(text)
      .then(() => { setShareCopied(true); setTimeout(() => setShareCopied(false), 2500) })
      .catch(() => { fallback(); setShareCopied(true); setTimeout(() => setShareCopied(false), 2500) })
  }

  function handleBracketShare() {
    const text = buildBracketShareText(tournament, bracketData, participants)
    const fallback = () => {
      const ta = document.createElement('textarea')
      ta.value = text; document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }
    if (navigator.share) {
      navigator.share({ title: tournament.name + ' Bracket', text }).catch(() => {})
      return
    }
    navigator.clipboard?.writeText(text)
      .then(() => { setBracketShareCopied(true); setTimeout(() => setBracketShareCopied(false), 2500) })
      .catch(() => { fallback(); setBracketShareCopied(true); setTimeout(() => setBracketShareCopied(false), 2500) })
  }

  function openHistory(userId) {
    const p = participants.find(x => x.user_id === userId)
    if (!p) return
    setHistoryModal({ userId, username: p.profiles?.username || '?', avatar: p.profiles?.avatar_url || null, history: buildMatchHistory(userId, bracketData) })
  }

  const gameLabel = GAME_META[tournament?.game_slug]?.name || tournament?.game_slug
  const prizeTotal = parsePrize(tournament?.prize)
  const mvp = computeMVP(bracketData, participants)

  if (loadingTournament) return null
  if (!tournament) return (
    <div className={styles.page}>
      <p style={{ color: 'var(--text-muted)', padding: '40px 20px', textAlign: 'center' }}>Tournament not found.</p>
    </div>
  )

  const podiumPlayers = rankedLeaderboard.slice(0, 3)
  const isCompleted    = tournament?.status === 'completed'
  const isOngoing      = tournament?.status === 'ongoing'
  const isTestTournament = tournament?.is_test

  function getScore(rIdx, pIdx) {
    const key = `${rIdx}-${pIdx}`
    const pair = bracketData?.rounds?.[rIdx]?.[pIdx]
    // scoreA on slot[0], scoreB on slot[1] — survives JSON roundtrip
    const fromBracket = { a: pair?.[0]?.scoreA ?? '', b: pair?.[1]?.scoreB ?? '' }
    return scoreMap[key] ?? fromBracket
  }
  function setScore(rIdx, pIdx, side, val) {
    const key = `${rIdx}-${pIdx}`
    setScoreMap(m => ({ ...m, [key]: { ...getScore(rIdx, pIdx), [side]: val } }))
  }
  async function saveScore(rIdx, pIdx) {
    if (!bracketData) return
    const key = `${rIdx}-${pIdx}`
    const sc = getScore(rIdx, pIdx)
    setScoreSaving(key)
    const { data: freshT } = await supabase.from('tournaments').select('bracket_data').eq('id', id).single()
    const freshBd = parseBracketData(freshT?.bracket_data) ?? bracketData
    const newRounds = freshBd.rounds.map((r, ri) =>
      ri !== rIdx ? r : r.map((pair, pi) => {
        if (pi !== pIdx) return pair
        return [
          pair[0] ? { ...pair[0], scoreA: sc.a } : pair[0],
          pair[1] ? { ...pair[1], scoreB: sc.b } : pair[1],
        ]
      })
    )
    const newBd = { ...freshBd, rounds: newRounds }
    await supabase.from('tournaments').update({ bracket_data: newBd }).eq('id', id)
    setBracketData(newBd)
    setScoreSaving(null)
  }
  const canManage = isAdmin || (user && tournament?.created_by === user.id)
  const isOwnTournament = !isAdmin && !!(user && tournament?.created_by === user.id)

  function getUserBadgeProps(uid) {
    const fromP = participants.find(p => p.user_id === uid)
    if (fromP?.profiles) return { email: fromP.profiles.email, countryFlag: fromP.profiles.country_flag, isSeasonWinner: fromP.profiles.is_season_winner }
    const fromLb = leaderboard.find(e => e.user_id === uid)
    if (fromLb?.profiles) return { email: fromLb.profiles.email, countryFlag: fromLb.profiles.country_flag, isSeasonWinner: fromLb.profiles.is_season_winner }
    return { email: null, countryFlag: null, isSeasonWinner: false }
  }

  function getLbRowClass(e) {
    if (e.position === 1) return styles.lbTop1
    if (e.position === 2) return styles.lbTop2
    if (e.position === 3) return styles.lbTop3
    return ''
  }
  function getPosEl(e) {
    if (e.position === 1) return <i className={`ri-trophy-fill ${styles.gold}`} />
    if (e.position === 2) return <i className={`ri-medal-fill ${styles.silver}`} />
    if (e.position === 3) return <i className={`ri-award-fill ${styles.bronze}`} />
    return <span className={styles.posNum}>#{e.position}</span>
  }

  // How many actual BYE matches exist (vs just empty pending slots)?
  const realByeCount = (() => {
    if (!bracketData?.rounds?.[0]) return 0
    return bracketData.rounds[0].filter(pair =>
      pair.some(s => s?.status === 'bye') && pair.some(s => s?.userId)
    ).length
  })()

  const getPassPoints = (rIdx) => bracketData ? getRoundPts(rIdx, bracketData.rounds.length).winnerPts : 0

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={styles.page} onClick={() => lbActionMenu && setLbActionMenu(null)}>

      {/* Toast */}
      {toast && (
        <div className={styles.toast} style={{
          background: toast.type === 'success' ? 'var(--accent)' : toast.type === 'info' ? 'var(--surface-raised)' : '#dc2626',
        }}>
          <i className={`ri-${toast.type === 'success' ? 'checkbox-circle' : toast.type === 'info' ? 'information' : 'error-warning'}-fill`} />
          {toast.text}
        </div>
      )}

      {/* Top bar */}
      <div className={styles.topBar}>
        <button className={styles.back} onClick={() => router.back()}>
          <i className="ri-arrow-left-line" /> Back
        </button>
        {canManage && tournament && (
          <div className={styles.adminActions}>
            <button className={styles.editBtn} onClick={() => setEditMode(true)}>
              <i className="ri-edit-line" /> Edit
            </button>
            <button className={styles.deleteBtn} onClick={deleteTournament}>
              <i className="ri-delete-bin-line" />
            </button>
          </div>
        )}
      </div>

      {/* Hero */}
      <div className={styles.hero}>
        <div className={styles.heroMeta}>
          <span className={styles.gameTag}>{gameLabel}</span>
          <span className={styles.statusBadge} style={{ color: statusColor(tournament.status), borderColor: statusColor(tournament.status) }}>
            <i className={`ri-${statusIcon(tournament.status)}`} />
            {tournament.status}
          </span>
          {registered && tournament.status === 'active' && (
            <div className={styles.heroRegChip}>
              <button className={styles.heroLeaveBtn} onClick={leave} disabled={leaving}>
                <i className="ri-logout-box-line" />{leaving ? '…' : 'Leave'}
              </button>
            </div>
          )}
          {registered && tournament.status !== 'active' && (
            <span className={styles.heroParticipatedChip}><i className="ri-checkbox-circle-fill" /></span>
          )}
          {!registered && tournament.status === 'active' && !isFull && !isOwnTournament && !isCompleted && (() => {
            const hasFee = (tournament.entrance_fee || 0) > 0
            if (!hasFee) {
              return (
                <button className={styles.heroRegisterBtn} onClick={register} disabled={registering}>
                  <i className="ri-add-circle-line" />{registering ? '…' : 'Register'}
                </button>
              )
            }
            if (paymentStatus === 'payment_submitted') {
              return (
                <span className={styles.heroPayPendingChip}>
                  <i className="ri-time-line" /> Awaiting Approval
                </span>
              )
            }
            if (paymentStatus === 'rejected') {
              return (
                <button className={styles.heroRegisterBtn} style={{ background: '#ef4444', borderColor: '#ef4444' }} onClick={() => setShowPayModal(true)}>
                  <i className="ri-error-warning-line" /> Resubmit Payment
                </button>
              )
            }
            return (
              <button className={styles.heroRegisterBtn} onClick={() => setShowPayModal(true)}>
                <i className="ri-money-dollar-circle-line" /> Register · TZS {Number(tournament.entrance_fee).toLocaleString()}
              </button>
            )
          })()}
          {isOwnTournament && tournament.status === 'active' && (
            <span className={styles.heroFullChip} style={{ borderColor: 'var(--text-muted)', color: 'var(--text-muted)' }}>
              <i className="ri-shield-line" /> Your tournament
            </span>
          )}
          {/* Test mode badge */}
          {isTestTournament && (
            <span className={styles.heroTestChip}>
              <i className="ri-flask-line" /> Test Run
              {testTimeLeft !== null && (
                <span className={styles.heroTestTimer}>
                  {(() => {
                    const h = Math.floor(testTimeLeft / 3600000)
                    const m = Math.floor((testTimeLeft % 3600000) / 60000)
                    const s = Math.floor((testTimeLeft % 60000) / 1000)
                    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
                  })()}
                </span>
              )}
            </span>
          )}
          {/* Start Tournament button — creator or admin, only when active */}
          {(isAdmin || isOwnTournament) && tournament.status === 'active' && (
            <button
              className={styles.heroStartBtn}
              onClick={async () => {
                await supabase.from('tournaments').update({ status: 'ongoing' }).eq('id', id)
                setTournament(t => ({ ...t, status: 'ongoing' }))
                // Notify participants only if not a test tournament
                if (!isTestTournament) {
                  const { data: parts } = await supabase.from('tournament_participants').select('user_id').eq('tournament_id', id)
                  if (parts?.length) {
                    await supabase.from('notifications').insert(
                      parts.map(p => ({
                        user_id: p.user_id,
                        title: `🏆 Tournament Started — ${tournament.name}`,
                        body: `The tournament "${tournament.name}" is now underway! Check the bracket for your next match.`,
                        type: 'tournament',
                        meta: { tournament_id: id },
                        read: false,
                      }))
                    )
                  }
                }
                showToast('Tournament is now ongoing!', 'success')
              }}
            >
              <i className="ri-play-circle-line" /> Start Tournament
            </button>
          )}
          {isFull && !registered && (
            <span className={styles.heroFullChip}><i className="ri-lock-line" /> Full</span>
          )}
        </div>
        <h1 className={styles.heroTitle}>{tournament.name}</h1>
        {tournament.description && <p className={styles.heroDesc}>{tournament.description}</p>}
        <div className={styles.heroStats}>
          <div className={styles.heroStat}><i className="ri-trophy-line" /><div><span className={styles.heroStatLabel}>Prize</span><span className={styles.heroStatVal}>{prizeTotal ? fmtTZS(prizeTotal) : 'None'}</span></div></div>
          <div className={styles.heroStat}><i className="ri-group-line" /><div><span className={styles.heroStatLabel}>Players</span><span className={styles.heroStatVal}>{loadingParticipants ? '…' : `${realCount}/${tournament.slots}`}</span></div></div>
          <div className={styles.heroStat}><i className="ri-gamepad-line" /><div><span className={styles.heroStatLabel}>Format</span><span className={styles.heroStatVal}>{tournament.format || '—'}</span></div></div>
          {tournament.date && <div className={styles.heroStat}><i className="ri-calendar-event-line" /><div><span className={styles.heroStatLabel}>Date</span><span className={styles.heroStatVal}>{tournament.date}</span></div></div>}
        </div>
        <div className={styles.heroSlotBar}>
          <div className={styles.slotTrack}>
            <div className={styles.slotFill} style={{ width: `${Math.min(100, (realCount / (tournament.slots || 1)) * 100)}%` }} />
          </div>
          <span className={styles.slotLabel}>
            {!tournament.slots ? '' : Math.max(0, tournament.slots - realCount) === 0 ? 'Full' : `${Math.max(0, tournament.slots - realCount)} spots left`}
          </span>
        </div>

        {/* Entry fee banner */}
        {(tournament.entrance_fee || 0) > 0 && !registered && (
          <div className={`${styles.feeBanner} ${paymentStatus === 'payment_submitted' ? styles.feeBannerPending : paymentStatus === 'rejected' ? styles.feeBannerRejected : ''}`}>
            <i className={paymentStatus === 'payment_submitted' ? 'ri-time-line' : paymentStatus === 'rejected' ? 'ri-error-warning-line' : 'ri-money-dollar-circle-line'} />
            <span>
              {paymentStatus === 'payment_submitted'
                ? 'Payment submitted — awaiting admin approval'
                : paymentStatus === 'rejected'
                ? 'Payment rejected — please resubmit'
                : `Entry fee: TZS ${Number(tournament.entrance_fee).toLocaleString()} via M-Pesa`}
            </span>
            {(!paymentStatus || paymentStatus === 'rejected') && (
              <button className={styles.feeBannerBtn} onClick={() => setShowPayModal(true)}>
                {paymentStatus === 'rejected' ? 'Resubmit' : 'Pay Now'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Payment Modal ── */}
      {showPayModal && (
        <div className={styles.modalBackdrop} onClick={() => setShowPayModal(false)}>
          <div className={styles.modalSheet} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setShowPayModal(false)}><i className="ri-close-line" /></button>

            <p className={styles.modalTitle}><i className="ri-secure-payment-line" style={{ color: '#22c55e' }} /> Send Payment</p>
            <p className={styles.modalSub}>Send the exact amount to one of the accounts below, then submit your proof.</p>

            <div className={styles.paymentBox}>
              <div className={styles.payProviderHead}>
                <i className="ri-sim-card-line" style={{ color: '#e11d48' }} />
                <span>Halopesa — Lipa Number</span>
              </div>
              <div className={styles.payRow}>
                <span>Lipa Number</span>
                <strong className={styles.payNumber}>25165945</strong>
              </div>
              <div className={styles.payRow}>
                <span>Account Name</span>
                <strong>NABOGAMING</strong>
              </div>

              <div className={styles.payDivider} />

              <div className={styles.payProviderHead}>
                <i className="ri-sim-card-2-line" style={{ color: '#16a34a' }} />
                <span>M-Pesa — Lipa Number</span>
              </div>
              <div className={styles.payRow}>
                <span>Lipa Number</span>
                <strong className={styles.payNumber}>36835506</strong>
              </div>
              <div className={styles.payRow}>
                <span>Account Name</span>
                <strong>STEVEN DAVID</strong>
              </div>

              <div className={styles.payDivider} />

              <div className={styles.payRow}>
                <span>Amount</span>
                <strong style={{ color: '#22c55e', fontSize: 16 }}>TZS {Number(tournament.entrance_fee).toLocaleString()}</strong>
              </div>
              <div className={styles.payRow}>
                <span>Reference</span>
                <strong>{tournament.name?.slice(0, 22)}</strong>
              </div>
            </div>

            <p className={styles.modalSubSmall}>After paying, enter your proof below:</p>

            <div className={styles.modalField}>
              <label><i className="ri-fingerprint-line" /> Transaction ID / Reference <span className={styles.req}>*</span></label>
              <input type="text" placeholder="e.g. ABC12345XY" value={payRef} onChange={e => setPayRef(e.target.value)} />
            </div>
            <div className={styles.modalField}>
              <label><i className="ri-phone-line" /> Phone Number Used</label>
              <input type="tel" placeholder="e.g. 0712 345 678" value={payPhone} onChange={e => setPayPhone(e.target.value)} />
            </div>

            {payErr && <p className={styles.modalErr}><i className="ri-error-warning-line" /> {payErr}</p>}

            <button className={styles.modalSubmit} onClick={submitPayment} disabled={payLoading || (!payRef.trim() && !payPhone.trim())}>
              {payLoading ? <><i className="ri-loader-4-line" /> Submitting…</> : <><i className="ri-check-double-line" /> I've Paid — Notify Admin</>}
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className={styles.tabs}>
        {[
          { key: 'bracket',     icon: 'ri-node-tree',     title: 'Bracket' },
          { key: 'matches',     icon: 'ri-sword-line',    title: 'Matches' },
          { key: 'leaderboard', icon: 'ri-bar-chart-line',title: 'Leaderboard' },
          { key: 'players',     icon: 'ri-group-line',    title: `Players (${loadingParticipants ? '…' : realCount})` },
          ...(canManage ? [{ key: 'manage', icon: 'ri-settings-3-line', title: 'Manage' }] : []),
        ].map(tab => (
          <button
            key={tab.key}
            className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.key)}
            title={tab.title}
            aria-label={tab.title}
          >
            <i className={tab.icon} />
          </button>
        ))}
      </div>

      {/* ── BRACKET TAB ── */}
      {activeTab === 'bracket' && (
        <section className={styles.section}>
          {(loadingTournament || loadingParticipants) ? (
            <div className={styles.skeletonBracket}>
              {[1, 2, 3].map(col => (
                <div key={col} className={styles.skeletonBracketCol}>
                  <div className={styles.skeletonBracketLabel} />
                  {[1, 2, 3, 4].slice(0, 4 - col).map(i => (
                    <div key={i} className={styles.skeletonMatchCard}>
                      <div className={styles.skeletonSlot} /><div className={styles.skeletonSlot} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : !bracketData ? (
            <div className={styles.emptyTab}>
              <i className="ri-node-tree" /><p>Bracket not set up yet</p>
              {canManage
                ? <button className={styles.adminActionBtn} style={{ marginTop: 10 }} onClick={initBracket}>
                    <i className="ri-play-circle-line" /> Generate Bracket
                  </button>
                : <span>The organiser will set up the bracket soon!</span>
              }
            </div>
          ) : (
            <>
              <div className={styles.bracketHeader}>
                <div className={styles.bracketInfo}>
                  <span className={styles.bracketSize}>
                    <i className="ri-node-tree" />{bracketData.bracketSize}-player bracket
                  </span>
                  {realByeCount > 0 && (
                    <span className={styles.bracketPlayers}>
                      {participants.length} registered · {realByeCount} BYE{realByeCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {realByeCount === 0 && participants.length > 0 && (
                    <span className={styles.bracketPlayers}>{participants.length} players · no BYEs</span>
                  )}
                </div>
                {canManage && <div className={styles.bracketAdminBadge}><img src="/tick.png" className={styles.tickIconXs} alt="admin" /></div>}
                <button
                  className={`${styles.shareBtn} ${bracketShareCopied ? styles.shareBtnCopied : ''}`}
                  onClick={handleBracketShare}
                  style={{ fontSize: 11, padding: '5px 10px' }}
                >
                  {bracketShareCopied
                    ? <><i className="ri-checkbox-circle-fill" /> Copied!</>
                    : <><i className="ri-share-line" /> Share Bracket</>
                  }
                </button>
              </div>

              <div className={styles.bracketScroll}>
                <div className={styles.bracketZoom}>
                  <div className={styles.bracketWrap}>
                    {bracketData.rounds.map((pairs, rIdx) => {
                      const isChampion = rIdx === bracketData.rounds.length - 1
                      return (
                        <div key={rIdx} className={`${styles.bracketCol} ${isChampion ? styles.bracketColChamp : ''}`}>
                          <div className={`${styles.roundLabel} ${isChampion ? styles.roundLabelChamp : ''}`}>
                            {isChampion && <i className="ri-vip-crown-fill" style={{ marginRight: 4 }} />}
                            {getRoundLabel(rIdx, bracketData.rounds.length, bracketData.bracketSize)}
                          </div>
                          <div className={styles.matchList}>
                            {pairs.map((pair, pIdx) => isChampion
                              ? <ChampDisplay
                                  key={pIdx}
                                  entry={pair[0]}
                                  styles={styles}
                                  isAdmin={canManage}
                                  onSetWinner={() => adminSetChampion(rIdx, pIdx)}
                                  leaderboard={leaderboard}
                                  participants={participants}
                                />
                              : (
                                <div key={pIdx} className={styles.matchPairWrap}>
                                  <MatchCard
                                    pair={pair}
                                    styles={styles}
                                    isAdmin={canManage}
                                    onSetStatus={(slotIdx, status) => adminSetSlotStatus(rIdx, pIdx, slotIdx, status)}
                                    onSwap={(sIdx, targetSIdx) => adminSwapSlots(rIdx, pIdx, sIdx, rIdx, pIdx, targetSIdx)}
                                    passPoints={getPassPoints(rIdx)}
                                    leaderboard={leaderboard}
                                    participants={participants}
                                    onJoin={
                                      rIdx === 0 && !registered && !isFull && !isOwnTournament && tournament?.status === 'active'
                                        ? (() => {
                                            const hasFee = (tournament.entrance_fee || 0) > 0
                                            if (!hasFee) return (sIdx) => joinViaSlot(pIdx, sIdx)
                                            if (paymentStatus === 'approved') return (sIdx) => joinViaSlot(pIdx, sIdx)
                                            return () => {
                                              if (paymentStatus === 'payment_submitted') {
                                                showToast('Payment awaiting approval — you cannot join yet.', 'info')
                                              } else {
                                                setShowPayModal(true)
                                              }
                                            }
                                          })()
                                        : undefined
                                    }
                                  />
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className={styles.bracketLegend}>
                <span className={styles.legendItem}><span className={styles.dot} style={{ background: 'var(--accent)' }} /> Active</span>
                <span className={styles.legendItem}><span className={styles.dot} style={{ background: '#f59e0b' }} /> Winner</span>
                <span className={styles.legendItem}><span className={styles.dot} style={{ background: '#dc2626' }} /> Eliminated</span>
                <span className={styles.legendItem}><span className={styles.dot} style={{ background: '#7c3aed' }} /> Disqualified</span>
                {canManage && <span className={styles.legendHint}><i className="ri-cursor-line" /> Tap player to manage</span>}
              </div>
            </>
          )}
        </section>
      )}

      {/* ── MATCHES TAB ── */}
      {activeTab === 'matches' && (
        <section className={styles.section}>
          {(loadingTournament || loadingParticipants) ? (
            <div className={styles.skeletonList}>
              {[1, 2, 3, 4].map(i => (
                <div key={i} className={styles.skeletonLbRow}>
                  <div style={{ flex: 1 }}>
                    <div className={styles.skeletonLine} style={{ width: '55%', marginBottom: 6 }} />
                    <div className={styles.skeletonLine} style={{ width: '30%' }} />
                  </div>
                  <div className={styles.skeletonLine} style={{ width: 50 }} />
                </div>
              ))}
            </div>
          ) : !bracketData || bracketData.isEmpty ? (
            <div className={styles.emptyTab}>
              <i className="ri-sword-line" /><p>No matches yet</p>
              <span>{canManage ? 'Generate the bracket to create matches.' : 'The organiser will set up the bracket soon!'}</span>
            </div>
          ) : (() => {
            const totalRounds = bracketData.rounds.length
            const allMatchups = []
            bracketData.rounds.slice(0, totalRounds - 1).forEach((pairs, rIdx) => {
              const roundLabel = getRoundLabelSimple(rIdx, totalRounds, bracketData.bracketSize)
              pairs.forEach((pair, pIdx) => {
                const [a, b] = pair
                const isBye = (a?.status === 'bye') || (b?.status === 'bye') || (!a?.userId && !b?.userId)
                const aProfile = participants.find(x => x.user_id === a?.userId)?.profiles
                const bProfile = participants.find(x => x.user_id === b?.userId)?.profiles
                allMatchups.push({ rIdx, pIdx, roundLabel, a, b, aProfile, bProfile, isBye })
              })
            })

            if (allMatchups.length === 0) return <div className={styles.emptyTab}><i className="ri-sword-line" /><p>No matches found</p></div>

            const byRound = {}
            allMatchups.forEach(m => {
              if (!byRound[m.roundLabel]) byRound[m.roundLabel] = []
              byRound[m.roundLabel].push(m)
            })

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                {Object.entries(byRound).map(([roundLabel, matchups]) => (
                  <div key={roundLabel}>
                    {/* Round header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', background: 'rgba(var(--accent-rgb,99,102,241),0.10)', padding: '3px 9px', borderRadius: 6 }}>
                        {roundLabel}
                      </span>
                      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {matchups.map(({ rIdx, pIdx, a, b, aProfile, bProfile, isBye }) => {
                        const aWon = a?.status === 'winner'
                        const bWon = b?.status === 'winner'
                        const aOut = a?.status === 'eliminated' || a?.status === 'disqualified'
                        const bOut = b?.status === 'eliminated' || b?.status === 'disqualified'
                        const done = aWon || bWon
                        const pending = !done && !isBye

                        return (
                          <div key={`${rIdx}-${pIdx}`} style={{
                            background: 'var(--surface)',
                            border: `1px solid ${done ? 'rgba(245,158,11,0.2)' : 'var(--border)'}`,
                            borderRadius: 14,
                            padding: '14px 16px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                          }}>
                            {/* Players row */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              {/* FIX #1: PlayerSide is now a module-level component; isBye passed as prop */}
                              <PlayerSide entry={a} profile={aProfile} won={aWon} lost={aOut} side="left" isBye={isBye} />

                              {/* Centre VS / status */}
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                {isBye ? (
                                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', color: 'var(--text-muted)', background: 'var(--bg)', padding: '3px 7px', borderRadius: 6 }}>BYE</span>
                                ) : done ? (
                                  <i className="ri-trophy-fill" style={{ fontSize: 16, color: '#f59e0b' }} />
                                ) : (
                                  <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.05em' }}>VS</span>
                                )}
                                <span style={{
                                  fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                                  color: done ? '#22c55e' : pending ? 'var(--text-muted)' : 'var(--text-muted)',
                                  textTransform: 'uppercase',
                                }}>
                                  {done ? 'Done' : isBye ? '' : 'Pending'}
                                </span>
                              </div>

                              <PlayerSide entry={b} profile={bProfile} won={bWon} lost={bOut} side="right" isBye={isBye} />
                            </div>

                            {/* Admin action row */}
                            {canManage && !isBye && (
                              <div style={{
                                borderTop: '1px solid var(--border)',
                                paddingTop: 10,
                                display: 'flex',
                                gap: 6,
                                flexWrap: 'wrap',
                              }}>
                                <button
                                  onClick={() => adminSetSlotStatus(rIdx, pIdx, 0, 'winner')}
                                  disabled={bracketSaving || aWon}
                                  style={{
                                    flex: 1, minWidth: 70, padding: '6px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                                    background: aWon ? 'rgba(245,158,11,0.15)' : 'var(--bg)',
                                    color: aWon ? '#f59e0b' : 'var(--text)',
                                    fontSize: 11, fontWeight: 700,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                    opacity: bracketSaving ? 0.5 : 1,
                                  }}
                                >
                                  <i className="ri-trophy-line" style={{ fontSize: 12 }} />
                                  {aProfile?.username?.split(' ')[0] || 'P1'} wins
                                </button>
                                <button
                                  onClick={() => adminSetSlotStatus(rIdx, pIdx, 1, 'winner')}
                                  disabled={bracketSaving || bWon}
                                  style={{
                                    flex: 1, minWidth: 70, padding: '6px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                                    background: bWon ? 'rgba(245,158,11,0.15)' : 'var(--bg)',
                                    color: bWon ? '#f59e0b' : 'var(--text)',
                                    fontSize: 11, fontWeight: 700,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                    opacity: bracketSaving ? 0.5 : 1,
                                  }}
                                >
                                  <i className="ri-trophy-line" style={{ fontSize: 12 }} />
                                  {bProfile?.username?.split(' ')[0] || 'P2'} wins
                                </button>
                                <button
                                  onClick={() => adminSwapSlots(rIdx, pIdx, 0, rIdx, pIdx, 1)}
                                  disabled={bracketSaving || !a?.userId || !b?.userId}
                                  title="Swap players"
                                  style={{
                                    padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                                    background: 'var(--bg)', color: 'var(--text-muted)',
                                    fontSize: 13, display: 'flex', alignItems: 'center',
                                    opacity: (!a?.userId || !b?.userId || bracketSaving) ? 0.3 : 1,
                                  }}
                                >
                                  <i className="ri-arrow-left-right-line" />
                                </button>
                              </div>
                            )}

                            {/* ── Score row — visible to all, editable by canManage ── */}
                            {!isBye && (() => {
                              const sc = getScore(rIdx, pIdx)
                              const key = `${rIdx}-${pIdx}`
                              const saving = scoreSaving === key
                              const hasScore = sc.a !== '' || sc.b !== ''
                              return canManage ? (
                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <i className="ri-bar-chart-2-line" style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }} />
                                  <input
                                    type="text" inputMode="numeric" placeholder="Score A"
                                    value={sc.a}
                                    onChange={e => setScore(rIdx, pIdx, 'a', e.target.value)}
                                    style={{ width: 64, padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border-dark)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 700, textAlign: 'center', fontFamily: 'var(--font)' }}
                                  />
                                  <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)' }}>–</span>
                                  <input
                                    type="text" inputMode="numeric" placeholder="Score B"
                                    value={sc.b}
                                    onChange={e => setScore(rIdx, pIdx, 'b', e.target.value)}
                                    style={{ width: 64, padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border-dark)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 700, textAlign: 'center', fontFamily: 'var(--font)' }}
                                  />
                                  <button
                                    onClick={() => saveScore(rIdx, pIdx)}
                                    disabled={saving}
                                    style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 7, border: 'none', background: saving ? 'var(--surface)' : 'var(--text)', color: saving ? 'var(--text-muted)' : 'var(--bg)', fontSize: 11, fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                                  >
                                    {saving ? <><i className="ri-loader-4-line" /> Saving…</> : <><i className="ri-save-line" /> Save</>}
                                  </button>
                                </div>
                              ) : hasScore ? (
                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                                  <span style={{ fontSize: 20, fontWeight: 900, color: aWon ? '#f59e0b' : 'var(--text)' }}>{sc.a}</span>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>–</span>
                                  <span style={{ fontSize: 20, fontWeight: 900, color: bWon ? '#f59e0b' : 'var(--text)' }}>{sc.b}</span>
                                </div>
                              ) : null
                            })()}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </section>
      )}

      {/* ── LEADERBOARD TAB ── */}
      {activeTab === 'leaderboard' && (
        <section className={styles.section}>
          {(loadingLeaderboard || loadingParticipants) ? (
            <div className={styles.skeletonList}>
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className={styles.skeletonLbRow}>
                  <div className={styles.skeletonAvatar} />
                  <div style={{ flex: 1 }}>
                    <div className={styles.skeletonLine} style={{ width: '50%', marginBottom: 6 }} />
                    <div className={styles.skeletonLine} style={{ width: '30%' }} />
                  </div>
                  <div className={styles.skeletonLine} style={{ width: 40 }} />
                </div>
              ))}
            </div>
          ) : rankedLeaderboard.length === 0 ? (
            <div className={styles.emptyTab}><i className="ri-bar-chart-line" /><p>No players yet</p></div>
          ) : (
            <>
              {!isCompleted && bracketData && !bracketData.isEmpty && (
                <div className={styles.lbInProgressBanner}>
                  <i className="ri-time-line" />
                  <span>Tournament in progress — standings are provisional until a champion is crowned</span>
                </div>
              )}
              {mvp && isCompleted && (
                <div className={styles.mvpBanner}>
                  <div className={styles.mvpLeft}><i className="ri-sword-fill" /><span className={styles.mvpLabel}>MVP</span></div>
                  <div className={styles.mvpPlayer}>
                    <div className={styles.mvpAvatar}>
                      {mvp.avatar ? <img src={mvp.avatar} alt="" /> : <span>{mvp.username.slice(0, 2).toUpperCase()}</span>}
                    </div>
                    <span className={styles.mvpName} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {mvp.username}
                      <UserBadges {...getUserBadgeProps(mvp.userId)} size={12} gap={2} />
                    </span>
                    <span className={styles.mvpWins}>{mvp.wins} w{mvp.wins !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              )}
              {podiumPlayers.length >= 1 && (
                <div className={`${styles.podiumWrap} ${!isCompleted && bracketData ? styles.podiumDimmed : ''}`}>
                  {podiumPlayers[1] && (
                    <div className={`${styles.podiumSlot} ${styles.podiumSecond}`}>
                      <div className={styles.podiumAvatar}>
                        {podiumPlayers[1].profiles?.avatar_url ? <img src={podiumPlayers[1].profiles.avatar_url} alt="" /> : <span>{(podiumPlayers[1].profiles?.username || '?').slice(0, 2).toUpperCase()}</span>}
                      </div>
                      <span className={styles.podiumName} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                        {podiumPlayers[1].profiles?.username || '—'}
                        <UserBadges {...getUserBadgeProps(podiumPlayers[1].user_id)} size={11} gap={2} />
                      </span>
                      {podiumPlayers[1].points > 0 && <span className={styles.podiumPts}>{podiumPlayers[1].points} pts</span>}
                      {podiumPlayers[1].lbEntry?.prize_amount > 0 && <span className={styles.podiumPrize}>{fmtTZS(podiumPlayers[1].lbEntry.prize_amount)}</span>}
                      <div className={styles.podiumBlock} style={{ height: 54 }}><i className="ri-medal-fill" style={{ color: '#94a3b8', fontSize: 18 }} /><span>2nd</span></div>
                    </div>
                  )}
                  <div className={`${styles.podiumSlot} ${styles.podiumFirst}`}>
                    <i className="ri-vip-crown-fill" style={{ color: '#f59e0b', fontSize: 20, marginBottom: 4 }} />
                    <div className={styles.podiumAvatar} style={{ width: 56, height: 56, fontSize: 16 }}>
                      {podiumPlayers[0].profiles?.avatar_url ? <img src={podiumPlayers[0].profiles.avatar_url} alt="" /> : <span>{(podiumPlayers[0].profiles?.username || '?').slice(0, 2).toUpperCase()}</span>}
                    </div>
                    <span className={styles.podiumName} style={{ fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                      {podiumPlayers[0].profiles?.username || '—'}
                      <UserBadges {...getUserBadgeProps(podiumPlayers[0].user_id)} size={12} gap={2} />
                    </span>
                    {podiumPlayers[0].points > 0 && <span className={styles.podiumPts} style={{ color: '#f59e0b' }}>{podiumPlayers[0].points} pts</span>}
                    {podiumPlayers[0].lbEntry?.prize_amount > 0 && <span className={styles.podiumPrize} style={{ color: '#f59e0b' }}>{fmtTZS(podiumPlayers[0].lbEntry.prize_amount)}</span>}
                    <div className={styles.podiumBlock} style={{ height: 80, background: 'linear-gradient(180deg,rgba(245,158,11,0.2),rgba(245,158,11,0.06))' }}>
                      <i className="ri-trophy-fill" style={{ color: '#f59e0b', fontSize: 22 }} /><span style={{ color: '#f59e0b' }}>1st</span>
                    </div>
                  </div>
                  {podiumPlayers[2] && (
                    <div className={`${styles.podiumSlot} ${styles.podiumThird}`}>
                      <div className={styles.podiumAvatar}>
                        {podiumPlayers[2].profiles?.avatar_url ? <img src={podiumPlayers[2].profiles.avatar_url} alt="" /> : <span>{(podiumPlayers[2].profiles?.username || '?').slice(0, 2).toUpperCase()}</span>}
                      </div>
                      <span className={styles.podiumName} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                        {podiumPlayers[2].profiles?.username || '—'}
                        <UserBadges {...getUserBadgeProps(podiumPlayers[2].user_id)} size={11} gap={2} />
                      </span>
                      {podiumPlayers[2].points > 0 && <span className={styles.podiumPts}>{podiumPlayers[2].points} pts</span>}
                      {podiumPlayers[2].lbEntry?.prize_amount > 0 && <span className={styles.podiumPrize}>{fmtTZS(podiumPlayers[2].lbEntry.prize_amount)}</span>}
                      <div className={styles.podiumBlock} style={{ height: 40 }}><i className="ri-award-fill" style={{ color: '#b45309', fontSize: 16 }} /><span>3rd</span></div>
                    </div>
                  )}
                </div>
              )}
              <div className={styles.lbActions}>
                <button className={`${styles.shareBtn} ${shareCopied ? styles.shareBtnCopied : ''}`} onClick={handleShare}>
                  {shareCopied ? <><i className="ri-checkbox-circle-fill" /> Copied!</> : <><i className="ri-share-line" /> Share Standings</>}
                </button>
              </div>
              <div className={styles.lbList}>
                {rankedLeaderboard.map((e) => {
                  const bStatus = getPlayerBracketStatus(e.user_id, bracketData)
                  const isMVP = mvp?.userId === e.user_id
                  const rowPrize = e.lbEntry?.prize_amount > 0 ? e.lbEntry.prize_amount : null
                  const isOpen = lbActionMenu === e.user_id
                  return (
                    <div key={e.user_id} className={styles.lbRowWrap}>
                      <div
                        className={`${styles.lbRow} ${getLbRowClass(e)} ${bracketData ? styles.lbRowClickable : ''} ${!isCompleted && bracketData ? styles.lbRowDimmed : ''}`}
                        onClick={() => bracketData && openHistory(e.user_id)}
                      >
                        <span className={styles.lbCol_rank}>{getPosEl(e)}</span>
                        <div className={styles.lbCol_avatar}>
                          <div className={styles.lbAvatar}>
                            {e.profiles?.avatar_url ? <img src={e.profiles.avatar_url} alt="" className={styles.lbAvatarImg} /> : <span>{(e.profiles?.username || '?').slice(0, 2).toUpperCase()}</span>}
                          </div>
                        </div>
                        <div className={styles.lbCol_name}>
                          <span className={styles.lbNameRow}>
                            <span className={styles.lbName}>{e.profiles?.username || '—'}</span>
                            <UserBadges {...getUserBadgeProps(e.user_id)} size={12} gap={2} />
                          </span>
                          <div className={styles.lbNameBadges}>
                            {isMVP && <span className={styles.mvpBadgeInline}><i className="ri-sword-fill" /> MVP</span>}
                            {e.user_id === user?.id && <span className={styles.youBadge}>You</span>}
                          </div>
                        </div>
                        <div className={styles.lbCol_status}>
                          {!isCompleted && bStatus && (
                            bStatus === 'in'
                              ? <span className={styles.liveTagIn}><i className="ri-checkbox-circle-fill" /> In</span>
                              : <span className={styles.liveTagOut}><i className="ri-close-circle-fill" /> Out</span>
                          )}
                        </div>
                        <div className={styles.lbCol_prize}>
                          {rowPrize && <span className={styles.lbPrizeAmt}>{fmtTZS(rowPrize)}</span>}
                        </div>
                        <span className={`${styles.lbCol_pts} ${e.points === 0 ? styles.lbPtsDim : ''}`}>
                          {e.points > 0 ? `${e.points}pts` : '—'}
                        </span>
                        <div className={styles.lbCol_action}>
                          {canManage && e.lbEntry && e.points > 0 ? (
                            <button className={`${styles.lbMenuBtn} ${isOpen ? styles.lbMenuBtnActive : ''}`}
                              onClick={ev => { ev.stopPropagation(); setLbActionMenu(isOpen ? null : e.user_id) }}>
                              <i className="ri-more-2-fill" />
                            </button>
                          ) : bracketData ? (
                            <i className="ri-arrow-right-s-line" style={{ color: 'var(--text-muted)', fontSize: 14 }} />
                          ) : null}
                        </div>
                      </div>
                      {canManage && isOpen && e.lbEntry && (
                        <div className={styles.lbAdminMenu} onClick={ev => ev.stopPropagation()}>
                          <button className={`${styles.lbAdminMenuBtn} ${styles.lbAdminMenuDeduct}`} onClick={() => adminDeductWinner(e.lbEntry)}>
                            <i className="ri-subtract-line" /> Remove Points ({e.points} pts)
                          </button>
                          <button className={`${styles.lbAdminMenuBtn} ${styles.lbAdminMenuDQ}`} onClick={() => adminDQWinner(e.lbEntry)}>
                            <i className="ri-spam-2-fill" /> Disqualify Winner
                          </button>
                          <button className={`${styles.lbAdminMenuBtn} ${styles.lbAdminMenuDel}`} onClick={() => { setLbActionMenu(null); deleteLeaderboardEntry(e.lbEntry.id) }}>
                            <i className="ri-delete-bin-line" /> Remove Entry
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </section>
      )}

      {/* ── PLAYERS TAB ── */}
      {activeTab === 'players' && (
        <section className={styles.section}>
          {loadingParticipants ? (
            <div className={styles.playerGrid}>
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className={styles.playerCard}>
                  <div className={styles.skeletonAvatar} style={{ width: 48, height: 48, borderRadius: '50%', margin: '0 auto 8px' }} />
                  <div className={styles.skeletonLine} style={{ width: '60%', margin: '0 auto' }} />
                </div>
              ))}
            </div>
          ) : participants.length === 0 ? (
            <div className={styles.emptyTab}><i className="ri-group-line" /><p>No players yet</p><span>Be the first to register!</span></div>
          ) : (
            <div className={styles.playerGrid}>
              {participants.map(p => (
                <div key={p.user_id} className={styles.playerCard}>
                  <div className={styles.playerAvatar}>
                    {p.profiles?.avatar_url ? <img src={p.profiles.avatar_url} alt="" /> : <span>{(p.profiles?.username || '?').slice(0, 2).toUpperCase()}</span>}
                  </div>
                  <span className={styles.playerName} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    {p.profiles?.username || 'Player'}
                    <UserBadges {...getUserBadgeProps(p.user_id)} size={11} gap={2} />
                  </span>
                  {p.user_id === user?.id && <span className={styles.youBadge}>You</span>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}


      {/* ── MANAGE TAB ── */}
      {activeTab === 'manage' && canManage && (
        <section className={styles.section}>

          {/* ── Bracket Management ── */}
          <div className={styles.adminSection} style={{ marginBottom: 16 }}>
            <div className={styles.adminSectionLabel}><i className="ri-node-tree" /> Bracket Management</div>
            <div className={styles.adminBracketActions}>
              {!bracketData || bracketData.isEmpty
                ? <button className={styles.adminActionBtn} onClick={initBracket} disabled={participants.length < 2}>
                    <i className="ri-play-circle-line" /> Generate Bracket
                  </button>
                : <button className={styles.adminActionBtnDanger} onClick={resetBracket}>
                    <i className="ri-restart-line" /> Reset Bracket
                  </button>
              }
              {bracketSaving && <span className={styles.savingLabel}><i className="ri-loader-4-line" /> Saving…</span>}
            </div>
            <p className={styles.adminHint}>Tap any player card in the Bracket tab to pass, eliminate, or disqualify.</p>
          </div>

          {/* ── Matchup Planner ── */}
          <MatchupPlanner
            participants={participants}
            bracketData={bracketData}
            onApply={async (newRounds) => {
              const freshT = await supabase.from('tournaments').select('bracket_data').eq('id', id).single()
              const freshBd = parseBracketData(freshT?.data?.bracket_data) ?? bracketData
              const newBd = { ...freshBd, rounds: newRounds, isEmpty: false }
              setBracketData(newBd)
              await saveBracket(newBd)
              showToast('Matchups saved!', 'success')
            }}
          />

          {/* ── Player Counter ── */}
          <div className={styles.adminSection} style={{ marginTop: 16 }}>
            <div className={styles.adminSectionLabel}><i className="ri-group-line" /> Player Counter</div>
            <div className={styles.adminBracketActions}>
              <button className={styles.adminActionBtn} onClick={async () => { await syncCount(); load() }}>
                <i className="ri-refresh-line" /> Sync Count
              </button>
              <span className={styles.countBadge}>{realCount} / {tournament.slots} players</span>
            </div>
          </div>

          {/* ── Add unplaced participants ── */}
          {bracketData && (() => {
            const inBracket = new Set()
            bracketData.rounds[0]?.forEach(pair => pair.forEach(s => { if (s?.userId) inBracket.add(s.userId) }))
            const unplaced = participants.filter(p => !inBracket.has(p.user_id))
            if (unplaced.length === 0) return null
            return (
              <div className={styles.adminSection} style={{ marginTop: 16 }}>
                <div className={styles.adminSectionLabel}><i className="ri-user-add-line" /> Add to Bracket ({unplaced.length} unplaced)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  {unplaced.map(p => (
                    <div key={p.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--border)' }}>
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, fontSize: 11, fontWeight: 800 }}>
                        {p.profiles?.avatar_url
                          ? <img src={p.profiles.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : (p.profiles?.username || '?').slice(0, 2).toUpperCase()
                        }
                      </div>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.profiles?.username || 'Player'}</span>
                      <button className={styles.adminActionBtn} style={{ padding: '5px 12px', fontSize: 11 }} onClick={() => adminAddToBracket(p.user_id)}>
                        <i className="ri-add-line" /> Add
                      </button>
                    </div>
                  ))}
                </div>
                <p className={styles.adminHint}>These players registered but have no bracket slot yet.</p>
              </div>
            )
          })()}

          {/* ── Prize Distribution ── */}
          {isCompleted && (
            <div className={styles.adminSection} style={{ marginTop: 16 }}>
              <div className={styles.adminSectionLabel}><i className="ri-money-dollar-circle-line" /> Prize Distribution</div>
              <div className={styles.adminBracketActions}>
                <button className={styles.adminActionBtn} onClick={openPrizeDistrib}>
                  <i className="ri-gift-line" /> Distribute Prize
                </button>
              </div>
              <p className={styles.adminHint}>
                Set custom prize amounts and notify winners instantly.
                {prizeTotal ? ` Pool: ${fmtTZS(prizeTotal)}` : ' No prize pool set.'}
              </p>
            </div>
          )}

        </section>
      )}

      {/* ── Edit tournament modal ── */}
      {editMode && (
        <div className={styles.editOverlay} onClick={() => setEditMode(false)}>
          <div className={styles.editBox} onClick={e => e.stopPropagation()}>
            <div className={styles.editHeader}>
              <span>Edit Tournament</span>
              <button onClick={() => setEditMode(false)}><i className="ri-close-line" /></button>
            </div>
            <div className={styles.editBody}>
              {[
                { label: 'Name', key: 'name', type: 'text' },
                { label: 'Prize (TZS)', key: 'prize', type: 'text' },
                { label: 'Format', key: 'format', type: 'text' },
                { label: 'Max Slots', key: 'slots', type: 'number' },
                { label: 'Date', key: 'date', type: 'text' },
              ].map(f => (
                <div key={f.key} className={styles.editField}>
                  <label>{f.label}</label>
                  <input type={f.type} value={editForm[f.key] || ''} onChange={e => setEditForm(x => ({ ...x, [f.key]: e.target.value }))} />
                </div>
              ))}
              <div className={styles.editField}>
                <label>Status</label>
                <select value={editForm.status || 'active'} onChange={e => setEditForm(x => ({ ...x, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="ongoing">Ongoing</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div className={styles.editField}>
                <label>Description</label>
                <textarea rows={3} value={editForm.description || ''} onChange={e => setEditForm(x => ({ ...x, description: e.target.value }))} />
              </div>
              <button className={styles.saveBtn} onClick={saveEdit} disabled={saving}>
                {saving ? 'Saving…' : <><i className="ri-check-line" /> Save Changes</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Match history modal ── */}
      {historyModal && (
        <div className={styles.editOverlay} onClick={() => setHistoryModal(null)}>
          <div className={styles.historyBox} onClick={e => e.stopPropagation()}>
            <div className={styles.historyHeader}>
              <div className={styles.historyAvatar}>
                {historyModal.avatar ? <img src={historyModal.avatar} alt="" /> : <span>{historyModal.username.slice(0, 2).toUpperCase()}</span>}
              </div>
              <div>
                <div className={styles.historyName}>{historyModal.username}</div>
                <div className={styles.historySubtitle}>Match history</div>
              </div>
              <button className={styles.historyClose} onClick={() => setHistoryModal(null)}><i className="ri-close-line" /></button>
            </div>
            <div className={styles.historyList}>
              {historyModal.history.length === 0
                ? <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No match history yet.</p>
                : historyModal.history.map((h, i) => (
                    <div key={i} className={styles.historyItem}>
                      <div className={styles.historyRound}>{h.round}</div>
                      <div className={styles.historyOpp}>vs {h.opponentName}</div>
                      <div className={`${styles.historyResult} ${h.status === 'winner' ? styles.historyWin : h.status === 'eliminated' || h.status === 'disqualified' ? styles.historyLoss : ''}`}>
                        {h.status === 'winner' ? 'Won' : h.status === 'eliminated' ? 'Eliminated' : h.status === 'disqualified' ? 'DQ' : h.status}
                      </div>
                    </div>
                  ))
              }
            </div>
            <div className={`${styles.historyCTA} ${styles.sheetCTARow}`}>
              <button className={styles.sheetCTAProfile} onClick={() => { setHistoryModal(null); router.push(`/profile/${historyModal.userId}`) }}>
                <i className="ri-user-3-line" /> View Profile
              </button>
              <SheetFollowBtn userId={historyModal.userId} />
            </div>
          </div>
        </div>
      )}

      {/* ── Prize distribution modal ── */}
      {prizeDistribOpen && canManage && (
        <div className={styles.confirmOverlay} onClick={() => setPrizeDistribOpen(false)}>
          <div className={styles.confirmBox} style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className={styles.confirmIcon}><i className="ri-gift-line" style={{ color: '#f59e0b' }} /></div>
            <p className={styles.confirmMessage}>Distribute Prize</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18, textAlign: 'center' }}>
              Set amount per winner. Players are notified instantly.{prizeTotal ? ` Pool: ${fmtTZS(prizeTotal)}` : ''}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 360, overflowY: 'auto' }}>
              {rankedLeaderboard.filter(e => e.user_id in prizeDistrib).map((e, i) => {
                const posIcons = ['🥇', '🥈', '🥉']
                const posLabel = i < 3 ? posIcons[i] : `#${e.position}`
                return (
                  <div key={e.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: i < 3 ? 20 : 13, fontWeight: 800, flexShrink: 0, minWidth: 28, textAlign: 'center', color: 'var(--text-muted)' }}>{posLabel}</span>
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.profiles?.username || '—'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface)', border: '1px solid var(--border-dark)', borderRadius: 8, padding: '7px 10px', flexShrink: 0 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>TZS</span>
                      <input
                        type="number" min="0" value={prizeDistrib[e.user_id] || ''}
                        onChange={ev => setPrizeDistrib(p => ({ ...p, [e.user_id]: ev.target.value }))}
                        placeholder="0"
                        style={{ width: 88, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 14, fontWeight: 700 }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className={styles.confirmActions} style={{ marginTop: 22 }}>
              <button className={styles.confirmCancel} onClick={() => setPrizeDistribOpen(false)}>Cancel</button>
              <button className={styles.confirmOk} onClick={savePrizeDistrib} disabled={prizeDistribSaving}>
                {prizeDistribSaving ? 'Sending…' : <><i className="ri-send-plane-fill" /> Send & Notify</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm modal ── */}
      {confirmModal && (
        <div className={styles.confirmOverlay} onClick={() => setConfirmModal(null)}>
          <div className={styles.confirmBox} onClick={e => e.stopPropagation()}>
            <div className={styles.confirmIcon}><i className="ri-alert-line" /></div>
            <p className={styles.confirmMessage}>{confirmModal.message}</p>
            <div className={styles.confirmActions}>
              <button className={styles.confirmCancel} onClick={() => setConfirmModal(null)}>Cancel</button>
              <button className={styles.confirmOk} onClick={() => { const fn = confirmModal.onConfirm; setConfirmModal(null); fn() }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── MatchupPlanner component ─────────────────────────────────────────────────
// Lets admin/creator swap who vs who in any round that hasn't had results yet.
// A round is "editable" if NONE of its matches have a winner/eliminated/DQ slot.
// Once any result exists in a round, that round is locked.

function MatchupPlanner({ participants, bracketData, onApply }) {
  const [editRound, setEditRound] = useState(0)
  const [localRounds, setLocalRounds] = useState(null)
  const [applying, setApplying] = useState(false)
  const [changed, setChanged] = useState(false)

  useEffect(() => {
    if (!bracketData?.rounds) return
    setLocalRounds(bracketData.rounds.map(round => round.map(pair => [...pair])))
    setChanged(false)
  }, [bracketData])

  if (!bracketData?.rounds || participants.length < 2) return (
    <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
      <i className="ri-node-tree" /> Generate the bracket first to plan matchups.
    </div>
  )

  const totalRounds = bracketData.rounds.length
  // Only show rounds that are actual match rounds (exclude champion slot)
  const matchRounds = totalRounds - 1

  // Check if a round is locked — has any decisive result
  function isRoundLocked(rIdx) {
    return bracketData.rounds[rIdx]?.some(pair =>
      pair.some(s => s?.status === 'winner' || s?.status === 'eliminated' || s?.status === 'disqualified')
    )
  }

  // Get players eligible for a round — those who are 'active' or 'winner' advancing into it
  function getEligibleForRound(rIdx) {
    if (rIdx === 0) return participants
    // Players who advanced from previous round (status === 'winner' in rIdx-1, now active in rIdx)
    const ids = new Set()
    bracketData.rounds[rIdx]?.forEach(pair =>
      pair.forEach(s => { if (s?.userId && s.status !== 'bye' && s.status !== 'pending') ids.add(s.userId) })
    )
    // Also include pending slots — they're placeholders for winners not yet determined
    return participants.filter(p => ids.has(p.user_id))
  }

  function getProfile(userId) {
    return participants.find(p => p.user_id === userId)?.profiles
  }

  function swapSlots(rIdx, p1, s1, p2, s2) {
    setLocalRounds(prev => {
      const next = prev.map(r => r.map(pair => [...pair]))
      const tmp = { ...next[rIdx][p1][s1] }
      next[rIdx][p1][s1] = { ...next[rIdx][p2][s2] }
      next[rIdx][p2][s2] = tmp
      return next
    })
    setChanged(true)
  }

  function setSlotPlayer(rIdx, pairIdx, slotIdx, userId) {
    setLocalRounds(prev => {
      const next = prev.map(r => r.map(pair => [...pair]))
      // Clear this userId from anywhere else in this round
      next[rIdx].forEach((pair, pi) => pair.forEach((s, si) => {
        if (s?.userId === userId && !(pi === pairIdx && si === slotIdx)) {
          next[rIdx][pi][si] = { userId: null, name: 'Open', avatar: null, status: 'open' }
        }
      }))
      const prof = getProfile(userId)
      next[rIdx][pairIdx][slotIdx] = userId
        ? { userId, name: prof?.username || '?', avatar: prof?.avatar_url || null, status: 'active' }
        : { userId: null, name: 'Open', avatar: null, status: 'open' }
      return next
    })
    setChanged(true)
  }

  async function applyChanges() {
    if (!localRounds) return
    setApplying(true)
    await onApply(localRounds)
    setChanged(false)
    setApplying(false)
  }

  function resetChanges() {
    if (!bracketData?.rounds) return
    setLocalRounds(bracketData.rounds.map(round => round.map(pair => [...pair])))
    setChanged(false)
  }

  // Build round label
  function roundLabel(rIdx) {
    const fromEnd = (matchRounds - 1) - rIdx
    if (fromEnd === 0) return 'Final'
    if (fromEnd === 1) return 'Semi Final'
    if (fromEnd === 2) return 'Quarter Final'
    return `Round ${rIdx + 1}`
  }

  const currentRound = localRounds?.[editRound] || []
  const locked = isRoundLocked(editRound)

  // Players placed in current round
  const placedInRound = new Set()
  currentRound.forEach(pair => pair.forEach(s => { if (s?.userId) placedInRound.add(s.userId) }))

  // For round 0 show all participants; for later rounds show only active players in that round
  const eligiblePlayers = editRound === 0
    ? participants
    : participants.filter(p => {
        // Show players who appear in current round slots
        return currentRound.some(pair => pair.some(s => s?.userId === p.user_id))
          // Or who won previous round
          || bracketData.rounds[editRound - 1]?.some(pair => pair.some(s => s?.userId === p.user_id && s.status === 'winner'))
      })

  return (
    <div style={{ marginTop: 8 }}>
      {/* Header */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <i className="ri-shuffle-line" style={{ fontSize: 14 }} /> Matchup Planner
      </div>

      {/* Round selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {Array.from({ length: matchRounds }, (_, rIdx) => {
          const isLocked = isRoundLocked(rIdx)
          return (
            <button
              key={rIdx}
              onClick={() => { setEditRound(rIdx); resetChanges() }}
              style={{
                padding: '6px 12px', borderRadius: 20, border: `1.5px solid ${editRound === rIdx ? 'var(--accent)' : 'var(--border)'}`,
                background: editRound === rIdx ? 'color-mix(in srgb, var(--accent) 10%, var(--bg))' : 'var(--surface)',
                color: editRound === rIdx ? 'var(--accent)' : isLocked ? 'var(--text-muted)' : 'var(--text)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              {isLocked && <i className="ri-lock-line" style={{ fontSize: 11 }} />}
              {roundLabel(rIdx)}
            </button>
          )
        })}
      </div>

      {/* Locked notice */}
      {locked ? (
        <div style={{ padding: '12px 14px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13 }}>
          <i className="ri-lock-line" style={{ fontSize: 16, flexShrink: 0 }} />
          <span>This round has match results — matchups are locked and cannot be changed.</span>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
            Drag players between matches to plan {roundLabel(editRound)}. Tap a dropdown to reassign.
          </p>

          {/* Match pairs */}
          {currentRound.map((pair, pairIdx) => {
            const isByeInPair = pair.some(s => s?.status === 'bye')
            return (
              <div key={pairIdx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px' }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', width: 22, textAlign: 'center', flexShrink: 0 }}>M{pairIdx + 1}</span>
                {[0, 1].map(slotIdx => {
                  const slot = pair[slotIdx]
                  const isByeSlot = slot?.status === 'bye'
                  const hasPlayer = !!slot?.userId
                  return (
                    <React.Fragment key={slotIdx}>
                      {slotIdx === 1 && <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', flexShrink: 0 }}>VS</span>}
                      <div style={{ flex: 1 }}>
                        {isByeSlot ? (
                          <div style={{ padding: '7px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>BYE</div>
                        ) : (
                          <select
                            value={slot?.userId || ''}
                            onChange={e => setSlotPlayer(editRound, pairIdx, slotIdx, e.target.value || null)}
                            style={{
                              width: '100%', padding: '7px 10px', borderRadius: 8,
                              border: `1.5px solid ${hasPlayer ? 'var(--accent)' : 'var(--border)'}`,
                              background: hasPlayer ? 'color-mix(in srgb, var(--accent) 6%, var(--surface))' : 'var(--surface)',
                              color: hasPlayer ? 'var(--text)' : 'var(--text-muted)',
                              fontSize: 12, fontWeight: 600, outline: 'none', cursor: 'pointer',
                            }}
                          >
                            <option value="">— Empty —</option>
                            {eligiblePlayers.map(p => (
                              <option
                                key={p.user_id}
                                value={p.user_id}
                                disabled={placedInRound.has(p.user_id) && slot?.userId !== p.user_id}
                              >
                                {p.profiles?.username || 'Player'}
                                {placedInRound.has(p.user_id) && slot?.userId !== p.user_id ? ' ✓' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </React.Fragment>
                  )
                })}
                {/* Quick swap button within same match */}
                {pair[0]?.userId && pair[1]?.userId && (
                  <button
                    title="Swap these two"
                    onClick={() => swapSlots(editRound, pairIdx, 0, pairIdx, 1)}
                    style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, flexShrink: 0 }}
                  >
                    <i className="ri-arrow-left-right-line" />
                  </button>
                )}
              </div>
            )
          })}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {changed && (
              <button onClick={resetChanges} style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                <i className="ri-refresh-line" /> Reset
              </button>
            )}
            <button
              onClick={applyChanges}
              disabled={applying || !changed}
              style={{
                flex: 2, padding: '10px', borderRadius: 10, border: 'none',
                background: changed ? 'var(--accent)' : 'var(--border)',
                color: changed ? '#fff' : 'var(--text-muted)',
                fontWeight: 700, fontSize: 13, cursor: changed ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              {applying ? <><i className="ri-loader-4-line" /> Saving…</> : <><i className="ri-check-double-line" /> Apply to Bracket</>}
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>
            Changes only affect {roundLabel(editRound)} slots. No points are changed.
          </p>
        </>
      )}
    </div>
  )
}


// ─── Sub-components ───────────────────────────────────────────────────────────

function ChampDisplay({ entry, styles, isAdmin, onSetWinner, leaderboard, participants }) {
  const isPending = !entry || entry.status === 'pending' || entry.status === 'bye'
  const isWinner = entry?.status === 'winner'
  const champPts = leaderboard?.find(e => e.user_id === entry?.userId)?.points ?? null
  const champProfile = entry?.userId ? participants?.find(x => x.user_id === entry.userId)?.profiles : null
  const displayName = champProfile?.username || entry?.name

  return (
    <div className={`${styles.champDisplay} ${isWinner ? styles.champDisplayWinner : ''}`}>
      <div className={styles.champCrown}><i className="ri-vip-crown-fill" /></div>
      <div className={styles.champSlot}>
        {isPending
          ? <span className={styles.champTBD}>TBD</span>
          : <>
              <SlotAvatar entry={entry} size="lg" liveProfile={champProfile} />
              <span className={styles.champName} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {displayName}
                <UserBadges email={champProfile?.email} countryFlag={champProfile?.country_flag} isSeasonWinner={champProfile?.is_season_winner} size={13} gap={2} />
              </span>
              {isWinner && champPts != null && <span className={styles.champPtsBadge}><i className="ri-star-fill" /> {champPts} pts</span>}
              {isWinner && <span className={styles.champWinnerBadge}><i className="ri-trophy-fill" /> Champion</span>}
              {isAdmin && !isWinner && (
                <button className={`${styles.slotAction} ${styles.slotActionWin}`} style={{ marginTop: 6 }} onClick={onSetWinner}>
                  <i className="ri-trophy-fill" /> Crown Champion (+30 pts bonus)
                </button>
              )}
            </>
        }
      </div>
    </div>
  )
}

function MatchCard({ pair, styles, isAdmin, onSetStatus, onSwap, passPoints, leaderboard, participants, onJoin }) {
  const [a, b] = pair
  const [activeSheet, setActiveSheet] = useState(null)
  // FIX #4: removed unused swapMode state
  const router = useRouter()

  const isByeMatch = a?.status === 'bye' || b?.status === 'bye'

  function getEarnedPts(entry) {
    if (!entry?.userId || !leaderboard) return null
    return leaderboard.find(e => e.user_id === entry.userId)?.points ?? null
  }
  function getEntryProfile(entry) {
    if (!entry?.userId) return null
    return participants?.find(x => x.user_id === entry.userId)?.profiles || null
  }
  function openSheet(slotIdx, entry) {
    if (!isAdmin || !entry?.userId || entry.status === 'pending' || entry.status === 'bye' || entry.status === 'open') return
    setActiveSheet({ slotIdx, entry })
  }
  function closeSheet() { setActiveSheet(null) }
  function handleAction(action) {
    if (!activeSheet) return
    const idx = activeSheet.slotIdx
    closeSheet()
    if (action === 'remove') { onSetStatus(idx, 'remove'); return }
    onSetStatus(idx, action === 'pass' ? 'winner' : action === 'elim' ? 'eliminated' : 'disqualified')
  }
  function handleSwapWith(targetSIdx) {
    if (!activeSheet || !onSwap) return
    // Swap within this match: both slots in same pair, so pass targetSIdx as the target slot in the same pair
    onSwap(activeSheet.slotIdx, targetSIdx)
    closeSheet()
  }

  const sheetEntry = activeSheet?.entry
  const sheetProfile = sheetEntry ? getEntryProfile(sheetEntry) : null
  const sheetEarnedPts = sheetEntry ? getEarnedPts(sheetEntry) : null
  // The "other" slot in this match (for in-match swap)
  const otherSlotIdx = activeSheet?.slotIdx === 0 ? 1 : 0
  const otherEntry = activeSheet ? (otherSlotIdx === 0 ? a : b) : null
  const otherProfile = otherEntry ? getEntryProfile(otherEntry) : null

  return (
    <>
      <div className={`${styles.matchCard} ${isByeMatch ? styles.matchCardBye : ''}`}>
        <SlotRow
          entry={a} styles={styles} isAdmin={isAdmin}
          onOpen={() => openSheet(0, a)}
          passPoints={passPoints} earnedPts={getEarnedPts(a)} entryProfile={getEntryProfile(a)}
          onJoin={a?.status === 'open' && onJoin ? () => onJoin(0) : undefined}
        />
        <div className={styles.matchDivider}><span className={styles.vsLabel}>vs</span></div>
        <SlotRow
          entry={b} styles={styles} isAdmin={isAdmin}
          onOpen={() => openSheet(1, b)}
          passPoints={passPoints} earnedPts={getEarnedPts(b)} entryProfile={getEntryProfile(b)}
          onJoin={b?.status === 'open' && onJoin ? () => onJoin(1) : undefined}
        />
      </div>

      {activeSheet && (
        <div className={styles.sheetOverlay} onClick={closeSheet}>
          <div className={styles.sheetBox} onClick={e => e.stopPropagation()}>
            <div className={styles.sheetHandle} />

            {/* Player identity */}
            <div className={styles.sheetPlayer}>
              <SlotAvatar entry={sheetEntry} size="lg" liveProfile={sheetProfile} />
              <div className={styles.sheetPlayerInfo}>
                <span className={styles.sheetPlayerName}>
                  {sheetProfile?.username || sheetEntry.name}
                  <UserBadges email={sheetProfile?.email} countryFlag={sheetProfile?.country_flag} isSeasonWinner={sheetProfile?.is_season_winner} size={13} gap={2} />
                </span>
                <span className={styles.sheetPlayerMeta}>
                  {sheetEntry.status === 'winner'      && <><i className="ri-arrow-right-circle-fill" style={{ color: '#f59e0b' }} /> Passing · {sheetEarnedPts != null ? `${sheetEarnedPts} pts` : ''}</>}
                  {sheetEntry.status === 'eliminated'  && <><i className="ri-close-circle-fill" style={{ color: '#dc2626' }} /> Eliminated</>}
                  {sheetEntry.status === 'disqualified'&& <><i className="ri-spam-2-fill" style={{ color: '#7c3aed' }} /> Disqualified</>}
                  {sheetEntry.status === 'active'      && <><i className="ri-checkbox-circle-fill" style={{ color: 'var(--accent)' }} /> Active</>}
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className={styles.sheetActions}>
              <button className={`${styles.sheetBtn} ${styles.sheetBtnPass}`} onClick={() => handleAction('pass')} disabled={sheetEntry.status === 'winner'}>
                <div className={styles.sheetBtnIcon} style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                  <i className="ri-arrow-right-circle-fill" />
                </div>
                <div className={styles.sheetBtnText}>
                  <span>Pass to next round</span>
                  <span className={styles.sheetBtnSub}>+{passPoints} pts awarded</span>
                </div>
                {sheetEntry.status === 'winner' && <i className="ri-checkbox-circle-fill" style={{ color: '#f59e0b', marginLeft: 'auto', fontSize: 16 }} />}
              </button>

              <button className={`${styles.sheetBtn} ${styles.sheetBtnElim}`} onClick={() => handleAction('elim')} disabled={sheetEntry.status === 'eliminated'}>
                <div className={styles.sheetBtnIcon} style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>
                  <i className="ri-close-circle-fill" />
                </div>
                <div className={styles.sheetBtnText}>
                  <span>Eliminate</span>
                  <span className={styles.sheetBtnSub}>Remove from bracket</span>
                </div>
                {sheetEntry.status === 'eliminated' && <i className="ri-checkbox-circle-fill" style={{ color: '#dc2626', marginLeft: 'auto', fontSize: 16 }} />}
              </button>

              <button className={`${styles.sheetBtn} ${styles.sheetBtnDQ}`} onClick={() => handleAction('dq')} disabled={sheetEntry.status === 'disqualified'}>
                <div className={styles.sheetBtnIcon} style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>
                  <i className="ri-spam-2-fill" />
                </div>
                <div className={styles.sheetBtnText}>
                  <span>Disqualify</span>
                  <span className={styles.sheetBtnSub}>Flag as rule violation</span>
                </div>
                {sheetEntry.status === 'disqualified' && <i className="ri-checkbox-circle-fill" style={{ color: '#7c3aed', marginLeft: 'auto', fontSize: 16 }} />}
              </button>

              {/* Swap with opponent in same match */}
              {otherEntry?.userId && (
                <button className={styles.sheetBtn} onClick={() => handleSwapWith(otherSlotIdx)}
                  style={{ borderTop: '1px solid var(--border)', marginTop: 4 }}>
                  <div className={styles.sheetBtnIcon} style={{ background: 'rgba(99,102,241,0.10)', color: '#6366f1' }}>
                    <i className="ri-arrow-left-right-line" />
                  </div>
                  <div className={styles.sheetBtnText}>
                    <span>Swap with {otherProfile?.username || otherEntry.name}</span>
                    <span className={styles.sheetBtnSub}>Switch positions in this match</span>
                  </div>
                </button>
              )}

              <button className={`${styles.sheetBtn} ${styles.sheetBtnDQ}`} onClick={() => handleAction('remove')}
                style={{ borderTop: '1px solid var(--border)', marginTop: 4 }}>
                <div className={styles.sheetBtnIcon} style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
                  <i className="ri-user-unfollow-line" />
                </div>
                <div className={styles.sheetBtnText}>
                  <span style={{ color: '#ef4444' }}>Remove from bracket</span>
                  <span className={styles.sheetBtnSub}>Slot becomes open again</span>
                </div>
              </button>
            </div>

            {/* CTA row */}
            <div className={styles.sheetCTARow}>
              <button className={styles.sheetCTAProfile} onClick={() => { closeSheet(); router.push(`/profile/${sheetEntry.userId}`) }}>
                <i className="ri-user-3-line" /> View Profile
              </button>
              <SheetFollowBtn userId={sheetEntry?.userId} />
            </div>
            <button className={styles.sheetCancel} onClick={closeSheet}>Cancel</button>
          </div>
        </div>
      )}
    </>
  )
}

function SlotRow({ entry, styles, isAdmin, onOpen, passPoints, earnedPts, entryProfile, onJoin }) {
  if (!entry || entry.status === 'bye') return (
    <div className={`${styles.slotRow} ${styles.slotRowBye}`}>
      <div className={styles.slotRowAvatarEmpty}><i className="ri-user-line" /></div>
      <span className={styles.slotRowName}>BYE</span>
    </div>
  )
  if (entry.status === 'open') return (
    <div
      className={`${styles.slotRow} ${styles.slotRowBye}`}
      style={{ cursor: onJoin ? 'pointer' : 'default' }}
      onClick={onJoin || undefined}
    >
      <div className={styles.slotRowAvatarEmpty} style={{ border: onJoin ? '1.5px dashed var(--accent)' : undefined, color: onJoin ? 'var(--accent)' : undefined }}>
        <i className={onJoin ? 'ri-add-line' : 'ri-user-line'} />
      </div>
      <span className={styles.slotRowName} style={{ color: onJoin ? 'var(--accent)' : 'var(--text-muted)' }}>
        {onJoin ? 'Join here' : 'Open'}
      </span>
      {onJoin && <span style={{ marginLeft: 'auto', fontSize: 10, background: 'var(--accent)', color: '#fff', padding: '2px 7px', borderRadius: 6, flexShrink: 0 }}>+ Join</span>}
    </div>
  )
  const isPending = entry.status === 'pending'
  const isWinner = entry.status === 'winner'
  const isElim = entry.status === 'eliminated'
  const isDQ = entry.status === 'disqualified'
  const canEdit = isAdmin && !isPending && !!entry.userId
  const displayName = entryProfile?.username || entry.name

  return (
    <div
      className={`${styles.slotRow} ${isWinner ? styles.slotRowWinner : ''} ${isElim ? styles.slotRowEliminated : ''} ${isDQ ? styles.slotRowDQ : ''} ${isPending ? styles.slotRowPending : ''}`}
      onClick={() => canEdit && onOpen()}
      style={{ cursor: canEdit ? 'pointer' : 'default' }}
    >
      <SlotAvatar entry={entry} size="sm" liveProfile={entryProfile} />
      <span className={styles.slotRowName} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        {displayName}
        <UserBadges email={entryProfile?.email} countryFlag={entryProfile?.country_flag} isSeasonWinner={entryProfile?.is_season_winner} size={10} gap={2} />
      </span>
      {isWinner && earnedPts != null && <span className={styles.slotPtsBadge}>{earnedPts} pts</span>}
      {!isWinner && !isElim && !isDQ && passPoints != null && entry.userId && <span className={styles.slotPtsPreview}>+{passPoints}</span>}
      {isWinner   && <i className={`ri-arrow-right-circle-fill ${styles.statusIconWin}`} />}
      {isElim     && <i className={`ri-close-circle-fill ${styles.statusIconElim}`} />}
      {isDQ       && <i className={`ri-spam-2-fill ${styles.statusIconDQ}`} />}
      {isPending  && <span className={styles.pendingDot} />}
      {canEdit    && <i className="ri-more-2-fill" style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }} />}
    </div>
  )
}

function SlotAvatar({ entry, size = 'sm', liveProfile = null }) {
  const sz = size === 'lg' ? 40 : 22
  const fs = size === 'lg' ? 13 : 8
  if (!entry) return null
  const avatarUrl = liveProfile?.avatar_url || entry?.avatar
  const displayName = liveProfile?.username || entry?.name || '?'
  return avatarUrl
    ? <img src={avatarUrl} style={{ width: sz, height: sz, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} alt="" />
    : <div style={{ width: sz, height: sz, borderRadius: '50%', background: 'var(--surface)', border: '1px solid var(--border-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs, fontWeight: 800, color: 'var(--text-dim)', flexShrink: 0 }}>
        {displayName.slice(0, 2).toUpperCase()}
      </div>
}

function SheetFollowBtn({ userId }) {
  const { user } = useAuth()
  const [following, setFollowing] = React.useState(false)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!user || !userId || user.id === userId) { setLoading(false); return }
    supabase.from('follows').select('id').eq('follower_id', user.id).eq('following_id', userId).maybeSingle()
      .then(({ data }) => { setFollowing(!!data); setLoading(false) })
  }, [user, userId])

  if (!user || user.id === userId) return null

  async function toggle() {
    if (loading) return
    setLoading(true)
    try {
      if (following) {
        await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', userId)
        setFollowing(false)
      } else {
        await supabase.from('follows').insert({ follower_id: user.id, following_id: userId })
        setFollowing(true)
      }
    } catch (e) { console.error('SheetFollowBtn:', e) }
    finally { setLoading(false) }
  }

  return (
    <button className={`${styles.sheetCTAFollow} ${following ? styles.sheetCTAFollowing : ''}`} onClick={toggle} disabled={loading}>
      <i className={following ? 'ri-user-follow-fill' : 'ri-user-add-line'} />
      {following ? 'Following' : 'Follow'}
    </button>
  )
}
