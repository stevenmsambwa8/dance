'use client'
import { getCurrentSeason, computeLevelAfterWin } from '@/lib/seasons'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../../../components/AuthProvider'
import { useAuthGate } from '../../../components/AuthGateModal'
import { supabase } from '../../../lib/supabase'
import { GAME_META } from '../../../lib/constants'
import styles from './page.module.css'
import UserBadges from '../../../components/UserBadges'
import usePageLoading from '../../../components/usePageLoading'
import { useCurrency } from '../../../lib/useCurrency'
import { canDo, underLimit, getActivePlan } from '../../../lib/plans'
import UpgradeModal from '../../../components/UpgradeModal'
import BracketShareModal from '../../../components/BracketShareModal'
import MarqueeText from '../../../components/MarqueeText'
import { computeStandings, buildGroups, addMemberToGroup } from '../../../lib/groupStage'

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

// ── Round label helpers ────────────────────────────────────────────────────────
// Priority: 1) custom names stored in bracket_data.round_names  2) fallback math
function getRoundLabelSimple(rIdx, totalRounds, bracketSize, customNames) {
  // Custom name set by creator takes highest priority
  if (customNames?.[rIdx]) return customNames[rIdx]
  const fromEnd = (totalRounds - 2) - rIdx   // 0=Final,1=Semi,2=QF,...
  if (fromEnd === 0) return 'Final'
  if (fromEnd === 1) return 'Semi Final'
  if (fromEnd === 2) return 'Quarter Final'
  if (bracketSize >= 16 && fromEnd === 3) return 'Round of 16'
  if (bracketSize >= 32 && fromEnd === 4) return 'Round of 32'
  if (bracketSize >= 64 && fromEnd === 5) return 'Round of 64'
  return `Round ${rIdx + 1}`
}
function getRoundLabel(rIdx, totalRounds, bracketSize, customNames) {
  if (customNames?.[rIdx]) return customNames[rIdx]
  if (rIdx === totalRounds - 1) return 'Champion'
  return getRoundLabelSimple(rIdx, totalRounds, bracketSize, customNames)
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
 *  - When teamSize > 1, players are grouped into teams. Each bracket slot
 *    is a TEAM (array of player slots). Matches are team vs team.
 */
function buildBracket(parts, teamSize = 1) {
  if (!parts || parts.length < 2) return null

  // ── Team mode: group participants into teams ──────────────────────────
  if (teamSize > 1) {
    const shuffled = [...parts].sort(() => Math.random() - 0.5)
    // Group into teams of teamSize
    const teams = []
    for (let i = 0; i < shuffled.length; i += teamSize) {
      const members = shuffled.slice(i, i + teamSize).map(p => ({
        userId: p.user_id,
        name: p.profiles?.username || '?',
        avatar: p.profiles?.avatar_url || null,
        status: 'active',
      }))
      // Pad team with empty slots if not enough members
      while (members.length < teamSize) {
        members.push({ userId: null, name: '—', avatar: null, status: 'empty' })
      }
      teams.push({ members, status: 'active', teamId: `team_${i}` })
    }
    if (teams.length < 2) return null

    const size = nextPow2(teams.length)
    const byeCount = size - teams.length
    for (let i = 0; i < byeCount; i++) {
      teams.push({
        members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'BYE', avatar: null, status: 'bye' })),
        status: 'bye', teamId: `bye_${i}`,
      })
    }

    const rounds = []
    let current = teams
    while (current.length > 1) {
      const pairs = []
      for (let i = 0; i < current.length; i += 2) {
        pairs.push([{ ...current[i] }, { ...current[i + 1] }])
      }
      rounds.push(pairs)
      current = pairs.map(() => ({
        members: Array.from({ length: teamSize }, () => ({ userId: null, name: '?', avatar: null, status: 'pending' })),
        status: 'pending', teamId: null,
      }))
    }
    rounds.push([[{ members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'TBD', avatar: null, status: 'pending' })), status: 'pending', teamId: null }, null]])
    return { rounds, bracketSize: size, byeCount, teamSize, isTeamBattle: true }
  }

  // ── Solo mode (original logic) ────────────────────────────────────────
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
function buildLobbyBracket(maxSlots, teamSize = 1, squadsNeeded = null) {
  if (!maxSlots || maxSlots < 2) return null
  const size = nextPow2(maxSlots)

  // ── Team lobby mode ───────────────────────────────────────────────────
  if (teamSize > 1) {
    const totalTeamCount = Math.ceil(size / teamSize)
    // FIX: if squadsNeeded is set, only that many squads are shown as open/active;
    // remaining team slots in the bracket are hidden as inactive placeholders
    const activeTeamCount = (squadsNeeded && squadsNeeded > 0 && squadsNeeded <= totalTeamCount)
      ? squadsNeeded
      : totalTeamCount
    const openTeam = (idx) => ({
      members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'Open', avatar: null, status: 'open' })),
      status: 'open', teamId: `squad_${idx}`,
    })
    const inactiveTeam = (idx) => ({
      members: Array.from({ length: teamSize }, () => ({ userId: null, name: '—', avatar: null, status: 'inactive' })),
      status: 'inactive', teamId: `squad_${idx}`,
    })
    const teams = Array.from({ length: totalTeamCount }, (_, i) =>
      i < activeTeamCount ? openTeam(i) : inactiveTeam(i)
    )
    const rounds = []
    let current = teams
    while (current.length > 1) {
      const pairs = []
      for (let i = 0; i < current.length; i += 2) {
        pairs.push([{ ...current[i] }, { ...current[i + 1] }])
      }
      rounds.push(pairs)
      current = pairs.map(() => ({
        members: Array.from({ length: teamSize }, () => ({ userId: null, name: '?', avatar: null, status: 'pending' })),
        status: 'pending', teamId: null,
      }))
    }
    rounds.push([[{ members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'TBD', avatar: null, status: 'pending' })), status: 'pending', teamId: null }, null]])
    return { rounds, bracketSize: size, isEmpty: true, teamSize, squadsNeeded: activeTeamCount, isTeamBattle: true }
  }

  // ── Solo lobby mode (original) ────────────────────────────────────────
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
        if (!slot || slot.status !== 'winner') return
        if (bracketData.isTeamBattle) {
          ;(slot.members || []).forEach(m => {
            if (m?.userId) wins[m.userId] = (wins[m.userId] || 0) + 1
          })
        } else {
          if (slot.userId) wins[slot.userId] = (wins[slot.userId] || 0) + 1
        }
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
  let found = false
  let deepestActive = -1
  let isEliminated = false

  bracketData.rounds.forEach((pairs, rIdx) => {
    pairs.forEach(pair => {
      pair.forEach(slot => {
        if (!slot || slot.status === 'bye') return
        // Team mode: check inside members array
        if (bracketData.isTeamBattle) {
          const member = (slot.members || []).find(m => m?.userId === userId)
          if (!member) return
          found = true
          const isOut = slot.status === 'eliminated' || slot.status === 'disqualified'
          if (!isOut && rIdx > deepestActive) deepestActive = rIdx
          if (isOut) isEliminated = true
        } else {
          if (slot.userId !== userId) return
          found = true
          const isOut = slot.status === 'eliminated' || slot.status === 'disqualified'
          if (!isOut && rIdx > deepestActive) deepestActive = rIdx
          if (isOut) isEliminated = true
        }
      })
    })
  })

  if (!found) return null
  if (isEliminated && deepestActive === -1) return 'out'

  const fromEnd = (totalRounds - 1) - deepestActive
  if (fromEnd === 0) return 'champion'
  if (fromEnd === 1) return 'final'
  if (fromEnd === 2) return 'semi'
  if (fromEnd === 3) return 'quarter'
  return 'in'
}

function buildMatchHistory(userId, bracketData) {
  if (!bracketData?.rounds || !userId) return []
  const history = []
  const totalRounds = bracketData.rounds.length
  bracketData.rounds.slice(0, totalRounds - 1).forEach((pairs, rIdx) => {
    pairs.forEach(pair => {
      let me, opp
      if (bracketData.isTeamBattle) {
        me  = pair.find(t => t?.members?.some(m => m?.userId === userId))
        opp = pair.find(t => !t?.members?.some(m => m?.userId === userId))
        if (!me) return
        const myName = me.teamName || (me.members || []).filter(m => m?.userId).map(m => m.name.slice(0, 3)).join('').slice(0, 8) || 'My Team'
        const oppName = opp ? (opp.teamName || (opp.members || []).filter(m => m?.userId).map(m => m.name.slice(0, 3)).join('').slice(0, 8) || 'Opponents') : 'BYE'
        history.push({
          round: getRoundLabelSimple(rIdx, totalRounds, bracketData.bracketSize, bracketData?.round_names),
          opponentName: oppName,
          status: me.status,
          isTeam: true,
        })
      } else {
        me  = pair.find(s => s?.userId === userId)
        opp = pair.find(s => s?.userId !== userId)
        if (!me) return
        history.push({
          round: getRoundLabelSimple(rIdx, totalRounds, bracketData.bracketSize, bracketData?.round_names),
          opponentName: opp?.name || 'BYE',
          status: me.status,
        })
      }
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
    const label = getRoundLabelSimple(rIdx, totalRounds, bracketData.bracketSize, bracketData?.round_names)
    lines.push(`── ${label} ──`)
    pairs.forEach((pair) => {
      const [a, b] = pair
      let aName, bName
      if (bracketData.isTeamBattle) {
        const tName = (t) => t?.teamName || (t?.members || []).filter(m => m?.userId).map(m => m.name.slice(0,3)).join('').slice(0,8) || (t?.status === 'bye' ? 'BYE' : 'TBD')
        aName = tName(a)
        bName = tName(b)
      } else {
        aName = a?.name || '?'
        bName = b?.name || (b?.status === 'bye' ? 'BYE' : '?')
      }
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
  // Minimized knockout scale — same everywhere, mirrors group-stage football
  // scoring so bracket points stay comparable to group points:
  //   win = 3, draw = 1 (n/a in single-elim, kept for symmetry), loss = 0.
  // "Eliminated" is a small consolation point for reaching the bracket at all.
  return {
    winnerPts: 3,
    loserPts: 1,   // awarded to whoever is eliminated in this match
  }
}

// Points penalty applied when a player/team is disqualified mid-bracket.
// Disqualification actively removes points from their total (not just 0).
const DQ_PENALTY = -5

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
      {profile && <UserBadges email={profile.email} plan={profile.plan} planExpiresAt={profile.plan_expires_at} countryFlag={profile.country_flag} isSeasonWinner={profile.is_season_winner} size={10} gap={2} />}
      {/* Winner tag */}
      {won && <span style={{ fontSize: 9, fontWeight: 800, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', padding: '2px 6px', borderRadius: 5, letterSpacing: '0.06em' }}>WINNER</span>}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TournamentDetail() {
  const { slug } = useParams()
  const router = useRouter()
  const { user, isAdmin, profile } = useAuth()
  const { openAuthGate } = useAuthGate()
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [upgradeFeature, setUpgradeFeature] = useState('pro_tournaments')
  const { fmtAmt } = useCurrency(profile?.country_flag ?? null)

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
  const [saving, setSaving] = useState(false)
  const [historyModal, setHistoryModal] = useState(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [bracketShareCopied, setBracketShareCopied] = useState(false)
  const [bracketShareModal, setBracketShareModal] = useState(false)
  const [shareCardMode, setShareCardMode] = useState('bracket') // 'bracket' | 'standings'
  const [shareGroupId, setShareGroupId] = useState(null) // null = all groups, else scope card to one group
  const [expandedFixtures, setExpandedFixtures] = useState({}) // { [groupId]: boolean }

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
  const [paySlugCopied, setPaySlugCopied]   = useState(null)
  const [creatorProfile, setCreatorProfile] = useState(null)
  const [testTimeLeft, setTestTimeLeft]   = useState(null) // ms remaining for test tournament

  // ── Clan tournament ────────────────────────────────────────────────────
  const [clanInfo, setClanInfo]                 = useState(null)   // { id, code, name, logo_url, tag_prefix }
  const [myClanMembership, setMyClanMembership] = useState(null)   // { role, squad_id }
  const [mySquad, setMySquad]                   = useState(null)   // { id, name, image_url }
  const [mySquads, setMySquads]                 = useState([])     // squads I'm in, across ALL clans — for open (non clan-restricted) team tournaments
  const [selectedSquadId, setSelectedSquadId]   = useState(undefined) // undefined = not asked yet, null = chose solo, else a squad id
  const [squadPicker, setSquadPicker]           = useState(null)   // { pendingAction: 'register' | { pi, si, mi } } while the picker sheet is open

  const toastTimer   = useRef(null)
  const testExpireTimer = useRef(null)
  const bracketWrapRef = useRef(null)

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
    if (t.stage_format === 'groups_knockout') {
      setActiveTab(cur => cur === 'bracket' ? 'groups' : cur)
    }
    const _loadParsed   = parseBracketData(t.bracket_data)
    const _loadTeamSize = t.team_size || 1
    const _loadSquads   = t.squads_needed || null
    let _loadFinal
    if (!_loadParsed) {
      _loadFinal = (t.slots >= 2 && t.stage_format !== 'groups_knockout') ? buildLobbyBracket(t.slots, _loadTeamSize, _loadSquads) : null
    } else {
      const _loadMode     = _loadParsed.isTeamBattle ? (_loadParsed.teamSize || 2) : 1
      const _loadMismatch = _loadMode !== _loadTeamSize
      if (_loadMismatch && _loadParsed.isEmpty) {
        // Empty lobby built with wrong team_size — silently rebuild
        _loadFinal = buildLobbyBracket(t.slots, _loadTeamSize, _loadSquads)
      } else if (_loadMismatch && !_loadParsed.isEmpty) {
        // Players exist but bracket mode doesn't match team_size — flag it
        _loadFinal = { ..._loadParsed, teamSizeMismatch: true, currentTeamSize: _loadTeamSize }
      } else {
        _loadFinal = _loadParsed
      }
    }
    setBracketData(_loadFinal)
    setLoadingTournament(false)

    if (t.created_by) {
      supabase.from('profiles').select('id, username, avatar_url, email, country_flag, is_season_winner, plan, plan_expires_at').eq('id', t.created_by).single().then(({ data }) => setCreatorProfile(data))
    }

    const [partsRes, lbRes] = await Promise.all([
      supabase.from('tournament_participants')
        .select('*, profiles(username, avatar_url, email, country_flag, is_season_winner, plan, plan_expires_at)')
        .eq('tournament_id', t.id),
      supabase.from('tournament_leaderboard')
        .select('*, profiles(username, avatar_url, email, country_flag, is_season_winner, plan, plan_expires_at)')
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

  // ── Clan tournament: load clan info + my membership/squad in it ──────────
  useEffect(() => {
    if (!tournament?.clan_id) { setClanInfo(null); setMyClanMembership(null); setMySquad(null); return }
    supabase.from('clans').select('id,code,name,logo_url,tag_prefix').eq('id', tournament.clan_id).single()
      .then(({ data }) => setClanInfo(data))

    if (!user) { setMyClanMembership(null); setMySquad(null); return }
    supabase.from('clan_members').select('role,squad_id').eq('clan_id', tournament.clan_id).eq('user_id', user.id).maybeSingle()
      .then(({ data: membership }) => {
        setMyClanMembership(membership || null)
        if (membership?.squad_id) {
          supabase.from('clan_squads').select('id,name,image_url').eq('id', membership.squad_id).single()
            .then(({ data }) => setMySquad(data))
        } else {
          setMySquad(null)
        }
      })
  }, [tournament?.clan_id, user])

  // ── Team tournaments: load squads I'm allowed to REGISTER (never a plain member) ──
  // Qualifies if I'm that squad's leader, or I'm the leader of the clan that owns it.
  // Any clan can field a squad — tournaments are never locked to a single clan.
  useEffect(() => {
    if ((tournament?.team_size || 1) <= 1) { setMySquads([]); return }
    if (!user) { setMySquads([]); return }
    let cancelled = false
    ;(async () => {
      const [ownSquadRes, leaderClansRes] = await Promise.all([
        supabase.from('clan_members')
          .select('squad_id, clan_squads(id, name, image_url, member_count), clans(id, name, code, logo_url)')
          .eq('user_id', user.id).eq('role', 'squad_leader').not('squad_id', 'is', null),
        supabase.from('clan_members')
          .select('clan_id, clans(id, name, code, logo_url)')
          .eq('user_id', user.id).eq('role', 'leader'),
      ])
      if (ownSquadRes.error) console.error('load own squads:', ownSquadRes.error)
      if (leaderClansRes.error) console.error('load leader clans:', leaderClansRes.error)

      const leaderClanIds = (leaderClansRes.data || []).map(r => r.clan_id)
      let clanLedSquads = []
      if (leaderClanIds.length > 0) {
        const { data, error } = await supabase.from('clan_squads')
          .select('id, name, image_url, member_count, clan_id')
          .in('clan_id', leaderClanIds)
        if (error) console.error('load clan-led squads:', error)
        const clanById = Object.fromEntries((leaderClansRes.data || []).map(r => [r.clan_id, r.clans]))
        clanLedSquads = (data || []).map(sq => ({ id: sq.id, name: sq.name, image_url: sq.image_url, member_count: sq.member_count, clan: clanById[sq.clan_id], asLeader: true }))
      }

      const ownSquads = (ownSquadRes.data || [])
        .filter(row => row.clan_squads)
        .map(row => ({ id: row.clan_squads.id, name: row.clan_squads.name, image_url: row.clan_squads.image_url, member_count: row.clan_squads.member_count, clan: row.clans }))

      const merged = [...ownSquads]
      clanLedSquads.forEach(sq => { if (!merged.some(m => m.id === sq.id)) merged.push(sq) })
      if (!cancelled) setMySquads(merged)
    })()
    return () => { cancelled = true }
  }, [tournament?.team_size, user])

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
        // Always rebuild the lobby bracket from fresh t.team_size so a
        // solo→team upgrade made on /manage is immediately reflected here
;(() => {
          const _parsedBd2   = parseBracketData(t.bracket_data)
          const _dbTeamSize2 = t.team_size || 1
          const _dbSquads2   = t.squads_needed || null
          const _bMode2      = _parsedBd2 ? (_parsedBd2.isTeamBattle ? (_parsedBd2.teamSize || 2) : 1) : null
          const _mismatch2   = _parsedBd2 && (_bMode2 !== _dbTeamSize2)
          let _finalBd2
          if (!_parsedBd2) {
            _finalBd2 = (t.slots >= 2 && t.stage_format !== 'groups_knockout') ? buildLobbyBracket(t.slots, _dbTeamSize2, _dbSquads2) : null
          } else if (_mismatch2 && _parsedBd2.isEmpty) {
            _finalBd2 = buildLobbyBracket(t.slots, _dbTeamSize2, _dbSquads2)
          } else if (_mismatch2 && !_parsedBd2.isEmpty) {
            _finalBd2 = { ..._parsedBd2, teamSizeMismatch: true, currentTeamSize: _dbTeamSize2 }
          } else {
            _finalBd2 = _parsedBd2
          }
          setBracketData(_finalBd2)
        })()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_participants', filter: `tournament_id=eq.${id}` }, () => {
        supabase.from('tournament_participants')
          .select('*, profiles(username, avatar_url, email, country_flag, is_season_winner, plan, plan_expires_at)')
          .eq('tournament_id', id)
          .then(({ data }) => { if (data) setParticipants(data) })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_leaderboard', filter: `tournament_id=eq.${id}` }, () => {
        supabase.from('tournament_leaderboard')
          .select('*, profiles(username, avatar_url, email, country_flag, is_season_winner, plan, plan_expires_at)')
          .eq('tournament_id', id)
          .order('position', { ascending: true })
          .then(({ data }) => { if (data) setLeaderboard(data) })
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [id])

  // ── Utility helpers ───────────────────────────────────────────────────────

  // ── Lightweight targeted refreshes (no full page reload) ─────────────────
  // These replace the old load() calls that were causing the visible flash/reload.
  // Realtime subscriptions handle most updates automatically; these are surgical
  // fallbacks for cases where we need fresh data immediately after a write.

  async function refreshParticipants() {
    const { data } = await supabase
      .from('tournament_participants')
      .select('*, profiles(username, avatar_url, email, country_flag, is_season_winner, plan, plan_expires_at)')
      .eq('tournament_id', id)
    if (data) setParticipants(data)
  }

  async function refreshLeaderboard() {
    const { data } = await supabase
      .from('tournament_leaderboard')
      .select('*, profiles(username, avatar_url, email, country_flag, is_season_winner, plan, plan_expires_at)')
      .eq('tournament_id', id)
      .order('position', { ascending: true })
    if (data) setLeaderboard(data)
  }

  async function refreshTournament() {
    const { data: t } = await supabase.from('tournaments').select('*').eq('id', id).single()
    if (!t) return
    setTournament(t)
    const parsed = parseBracketData(t.bracket_data)
    const tSize  = t.team_size || 1
    const squads = t.squads_needed || null
    if (!parsed) {
      if (t.slots >= 2) setBracketData(buildLobbyBracket(t.slots, tSize, squads))
    } else {
      setBracketData(parsed)
    }
  }

  async function syncCount() {
    const { count, error } = await supabase
      .from('tournament_participants')
      .select('*', { count: 'exact', head: true })
      .eq('tournament_id', id)
    // FIX: guard against network errors — fall back to local participant count
    if (error || count === null) return participants.length
    await supabase.from('tournaments').update({ registered_count: count }).eq('id', id)
    return count
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
    if (!userId || !points) return
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
    try {
      const { error } = await supabase.from('tournaments').update({ bracket_data: newBd }).eq('id', id)
      if (error) {
        showToast('Failed to save bracket. Please try again.', 'error')
        console.error('saveBracket error:', error)
      } else {
      }
    } catch (e) {
      showToast('Network error saving bracket.', 'error')
      console.error('saveBracket exception:', e)
    } finally {
      setBracketSaving(false)
    }
  }

  // ── FIX #2 & #3: isFull declared early so it's available to joinViaSlot
  // and rankedLeaderboard is computed before any early returns so it's
  // always defined (with a safe empty fallback) regardless of render path. ──

  const realCount = participants.length
  // Capacity priority:
  // 1. slot_count embedded in bracket_data by BracketBuilder (real open slots from round 0)
  // 2. slots column on tournament (set at create time or updated when bracket is saved)
  const effectiveCapacity = (() => {
    if (bracketData?.slot_count > 0) return bracketData.slot_count
    if (!tournament?.slots) return 0
    const tSize = tournament.team_size || 1
    const sNeeded = tournament.squads_needed
    if (tSize > 1 && sNeeded && sNeeded > 0) return sNeeded * tSize
    return tournament.slots
  })()
  const isFull = !!effectiveCapacity && realCount >= effectiveCapacity

  // Bracket-aware ranking: deepest bracket round reached beats raw points
  const rankedLeaderboard = (() => {
    if (!tournament) return []
    const lbMap = {}
    leaderboard.forEach(e => { lbMap[e.user_id] = e })

    // Build a profiles map from participants so we can look up names/avatars
    const profileMap = {}
    participants.forEach(p => { profileMap[p.user_id] = p.profiles })

    // Union: everyone in participants OR everyone in leaderboard
    // This ensures players who got points but were removed from participants still show
    const allUserIds = new Set([
      ...participants.map(p => p.user_id),
      ...leaderboard.map(e => e.user_id),
    ])

    // ── Group-stage standings, computed live from bracket_data.groups so the
    // leaderboard always matches the real table (points + goal difference)
    // instead of the separately-incremented tournament_leaderboard counter,
    // which can only ever reflect points and drifts if a score is corrected. ──
    const groupStatsByUser = {}
    if (bracketData?.groups) {
      bracketData.groups.forEach(group => {
        computeStandings(group).forEach(row => {
          groupStatsByUser[row.id] = {
            groupPoints: row.points, played: row.played, won: row.won, drawn: row.drawn, lost: row.lost,
            goalsFor: row.goalsFor, goalsAgainst: row.goalsAgainst, goalDiff: row.goalDiff,
            groupName: group.name,
          }
        })
      })
    }

    const full = Array.from(allUserIds).map(uid => {
      const gs = groupStatsByUser[uid]
      return {
        user_id: uid,
        id: lbMap[uid]?.id || null,
        // Total = group-stage points (win 3 / draw 1 / loss 0) PLUS whatever
        // has accumulated in the bracket/knockout stage (win, eliminated,
        // and DQ penalties), so points keep counting through the whole run
        // instead of the bracket overwriting the group-stage total.
        points: (gs ? gs.groupPoints : 0) + (lbMap[uid]?.points || 0),
        goalDiff: gs?.goalDiff ?? null,
        goalsFor: gs?.goalsFor ?? null,
        groupName: gs?.groupName ?? null,
        profiles: profileMap[uid] || lbMap[uid]?.profiles || null,
        lbEntry: lbMap[uid] || null,
      }
    })

    // Tier = how far a player progressed.
    // Lower tier = better. Derived purely from bracket slot statuses:
    //   - Champion slot (active/winner in final round) → tier 0
    //   - Still active in round rIdx (not yet eliminated) → tier = rounds from final
    //   - Eliminated/DQ'd in round rIdx → tier = rounds from final + 1 (lost there)
    //   - Never appeared → tier 99
    function getBracketTier(userId) {
      if (!bracketData?.rounds || !userId) return 99
      const totalRounds = bracketData.rounds.length

      let deepestActiveRound = -1
      let eliminatedAtRound  = -1

      bracketData.rounds.forEach((pairs, rIdx) => {
        pairs.forEach(pair => {
          pair.forEach(slot => {
            if (!slot || slot.status === 'bye') return
            let userInSlot = false
            if (bracketData.isTeamBattle) {
              userInSlot = (slot.members || []).some(m => m?.userId === userId)
            } else {
              userInSlot = slot.userId === userId
            }
            if (!userInSlot) return
            const isOut = slot.status === 'eliminated' || slot.status === 'disqualified'
            if (isOut) {
              if (rIdx > eliminatedAtRound) eliminatedAtRound = rIdx
            } else {
              if (rIdx > deepestActiveRound) deepestActiveRound = rIdx
            }
          })
        })
      })

      // Never appeared in the bracket
      if (deepestActiveRound === -1 && eliminatedAtRound === -1) return 99

      // Still active: rank by how deep they currently are (later rounds = better)
      // fromEnd: 0 = final, 1 = semi, 2 = quarter, etc.
      if (deepestActiveRound >= 0) {
        const fromEnd = (totalRounds - 1) - deepestActiveRound
        // Being active in a round is better than being eliminated in that same round
        // Use negative to rank active players better than eliminated at same depth
        return fromEnd  // 0 = active in final (champion), 1 = active in semi, etc.
      }

      // Eliminated: the further they got before losing, the better their tier
      // Being eliminated at a later round is still better → smaller tier number
      const fromEnd = (totalRounds - 1) - eliminatedAtRound
      return fromEnd + 0.5  // 0.5 gap ensures eliminated at round N is below active at round N
    }

    full.forEach(e => { e._tier = getBracketTier(e.user_id) })

    // Sort: tier ASC (lower = better) → points DESC → goal difference DESC → goals scored DESC
    full.sort((a, b) => {
      if (a._tier !== b._tier) return a._tier - b._tier
      if (b.points !== a.points) return b.points - a.points
      if (a.goalDiff != null && b.goalDiff != null && b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff
      if (a.goalsFor != null && b.goalsFor != null && b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor
      return 0
    })

    // Assign positions — players only share a position if tier, points AND goal difference all match
    let pos = 1
    full.forEach((e, i) => {
      if (i > 0) {
        const prev = full[i - 1]
        if (e._tier !== prev._tier || e.points !== prev.points || e.goalDiff !== prev.goalDiff) pos = i + 1
      }
      e.position = pos
    })
    return full
  })()

  const isSquadTournament = (tournament?.team_size || 1) > 1

  // ── Squad-level leaderboard for team tournaments ──────────────────────────
  // Points are still earned per-member (group stage + bracket wins/DQ), but a
  // squad tournament should be READ as squads competing, not individual
  // players — so roll each team's members up into one row: squad name/image,
  // combined points, and who's on the roster.
  const rankedTeamLeaderboard = (() => {
    if (!isSquadTournament || !bracketData?.rounds?.[0]) return []
    const lbMap = {}
    leaderboard.forEach(e => { lbMap[e.user_id] = e })
    const groupPtsByUser = {}
    if (bracketData?.groups) {
      bracketData.groups.forEach(group => {
        computeStandings(group).forEach(row => { groupPtsByUser[row.id] = row.points })
      })
    }

    const teams = []
    bracketData.rounds[0].forEach(pair => {
      pair.forEach(team => {
        if (!team || team.status === 'bye' || team.status === 'inactive' || !team.clanSquadId) return
        const members = (team.members || []).filter(m => m?.userId)
        const points = members.reduce((sum, m) =>
          sum + (groupPtsByUser[m.userId] || 0) + (lbMap[m.userId]?.points || 0), 0)
        teams.push({
          squadId: team.clanSquadId,
          name: team.clanSquadName || team.teamName || 'Squad',
          image: team.clanSquadImage || null,
          points,
          members,
        })
      })
    })

    teams.sort((a, b) => b.points - a.points)
    let pos = 1
    teams.forEach((t, i) => {
      if (i > 0 && t.points !== teams[i - 1].points) pos = i + 1
      t.position = pos
    })
    return teams
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

  // ── Group-stage auto draw ────────────────────────────────────────────────
  // For groups_knockout tournaments, no admin click is needed to seed the
  // table: the draw opens itself the moment 2 players have joined, and every
  // player after that is randomly slotted into the smallest group so the
  // groups stay balanced as registration continues. (Solo mode only — team
  // tournaments are still drawn by the admin once squads are locked in.)
  async function autoUpdateGroupsOnJoin() {
    if (tournament?.stage_format !== 'groups_knockout') return
    if ((tournament?.team_size || 1) > 1) return
    try {
      const [{ data: freshT }, { data: freshParts }] = await Promise.all([
        supabase.from('tournaments').select('bracket_data, group_count, advance_per_group').eq('id', id).single(),
        supabase.from('tournament_participants').select('user_id, profiles(username, avatar_url)').eq('tournament_id', id),
      ])
      const freshBd = parseBracketData(freshT?.bracket_data)
      const targetGroupCount = freshT?.group_count || tournament?.group_count || 4
      const advancePerGroup = freshT?.advance_per_group || tournament?.advance_per_group || 2
      const count = freshParts?.length || 0

      if (!freshBd?.groups) {
        if (count < 2) return // draw opens once at least 2 players are in
        const groupsToOpen = Math.max(1, Math.min(targetGroupCount, Math.floor(count / 2)))
        const groups = buildGroups(freshParts, groupsToOpen, 1)
        const newBd = { stage: 'groups', groups, advancePerGroup }
        await supabase.from('tournaments').update({ bracket_data: newBd }).eq('id', id)
        setBracketData(newBd)
        return
      }

      if (freshBd.stage === 'knockout') return // group stage already finished

      const placedIds = new Set(freshBd.groups.flatMap(g => g.members.map(m => m.id ?? m.userId ?? m.teamId)))
      const unplaced = (freshParts || []).filter(p => !placedIds.has(p.user_id))
      if (unplaced.length === 0) return

      let groups = freshBd.groups
      for (const p of unplaced) {
        const newMember = { id: p.user_id, name: p.profiles?.username || '?', avatar: p.profiles?.avatar_url || null }
        const canOpenNewGroup = groups.length < targetGroupCount && groups.every(g => g.members.length >= 2)
        if (canOpenNewGroup) {
          groups = [...groups, {
            id: `group_${groups.length}`,
            name: `Group ${String.fromCharCode(65 + groups.length)}`,
            members: [newMember],
            fixtures: [],
          }]
        } else {
          const minSize = Math.min(...groups.map(g => g.members.length))
          const candidates = groups.map((g, i) => ({ g, i })).filter(x => x.g.members.length === minSize)
          const pick = candidates[Math.floor(Math.random() * candidates.length)]
          groups = groups.map((g, i) => i === pick.i ? addMemberToGroup(g, newMember) : g)
        }
      }
      const newBd = { ...freshBd, groups }
      await supabase.from('tournaments').update({ bracket_data: newBd }).eq('id', id)
      setBracketData(newBd)
    } catch (e) {
      console.error('autoUpdateGroupsOnJoin failed', e)
    }
  }

  /**
   * Resolves which squad (if any) is registering for this team tournament.
   * Any clan can field a squad — mySquads only ever contains squads the
   * current user is allowed to register (their own squad as squad leader,
   * or any squad in a clan they lead), so a hit here is always authorized.
   */
  function getEffectiveSquad(squadIdOverride) {
    const sqId = squadIdOverride !== undefined ? squadIdOverride : selectedSquadId
    if (!sqId) return null
    return mySquads.find(s => s.id === sqId) || null
  }

  async function register(squadIdOverride) {
    if (!user) { openAuthGate(); return }
    if (!isAdmin && tournament?.created_by === user.id && tournament?.stage_format !== 'groups_knockout') {
      showToast("You can't join your own tournament.", 'error'); return
    }

    const isTeamTournament = (tournament?.team_size || 1) > 1

    // ── Team tournaments: squad-only, registered by a squad or clan leader ──
    // (never an individual member joining on their own)
    let effSquad = null
    if (isTeamTournament) {
      effSquad = getEffectiveSquad(squadIdOverride)
      if (!effSquad) {
        showToast('Only a squad leader or clan leader can register a team here.', 'error'); return
      }
      if (bracketData) {
        const check = findTeamSlotForSquad(bracketData, effSquad.id)
        if (!check) { showToast('No open team slots left.', 'error'); return }
        if (check.alreadyClaimed) { showToast('Your squad is already registered.', 'info'); return }
      }
    }

    // ── Plan gates ──────────────────────────────────────────────────
    // Pro-only tournament gate
    if (!isAdmin && tournament?.pro_only) {
      const activePlan = getActivePlan(profile)
      if (activePlan === 'free') {
        setUpgradeFeature('pro_tournaments')
        setShowUpgrade(true)
        return
      }
    }

    // Free tournament limit gate (only applies to tournaments with no entrance fee)
    const isFree = !tournament?.entrance_fee || tournament.entrance_fee === 0
    if (!isAdmin && isFree) {
      if (!canDo(profile, 'free_tournaments')) {
        // Count current active free tournament registrations
        const { count } = await supabase
          .from('tournament_participants')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
        if (!underLimit(profile, 'free_tournaments', count || 0)) {
          setUpgradeFeature('free_tournaments')
          setShowUpgrade(true)
          return
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────
    if (isTeamTournament) {
      await registerSquadTeam(effSquad)
      return
    }

    setRegistering(true)
    const { error } = await supabase.from('tournament_participants').insert({ tournament_id: id, user_id: user.id })
    if (!error) {
      const count = await syncCount()
      setRegistered(true)
      setTournament(t => ({ ...t, registered_count: count }))

      if (tournament?.stage_format === 'groups_knockout') {
        await autoUpdateGroupsOnJoin()
      }

      if (bracketData?.rounds) {
        const { data: profile } = await supabase.from('profiles').select('username, avatar_url').eq('id', user.id).maybeSingle()

        let updatedBd = null

        // ── Solo mode: find any open slot in round 0 ──────────────────────
        const playerSlot = { userId: user.id, name: profile?.username || 'Player', avatar: profile?.avatar_url || null, status: 'active' }
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
            updatedBd = { ...bracketData, rounds: newRounds, isEmpty: false }
          }

        if (updatedBd) {
          try {
            await supabase.from('tournaments').update({ bracket_data: updatedBd }).eq('id', id)
            setBracketData(updatedBd)
          } catch (e) {
            console.error('register: bracket update failed', e)
            // Non-fatal — user is registered but not yet in bracket display
          }
        }
      }

      await sendNotification(user.id, `Joined — ${tournament?.name}`,
        `You've registered and been placed in the bracket!`, 'tournament', { tournament_id: id })
      awardAchievement(user.id, 'ri-group-line', 'Tournament Player', 'Registered for your first tournament')
    } else {
      showToast('Registration failed. Please try again.', 'error')
    }
    setRegistering(false)
    await refreshParticipants()
  }

  /** Register + immediately claim an open slot in round-0.
   *  In team mode: targetPIdx = pair index, targetSIdx = team slot (0 or 1),
   *  targetMIdx = member index inside that team (passed by TeamMatchCard onJoin).
   *  In solo mode: targetMIdx is undefined — behaves exactly as before.
   */
  async function joinViaSlot(targetPIdx, targetSIdx, targetMIdx) {
    if (!user) { openAuthGate(); return }
    if (!isAdmin && tournament?.created_by === user.id && tournament?.stage_format !== 'groups_knockout') {
      showToast("You can't join your own tournament.", 'error'); return
    }
    if (registered) { showToast('You are already registered.', 'info'); return }
    if (isFull) { showToast('Tournament is full.', 'error'); return }
    if (!bracketData) return

    // ── Team tournaments never join member-by-member — squads register in bulk via registerSquadTeam ──
    if ((tournament?.team_size || 1) > 1) {
      showToast('Only a squad leader or clan leader can register a team — use the Join Tournament button.', 'info')
      return
    }

    setRegistering(true)

    // ── Solo mode (original) ──────────────────────────────────────────────
    // Pre-check with stale state (fast UI feedback)
    const preCheckSlot = bracketData.rounds[0]?.[targetPIdx]?.[targetSIdx]
    if (preCheckSlot?.userId || (preCheckSlot?.status !== 'open' && preCheckSlot?.status !== 'bye')) {
      showToast('That slot was just taken. Pick another.', 'error'); setRegistering(false); return
    }

    const { error: regErr } = await supabase.from('tournament_participants').insert({ tournament_id: id, user_id: user.id })
    if (regErr) { showToast('Failed to register. Try again.', 'error'); setRegistering(false); return }

    const [profileRes, freshTRes] = await Promise.all([
      supabase.from('profiles').select('username, avatar_url').eq('id', user.id).maybeSingle(),
      // FIX: fetch fresh bracket_data to avoid overwriting a concurrent solo join
      supabase.from('tournaments').select('bracket_data').eq('id', id).single(),
    ])
    const profile = profileRes.data
    const playerSlot = { userId: user.id, name: profile?.username || 'Player', avatar: profile?.avatar_url || null, status: 'active' }

    const freshBdSolo = parseBracketData(freshTRes.data?.bracket_data) ?? bracketData
    // Verify slot is still open in fresh data
    const freshSlot = freshBdSolo.rounds[0]?.[targetPIdx]?.[targetSIdx]
    if (freshSlot?.userId || (freshSlot?.status !== 'open' && freshSlot?.status !== 'bye')) {
      // Slot taken by someone else — roll back and bail
      await supabase.from('tournament_participants').delete().eq('tournament_id', id).eq('user_id', user.id)
      showToast('That slot was just taken. Pick another.', 'error'); setRegistering(false); return
    }

    const newRounds = freshBdSolo.rounds.map((r, ri) => ri !== 0 ? r : r.map((pair, pi) => {
      if (pi !== targetPIdx) return pair
      return pair.map((s, si) => si === targetSIdx ? playerSlot : s)
    }))
    const updatedBd = { ...freshBdSolo, rounds: newRounds, isEmpty: false }
    await supabase.from('tournaments').update({ bracket_data: updatedBd }).eq('id', id)
    setBracketData(updatedBd)

    const count = await syncCount()
    setRegistered(true)
    setTournament(t => ({ ...t, registered_count: count }))
    await sendNotification(user.id, `Joined — ${tournament?.name}`, `You've joined and claimed a bracket slot!`, 'tournament', { tournament_id: id })
    setRegistering(false)
    await refreshParticipants()
  }

  /**
   * Whether we need to ask WHICH squad to register with, because the
   * player leads more than one qualifying squad. If they only lead one,
   * we skip the sheet and register it directly.
   */
  function needsSquadPicker() {
    return (tournament?.team_size || 1) > 1 && mySquads.length > 1 && selectedSquadId === undefined
  }

  function attemptRegister() {
    const isTeamTournament = (tournament?.team_size || 1) > 1
    if (isTeamTournament) {
      if (mySquads.length === 0) {
        showToast('Only a squad leader or clan leader can register a team for this tournament.', 'error')
        return
      }
      if (mySquads.length === 1) { register(mySquads[0].id); return }
      if (needsSquadPicker()) { setSquadPicker({ pendingAction: { type: 'register' } }); return }
      register(selectedSquadId)
      return
    }
    register()
  }

  // Team slots come in two flavors once squads are involved:
  //  - Unclaimed team → only a squad/clan leader can claim it (registerSquadTeam).
  //  - A squad already claimed it but has empty seats left → anyone can fill
  //    a seat directly, as long as they're told it also enrolls them in that
  //    clan and squad as a real member (not just a tournament stand-in).
  function attemptJoinViaSlot(pi, si, mi) {
    if ((tournament?.team_size || 1) > 1) {
      const team = bracketData?.rounds?.[0]?.[pi]?.[si]
      const isOpenMember = m => !m?.userId || m.status === 'open' || m.status === 'empty' || m.status === 'pending'
      if (team?.clanSquadId && (team.members || []).some(isOpenMember)) {
        setConfirmModal({
          message: `Join "${team.clanSquadName || 'this squad'}" for this tournament? You'll also become a member of that squad (and its clan) going forward — not just for this bracket.`,
          onConfirm: () => joinOpenSquadSlot(pi, si, mi),
        })
        return
      }
      attemptRegister()
      return
    }
    joinViaSlot(pi, si, mi)
  }

  /**
   * Fills one still-open seat on a squad that already claimed a team slot.
   * Unlike registerSquadTeam (which enters a whole roster at once), this is
   * for a random player choosing to fill a gap — so joining the bracket slot
   * ALSO makes them a real clan_members row (role: 'member') in that squad's
   * clan, exactly like joining the squad from the clan page would.
   */
  async function joinOpenSquadSlot(pi, si, mi) {
    if (!user) { openAuthGate(); return }
    setRegistering(true)

    const team = bracketData?.rounds?.[0]?.[pi]?.[si]
    if (!team?.clanSquadId) { setRegistering(false); return }

    const { data: squadRow, error: squadErr } = await supabase.from('clan_squads')
      .select('id, clan_id, name').eq('id', team.clanSquadId).maybeSingle()
    if (squadErr || !squadRow) { showToast('Could not find that squad.', 'error'); setRegistering(false); return }

    // Enroll them in the clan/squad — attach an existing clan membership if
    // they already have one, otherwise create a fresh 'member' row.
    const { data: existingMembership } = await supabase.from('clan_members')
      .select('id, squad_id').eq('clan_id', squadRow.clan_id).eq('user_id', user.id).maybeSingle()
    if (existingMembership) {
      if (!existingMembership.squad_id) {
        await supabase.from('clan_members').update({ squad_id: squadRow.id }).eq('id', existingMembership.id)
      }
    } else {
      const { error: joinErr } = await supabase.from('clan_members')
        .insert({ clan_id: squadRow.clan_id, squad_id: squadRow.id, user_id: user.id, role: 'member' })
      if (joinErr) { showToast('Failed to join squad.', 'error'); setRegistering(false); return }
    }

    const { error: partErr } = await supabase.from('tournament_participants').insert({ tournament_id: id, user_id: user.id })
    if (partErr && partErr.code !== '23505') { showToast('Failed to register. Try again.', 'error'); setRegistering(false); return }

    const [profileRes, freshTRes] = await Promise.all([
      supabase.from('profiles').select('username, avatar_url').eq('id', user.id).maybeSingle(),
      supabase.from('tournaments').select('bracket_data').eq('id', id).single(),
    ])
    const profile = profileRes.data
    const memberSlot = { userId: user.id, name: profile?.username || 'Player', avatar: profile?.avatar_url || null, status: 'active' }

    const freshBd = parseBracketData(freshTRes.data?.bracket_data) ?? bracketData
    const freshTeam = freshBd.rounds[0]?.[pi]?.[si]
    const freshMembers = freshTeam?.members || []
    const isOpenMember = m => !m?.userId || m.status === 'open' || m.status === 'empty' || m.status === 'pending'
    const openIdx = mi !== undefined && isOpenMember(freshMembers[mi]) ? mi : freshMembers.findIndex(isOpenMember)
    if (openIdx === -1) { showToast('That squad is already full.', 'error'); setRegistering(false); return }

    const newRounds = freshBd.rounds.map((r, ri) => ri !== 0 ? r : r.map((pair, pIdx) => {
      if (pIdx !== pi) return pair
      return pair.map((t, sIdx) => {
        if (sIdx !== si) return t
        const newMembers = t.members.map((m, mIdx2) => mIdx2 === openIdx ? memberSlot : m)
        const allFilled = newMembers.every(m => m?.userId)
        return { ...t, members: newMembers, status: allFilled ? 'active' : 'open' }
      })
    }))
    const updatedBd = { ...freshBd, rounds: newRounds, isEmpty: false }
    await supabase.from('tournaments').update({ bracket_data: updatedBd }).eq('id', id)
    setBracketData(updatedBd)

    const count = await syncCount()
    setRegistered(true)
    setTournament(t => ({ ...t, registered_count: count }))
    await sendNotification(user.id, `Joined ${squadRow.name} — ${tournament?.name}`,
      `You've joined ${squadRow.name} for this tournament, and are now a squad member.`, 'tournament', { tournament_id: id })
    setRegistering(false)
    await refreshParticipants()
  }

  function chooseSquadForJoin(squadId) {
    setSelectedSquadId(squadId)
    setSquadPicker(null)
    register(squadId)
  }

  async function leave() {
    if (!user) return
    setConfirmModal({
      message: 'Leave this tournament? Your bracket slot, points, and all records will be permanently removed.',
      onConfirm: async () => {
        setLeaving(true)

        // 1. Remove from participants + leaderboard
        await supabase.from('tournament_participants').delete().eq('tournament_id', id).eq('user_id', user.id)
        await supabase.from('tournament_leaderboard').delete().eq('tournament_id', id).eq('user_id', user.id)

        // 2. Also remove any payment records so they can re-register cleanly
        await supabase.from('tournament_payments').delete().eq('tournament_id', id).eq('user_id', user.id)

        // 3. Scrub user from bracket_data — works for both solo and team mode
        if (bracketData?.rounds) {
          let scrubbed

          if (bracketData.isTeamBattle) {
            // Team mode: remove user from any member slot across all rounds
            const openMember = { userId: null, name: 'Open', avatar: null, status: 'open' }
            scrubbed = {
              ...bracketData,
              rounds: bracketData.rounds.map(round =>
                round.map(pair =>
                  pair.map(team => {
                    if (!team || !team.members) return team
                    const hadUser = team.members.some(m => m?.userId === user.id)
                    if (!hadUser) return team
                    const newMembers = team.members.map(m =>
                      m?.userId === user.id ? openMember : m
                    )
                    // If all members gone → team reverts to open
                    const anyReal = newMembers.some(m => m?.userId)
                    return {
                      ...team,
                      members: newMembers,
                      status: anyReal ? 'open' : 'open',
                      teamId: anyReal ? team.teamId : null,
                      ...(anyReal ? {} : { clanSquadId: null, clanSquadName: null, clanSquadImage: null, teamName: null }),
                    }
                  })
                )
              ),
            }
          } else {
            // Solo mode: replace any slot containing this user with open
            const openSlot = { userId: null, name: 'Open', avatar: null, status: 'open' }
            scrubbed = {
              ...bracketData,
              rounds: bracketData.rounds.map(round =>
                round.map(pair =>
                  pair.map(s => s?.userId === user.id ? openSlot : s)
                )
              ),
            }
          }

          // Mark isEmpty if round 0 has no real players left
          const anyRealPlayer = scrubbed.rounds[0]?.some(pair =>
            bracketData.isTeamBattle
              ? pair.some(team => team?.members?.some(m => m?.userId))
              : pair.some(s => s?.userId)
          )
          if (!anyRealPlayer) scrubbed.isEmpty = true

          await supabase.from('tournaments').update({ bracket_data: scrubbed }).eq('id', id)
          setBracketData(scrubbed)
        }

        const count = await syncCount()
        setRegistered(false)
        setPaymentStatus(null)
        setTournament(t => ({ ...t, registered_count: count }))
        setLeaving(false)
        showToast('You have left the tournament.', 'info')
        await refreshParticipants()
      },
    })
  }

  // ── Bracket management ────────────────────────────────────────────────────

  /**
   * Clan tournaments (team_size > 1): team slots are claimed by clan squads,
   * not random individuals. First squad member to join claims an open,
   * unclaimed team slot for their squad; every squad member after that fills
   * an open member position within that same slot, first-come first-served.
   *
   * Returns { pi, si, mIdx, claim } for the caller to write into bracket_data,
   * { full: true } if the squad's own slot has no room left, or null if no
   * slot is available at all.
   */
  /**
   * Finds the team slot a squad should register into, for a BULK
   * (whole-roster-at-once) claim rather than a single member fill.
   * Returns { pi, si, alreadyClaimed: true } if this squad already has a
   * team, { pi, si, alreadyClaimed: false } for the first free team slot,
   * or null if the bracket is full.
   */
  function findTeamSlotForSquad(bd, squadId) {
    const round0 = bd.rounds[0] || []
    for (let pi = 0; pi < round0.length; pi++) {
      for (let si = 0; si < round0[pi].length; si++) {
        if (round0[pi][si]?.clanSquadId === squadId) return { pi, si, alreadyClaimed: true }
      }
    }
    for (let pi = 0; pi < round0.length; pi++) {
      for (let si = 0; si < round0[pi].length; si++) {
        const team = round0[pi][si]
        if (team && team.status !== 'bye' && team.status !== 'inactive' && !team.clanSquadId) {
          return { pi, si, alreadyClaimed: false }
        }
      }
    }
    return null
  }

  /**
   * Registers an ENTIRE squad roster into a team slot in one action.
   * Only callable by whoever is authorized for that squad (mySquads is
   * already scoped to squad leaders + the leader of the squad's clan).
   */
  async function registerSquadTeam(effSquad) {
    setRegistering(true)

    const slot = findTeamSlotForSquad(bracketData, effSquad.id)
    if (!slot) { showToast('No open team slots left.', 'error'); setRegistering(false); return }
    if (slot.alreadyClaimed) { showToast('Your squad is already registered.', 'info'); setRegistering(false); return }

    const { data: roster, error: rosterErr } = await supabase.from('clan_members')
      .select('user_id, profiles(username, avatar_url)')
      .eq('squad_id', effSquad.id)
    if (rosterErr || !roster?.length) {
      showToast('Could not load squad roster.', 'error'); setRegistering(false); return
    }

    const teamSize = tournament?.team_size || roster.length
    const rosterSlots = roster.slice(0, teamSize).map(r => ({
      userId: r.user_id, name: r.profiles?.username || 'Player', avatar: r.profiles?.avatar_url || null, status: 'active',
    }))

    const { error: partErr } = await supabase.from('tournament_participants')
      .upsert(roster.map(r => ({ tournament_id: id, user_id: r.user_id })), { onConflict: 'tournament_id,user_id', ignoreDuplicates: true })
    if (partErr) {
      console.error('registerSquadTeam participants:', partErr)
      showToast('Failed to register. Try again.', 'error'); setRegistering(false); return
    }

    const { pi, si } = slot
    const newRounds = bracketData.rounds.map((r, ri) => ri !== 0 ? r : r.map((pair, pIdx) => {
      if (pIdx !== pi) return pair
      return pair.map((team, sIdx) => {
        if (sIdx !== si) return team
        const filledMembers = (team.members || []).map((m, mi) => rosterSlots[mi] || m)
        const allFilled = filledMembers.every(m => m?.userId)
        return {
          ...team, members: filledMembers, status: allFilled ? 'active' : 'open',
          clanSquadId: effSquad.id, clanSquadName: effSquad.name, clanSquadImage: effSquad.image_url, teamName: effSquad.name,
        }
      })
    }))
    const updatedBd = { ...bracketData, rounds: newRounds, isEmpty: false }

    try {
      await supabase.from('tournaments').update({ bracket_data: updatedBd }).eq('id', id)
      setBracketData(updatedBd)
    } catch (e) {
      console.error('registerSquadTeam: bracket update failed', e)
    }

    const count = await syncCount()
    setRegistered(true)
    setTournament(t => ({ ...t, registered_count: count }))

    await Promise.all(roster.map(r => sendNotification(
      r.user_id, `Squad registered — ${tournament?.name}`,
      `${effSquad.name} has been entered into the bracket!`, 'tournament', { tournament_id: id }
    )))
    awardAchievement(user.id, 'ri-group-line', 'Tournament Player', 'Registered a squad for a tournament')

    setRegistering(false)
  }

  function findClanSquadPlacement(bd, squadId, prefPIdx, prefSIdx) {
    const round0 = bd.rounds[0] || []
    const isOpenMember = m => !m?.userId || m.status === 'open' || m.status === 'empty' || m.status === 'pending'

    // 1. This squad already claimed a slot somewhere — fill its next open spot
    for (let pi = 0; pi < round0.length; pi++) {
      for (let si = 0; si < round0[pi].length; si++) {
        const team = round0[pi][si]
        if (!team || team.status === 'bye' || team.status === 'inactive') continue
        if (team.clanSquadId === squadId) {
          const mIdx = (team.members || []).findIndex(isOpenMember)
          if (mIdx !== -1) return { pi, si, mIdx, claim: false }
          return { full: true }
        }
      }
    }

    const tryClaim = (pi, si) => {
      const team = round0[pi]?.[si]
      if (!team || team.status === 'bye' || team.status === 'inactive' || team.clanSquadId) return null
      const mIdx = (team.members || []).findIndex(isOpenMember)
      if (mIdx === -1) return null
      return { pi, si, mIdx, claim: true }
    }

    // 2. Preferred slot (the one the user clicked), if it's unclaimed
    if (prefPIdx !== undefined && prefSIdx !== undefined) {
      const r = tryClaim(prefPIdx, prefSIdx)
      if (r) return r
    }

    // 3. First unclaimed open slot, in order
    for (let pi = 0; pi < round0.length; pi++) {
      for (let si = 0; si < round0[pi].length; si++) {
        const r = tryClaim(pi, si)
        if (r) return r
      }
    }
    return null
  }

  /**
   * Server-side authority check.
   * Re-reads the tournament created_by from DB and verifies the current
   * session email against the hard-coded ADMIN_EMAILS list — the same
   * source of truth used by AuthProvider. This means bypassing the UI
   * via browser console / raw fetch still gets rejected at the app layer,
   * in addition to Supabase RLS policies.
   */

  async function verifyCanManage() {
    if (!user) { showToast('You must be logged in.', 'error'); return false }
    try {
      const ADMIN_EMAILS = ['stevenmsambwa8@gmail.com', 'nabogamingss1@gmail.com']
      const [{ data: { user: freshUser } }, { data: tFresh }] = await Promise.all([
        supabase.auth.getUser(),                                                    // live session — can't be faked client-side
        supabase.from('tournaments').select('created_by').eq('id', id).maybeSingle(), // fresh from DB
      ])
      const serverIsAdmin   = ADMIN_EMAILS.includes(freshUser?.email)
      const serverIsCreator = tFresh?.created_by === user.id
      if (!serverIsAdmin && !serverIsCreator) {
        showToast('Permission denied.', 'error')
        console.warn('verifyCanManage: rejected for user', user.id)
        return false
      }
      return true
    } catch (e) {
      console.error('verifyCanManage: error', e)
      showToast('Could not verify permissions. Please try again.', 'error')
      return false
    }
  }

  async function initBracket() {
    if (!await verifyCanManage()) return
    const teamSize = tournament?.team_size || 1
    const bd = buildBracket(participants, teamSize)
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
    if (!await verifyCanManage()) return
    const teamSize = tournament?.team_size || 1
    const slots    = tournament?.slots    || 32
    setConfirmModal({
      message: `Reset the entire bracket to a fresh ${teamSize > 1 ? teamSize + 'v' + teamSize + ' team' : '1v1'} lobby? All placements, match progress, and points will be cleared. Players will need to re-join their slots.`,
      onConfirm: async () => {
        // 1. Delete leaderboard entries
        await supabase.from('tournament_leaderboard').delete().eq('tournament_id', id)

        // 2. Build a fresh empty lobby bracket with the CURRENT team_size
        const freshLobby = buildLobbyBracket(slots, teamSize)

        // 3. Save the fresh lobby to DB (clears all old bracket_data)
        await supabase.from('tournaments').update({ bracket_data: freshLobby }).eq('id', id)

        // 4. Update local state immediately
        setBracketData(freshLobby)

        showToast(`Bracket reset to fresh ${teamSize > 1 ? teamSize + 'v' + teamSize : '1v1'} lobby.`, 'success')
      },
    })
  }

  // ── Admin: set slot status (pass / eliminate / DQ) ────────────────────────

  async function adminSetSlotStatus(rIdx, pIdx, slotIdx, status) {
    if (!await verifyCanManage()) return
    const loserIdx = slotIdx === 0 ? 1 : 0

    // Always read fresh from DB to avoid stale-state overwrite bugs
    const { data: freshT } = await supabase.from('tournaments').select('bracket_data').eq('id', id).single()
    const freshBd = parseBracketData(freshT?.bracket_data) ?? bracketData
    if (!freshBd) return

    const currentSlot = freshBd.rounds[rIdx]?.[pIdx]?.[slotIdx]
    // Team mode: slot is a team object; solo mode: slot has userId
    const isTeamSlot = freshBd.isTeamBattle
    if (!isTeamSlot && !currentSlot?.userId) return  // solo: nothing to act on
    if (isTeamSlot && (!currentSlot || currentSlot.status === 'open' || currentSlot.status === 'bye')) return // team: no active team
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
      await refreshParticipants()
      return
    }

    const totalRounds = freshBd.rounds.length
    const isFinalRound = rIdx === totalRounds - 2
    const tName = tournament?.name || 'the tournament'

    // ── TEAM MODE branch ──────────────────────────────────────────────────
    if (isTeamSlot) {
      const actedTeam = currentSlot
      const oppositeTeam = freshBd.rounds[rIdx]?.[pIdx]?.[loserIdx]

      // 1. Mark current team's status; auto-eliminate opponent on pass
      let newRounds = freshBd.rounds.map((r, ri) => {
        if (ri !== rIdx) return r
        return r.map((pair, pi) => {
          if (pi !== pIdx) return pair
          return pair.map((team, ti) => {
            if (ti === slotIdx) return { ...team, status }
            if (status === 'winner' && team && team.status !== 'bye' && team.status !== 'open')
              return { ...team, status: 'eliminated' }
            return team
          })
        })
      })

      // 2. Advance winning team into next round slot
      if (status === 'winner') {
        const advancedTeam = {
          ...newRounds[rIdx][pIdx][slotIdx],
          status: 'active',
          teamId: actedTeam.teamId,
          teamName: actedTeam.teamName,
        }
        const destRound = isFinalRound ? totalRounds - 1 : rIdx + 1
        const destPair  = Math.floor(pIdx / 2)
        const destSlot  = pIdx % 2
        newRounds = newRounds.map((r, ri) => {
          if (ri !== destRound) return r
          return r.map((pair, pi) => {
            if (pi !== destPair) return pair
            return pair.map((slot, si) => si === destSlot ? advancedTeam : slot)
          })
        })
      }

      const newBd = { ...freshBd, rounds: newRounds }
      setBracketData(newBd)
      await saveBracket(newBd)

      // 3. Notify every real member of both teams
      const { winnerPts, loserPts } = getRoundPts(rIdx, totalRounds)
      const roundName = getRoundLabelSimple(rIdx, totalRounds, freshBd.bracketSize, bracketData?.round_names)
      const notifRows = []
      const realMembers = (t) => (t?.members || []).filter(m => m?.userId)

      if (status === 'winner') {
        realMembers(actedTeam).forEach(m => {
          awardAchievement(m.userId, 'ri-sword-fill', 'First Win', 'Won your first tournament match')
          if (isFinalRound) awardAchievement(m.userId, 'ri-trophy-fill', 'Finalist', 'Reached the Final')
          notifRows.push({
            user_id: m.userId,
            title: isFinalRound ? `Final won — ${tName}` : `Team advanced from ${roundName} — ${tName}`,
            body: isFinalRound
              ? `Your team won the Final! +${winnerPts} pts each.`
              : `Your team beat the opponents and advances! +${winnerPts} pts each.`,
            type: isFinalRound ? 'tournament_win' : 'tournament_advance',
            meta: { tournament_id: id }, read: false,
          })
        })
        realMembers(oppositeTeam).forEach(m => {
          notifRows.push({
            user_id: m.userId,
            title: `Team eliminated in ${roundName} — ${tName}`,
            body: `Your team was knocked out. +${loserPts} pts for reaching this stage.`,
            type: 'tournament_eliminate', meta: { tournament_id: id }, read: false,
          })
        })
        // Award points to all members
        await Promise.all(realMembers(actedTeam).map(m => awardBracketPoints(m.userId, winnerPts)))
        await Promise.all(realMembers(oppositeTeam).map(m => awardBracketPoints(m.userId, loserPts)))
      } else if (status === 'eliminated') {
        realMembers(actedTeam).forEach(m => {
          notifRows.push({
            user_id: m.userId,
            title: `Team eliminated — ${tName}`,
            body: `Your team was eliminated in ${roundName}. +${loserPts} pt for reaching this stage.`,
            type: 'tournament_eliminate', meta: { tournament_id: id }, read: false,
          })
        })
        realMembers(oppositeTeam).forEach(m => {
          notifRows.push({
            user_id: m.userId,
            title: `Opponents eliminated — ${tName}`,
            body: `The opposing team was eliminated in ${roundName}. Your team advances!`,
            type: 'tournament_advance', meta: { tournament_id: id }, read: false,
          })
        })
        await Promise.all(realMembers(actedTeam).map(m => awardBracketPoints(m.userId, loserPts)))
      } else if (status === 'disqualified') {
        realMembers(actedTeam).forEach(m => {
          notifRows.push({
            user_id: m.userId,
            title: `Team disqualified — ${tName}`,
            body: `Your team has been disqualified in ${roundName}. ${DQ_PENALTY} pts removed.`,
            type: 'tournament', meta: { tournament_id: id }, read: false,
          })
        })
        realMembers(oppositeTeam).forEach(m => {
          notifRows.push({
            user_id: m.userId,
            title: `Opponents DQ'd — ${tName}`,
            body: `The opposing team was disqualified. Your team advances!`,
            type: 'tournament_advance', meta: { tournament_id: id }, read: false,
          })
        })
        // DQ penalty actually removes points from the team's total
        await Promise.all(realMembers(actedTeam).map(m => awardBracketPoints(m.userId, DQ_PENALTY)))
      }
      if (notifRows.length) await supabase.from('notifications').insert(notifRows)
      await Promise.all([refreshParticipants(), refreshLeaderboard()])
      return
    }

    // ── SOLO MODE (original logic below) ─────────────────────────────────
    const actedSlot = currentSlot
    const oppositeSlot = freshBd.rounds[rIdx]?.[pIdx]?.[loserIdx]
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
    const roundName = getRoundLabelSimple(rIdx, totalRounds, freshBd.bracketSize, bracketData?.round_names)
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
      const { loserPts } = getRoundPts(rIdx, totalRounds)
      notifRows.push({
        user_id: actedSlot.userId,
        title: `Eliminated — ${tName}`,
        body: `You have been eliminated from ${roundName}. +${loserPts} pt for reaching this stage.`,
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
        body: `You have been disqualified from ${roundName}. ${DQ_PENALTY} pts removed from your total.`,
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
    } else if (status === 'eliminated' && actedSlot.userId) {
      // Direct elimination (not via a recorded winner) still earns the
      // small consolation point for reaching this stage of the bracket.
      const { loserPts } = getRoundPts(rIdx, totalRounds)
      await awardBracketPoints(actedSlot.userId, loserPts)
      await supabase.rpc('log_earning', {
        p_user_id: actedSlot.userId,
        p_type: 'tournament_eliminate',
        p_points: loserPts,
        p_description: `Eliminated in ${roundName} — ${tName}`,
        p_ref_id: id,
      })
      await recalcPositions()
    } else if (status === 'disqualified' && actedSlot.userId) {
      // Disqualification actively removes points from the player's total.
      await awardBracketPoints(actedSlot.userId, DQ_PENALTY)
      await supabase.rpc('log_earning', {
        p_user_id: actedSlot.userId,
        p_type: 'tournament_disqualify',
        p_points: DQ_PENALTY,
        p_description: `Disqualified in ${roundName} — ${tName}`,
        p_ref_id: id,
      })
      await recalcPositions()
    }

    await Promise.all([refreshParticipants(), refreshLeaderboard()])
  }

  // NOTE: adminAddToBracket removed from here — its functionality (with the
  // player notification it sent) now lives in /manage as `addToBracket`.

  // ── Admin: rename a team (one-time, stored in bracket_data) ─────────────────
  async function adminRenameTeam(rIdx, pIdx, slotIdx, newName) {
    if (!await verifyCanManage()) return
    const { data: freshT } = await supabase.from('tournaments').select('bracket_data').eq('id', id).single()
    const freshBd = parseBracketData(freshT?.bracket_data) ?? bracketData
    if (!freshBd) return
    const team = freshBd.rounds[rIdx]?.[pIdx]?.[slotIdx]
    if (!team || team.teamName) return  // already named — don't overwrite
    const newRounds = freshBd.rounds.map((r, ri) =>
      ri !== rIdx ? r : r.map((pair, pi) =>
        pi !== pIdx ? pair : pair.map((slot, si) =>
          si !== slotIdx ? slot : { ...slot, teamName: newName.trim().slice(0, 12) }
        )
      )
    )
    const newBd = { ...freshBd, rounds: newRounds }
    setBracketData(newBd)
    await saveBracket(newBd)
    showToast(`Team renamed to "${newName}"`, 'success')
  }

  // ── Admin: swap two players between bracket slots ───────────────────────────
  async function adminSwapSlots(r1, p1, s1, r2, p2, s2) {
    if (!await verifyCanManage()) return
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
  }

  // ── Admin: crown champion ─────────────────────────────────────────────────

  async function adminSetChampion(rIdx, pIdx) {
    if (!await verifyCanManage()) return
    if (!bracketData) return
    const { data: freshT } = await supabase.from('tournaments').select('bracket_data').eq('id', id).single()
    const freshBd = parseBracketData(freshT?.bracket_data) ?? bracketData
    const champSlot = freshBd.rounds[rIdx]?.[pIdx]?.[0]

    // ── Team mode champion ────────────────────────────────────────────────
    if (freshBd.isTeamBattle) {
      if (!champSlot || !champSlot.members?.some(m => m?.userId)) {
        showToast('No team in the champion slot yet.', 'error'); return
      }
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
      const champMembers = (champSlot.members || []).filter(m => m?.userId)
      await Promise.all(champMembers.map(m => awardBracketPoints(m.userId, CHAMPION_BONUS)))
      await Promise.all(champMembers.map(m => supabase.from('profiles').update({ is_season_winner: true }).eq('id', m.userId)))
      await Promise.all(champMembers.map(m => awardAchievement(m.userId, 'ri-vip-crown-fill', 'Tournament Champion', `Won ${tournament?.name || 'a tournament'}`)))

      const { data: finalLb } = await supabase
        .from('tournament_leaderboard').select('user_id, position, points').eq('tournament_id', id)
        .order('position', { ascending: true }).limit(3)

      async function applySeasonWinsTeam(userId, bonus) {
        const { data: prof } = await supabase.from('profiles').select('wins, season_wins, level, current_season').eq('id', userId).single()
        if (!prof) return
        const registeredSeason = prof.current_season ?? currentSeason
        const newSeasonWins = registeredSeason < currentSeason ? 1 : (prof.season_wins ?? 0) + bonus
        const newWins = (prof.wins ?? 0) + bonus
        let newLevel = prof.level ?? 1
        for (let i = 0; i < bonus; i++) newLevel = computeLevelAfterWin(newLevel, (prof.season_wins ?? 0) + i + 1)
        await supabase.from('profiles').update({ wins: newWins, season_wins: newSeasonWins, level: newLevel, current_season: currentSeason }).eq('id', userId)
      }

      await Promise.all(champMembers.map(m => applySeasonWinsTeam(m.userId, 3)))

      const tName = tournament?.name || 'the tournament'
      const champTeamName = champSlot.teamName || champMembers.map(m => m.name.slice(0,3)).join('').slice(0,8) || 'Champions'
      const allNotifs = champMembers.map(m => ({
        user_id: m.userId,
        title: `CHAMPIONS — ${tName}`,
        body: `Your team "${champTeamName}" won the tournament! +${CHAMPION_BONUS} bonus pts each. Check your wallet!`,
        type: 'tournament_champion', meta: { tournament_id: id }, read: false,
      }))
      const { data: allParts } = await supabase.from('tournament_participants').select('user_id').eq('tournament_id', id)
      const champIds = new Set(champMembers.map(m => m.userId))
      const broadcasts = (allParts || []).filter(p => p.user_id && !champIds.has(p.user_id)).map(p => ({
        user_id: p.user_id,
        title: `Tournament complete — ${tName}`,
        body: `Team "${champTeamName}" has been crowned Champions! See the final standings.`,
        type: 'tournament', meta: { tournament_id: id }, read: false,
      }))
      if ([...allNotifs, ...broadcasts].length) await supabase.from('notifications').insert([...allNotifs, ...broadcasts])
      await Promise.all(champMembers.map(m => supabase.rpc('log_earning', { p_user_id: m.userId, p_type: 'tournament_champion', p_points: CHAMPION_BONUS, p_description: `Champion — ${tName}`, p_ref_id: id })))
      await recalcPositions()
      await Promise.all([refreshParticipants(), refreshLeaderboard()])
      return
    }

    // ── Solo mode champion (original) ─────────────────────────────────────
    const champion = champSlot
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
    await Promise.all([refreshParticipants(), refreshLeaderboard()])
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
    await refreshLeaderboard()
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
        await refreshLeaderboard()
      },
    })
  }

  async function adminDQWinner(entry) {
    if (!await verifyCanManage()) return
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
        if (bracketData?.rounds) {
          const newRounds = bracketData.rounds.map(pairs =>
            pairs.map(pair =>
              bracketData.isTeamBattle
                ? pair.map(team => {
                    if (!team || team.status !== 'winner') return team
                    const hasMember = (team.members || []).some(m => m?.userId === entry.user_id)
                    return hasMember ? { ...team, status: 'disqualified' } : team
                  })
                : pair.map(s =>
                    s?.userId === entry.user_id && s.status === 'winner' ? { ...s, status: 'disqualified' } : s
                  )
            )
          )
          const newBd = { ...bracketData, rounds: newRounds }
          await supabase.from('tournaments').update({ bracket_data: newBd }).eq('id', id)
          setBracketData(newBd)
        }
        await recalcPositions()
        await sendNotification(entry.user_id, `Disqualified — ${tournament?.name}`,
          `You've been disqualified. ${pts} pts removed from leaderboard and global profile.`, 'tournament', { tournament_id: id })
        await refreshLeaderboard()
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
    if (!await verifyCanManage()) return
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
    await Promise.all([refreshParticipants(), refreshLeaderboard()])
    setPrizeDistribSaving(false)
    setPrizeDistribOpen(false)
    showToast('Prizes distributed!', 'success')
  }

  // NOTE: saveEdit removed — editing now happens entirely on /manage. This
  // page's existing realtime subscription (see "Realtime subscriptions"
  // above) already rebuilds bracketData here when /manage saves a change
  // to slug/team_size/slots, so no local duplicate-rebuild logic is needed.

  // NOTE: deleteTournament removed — deletion now lives only in /manage's
  // Danger tab, which has a stronger type-DELETE-to-confirm safeguard.

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

  function shareLink() {
    const url = (typeof window !== 'undefined' ? window.location.origin : 'https://nabogaming.live') + '/tournaments/' + (tournament?.slug || id)
    const text = '🏆 ' + (tournament?.name || '') + '\nJoin this tournament on NABOGAMING!\n' + url
    if (navigator.share) { navigator.share({ title: tournament?.name, text, url }).catch(() => {}); return }
    navigator.clipboard?.writeText(url).catch(() => {
      const ta = document.createElement('textarea'); ta.value = url
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    })
    showToast('Link copied!', 'success')
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
    if (fromP?.profiles) return { email: fromP.profiles.email, plan: fromP.profiles.plan, planExpiresAt: fromP.profiles.plan_expires_at, countryFlag: fromP.profiles.country_flag, isSeasonWinner: fromP.profiles.is_season_winner }
    const fromLb = leaderboard.find(e => e.user_id === uid)
    if (fromLb?.profiles) return { email: fromLb.profiles.email, plan: fromLb.profiles.plan, planExpiresAt: fromLb.profiles.plan_expires_at, countryFlag: fromLb.profiles.country_flag, isSeasonWinner: fromLb.profiles.is_season_winner }
    return { email: null, plan: null, planExpiresAt: null, countryFlag: null, isSeasonWinner: false }
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

  const getPassPoints = (rIdx) => bracketData?.rounds ? getRoundPts(rIdx, bracketData.rounds.length).winnerPts : 0

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

      {/* Top bar — circular back button + Manage, both top-right */}
      <div className={styles.topBar}>
        <button className={styles.backCircle} onClick={() => router.back()} aria-label="Back">
          <i className="ri-arrow-left-line" />
        </button>
        {canManage && tournament && (
          <button
            className={styles.manageBtnTop}
            onClick={() => router.push(`/tournaments/${tournament.slug || tournament.id}/manage`)}
          >
            <i className="ri-shield-star-fill" />
            Manage
          </button>
        )}
      </div>

      {/* Hero — "match ticket" card */}
      <div className={styles.hero}>
        <div className={styles.ticket}>
          <div className={styles.ticketHead}>
            <div className={styles.heroMeta}>
              <span className={styles.gameTag}>{gameLabel}</span>
              {(tournament.team_size || 1) > 1 && (
                <span className={styles.gameTag} style={{ background: 'rgba(99,102,241,0.15)', color: '#6366f1', borderColor: 'rgba(99,102,241,0.3)' }}>
                  <i className="ri-team-line" style={{ marginRight: 4 }} />
                  {tournament.team_size}v{tournament.team_size}
                </span>
              )}
              {tournament.clan_id && (
                <Link href={clanInfo?.code ? `/clans/${clanInfo.code}` : '#'} className={styles.gameTag} style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', borderColor: 'rgba(34,197,94,0.3)', textDecoration: 'none' }}>
                  {clanInfo?.logo_url
                    ? <img src={clanInfo.logo_url} alt="" style={{ width: 13, height: 13, borderRadius: 3, objectFit: 'cover', marginRight: 4, verticalAlign: 'middle' }} />
                    : <i className="ri-shield-star-fill" style={{ marginRight: 4 }} />}
                  Hosted by {clanInfo?.name || 'a clan'}
                </Link>
              )}
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
              {!registered && tournament.status === 'active' && !isFull && (!isOwnTournament || tournament.stage_format === 'groups_knockout') && !isCompleted && (() => {
                const hasFee = (tournament.entrance_fee || 0) > 0
                if (!hasFee) {
                  return (
                    <button className={styles.heroRegisterBtn} onClick={attemptRegister} disabled={registering}>
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
              {isOwnTournament && tournament.status === 'active' && tournament.stage_format !== 'groups_knockout' && (
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

            <div className={styles.heroCreatorRow}>
              {creatorProfile && (
                <a href={`/profile/${creatorProfile.id}`} className={styles.heroCreatorChip}>
                  <div className={styles.heroCreatorAvatar}>
                    {creatorProfile.avatar_url
                      ? <img src={creatorProfile.avatar_url} alt="" />
                      : <span>{(creatorProfile.username || '?').slice(0, 2).toUpperCase()}</span>}
                  </div>
                  <div className={styles.heroCreatorInfo}>
                    <span className={styles.heroCreatorBy}>Hosted by</span>
                    <span className={styles.heroCreatorName}>
                      {creatorProfile.username}
                      <UserBadges email={creatorProfile.email} plan={creatorProfile.plan} planExpiresAt={creatorProfile.plan_expires_at} countryFlag={creatorProfile.country_flag}
                        isSeasonWinner={creatorProfile.is_season_winner} size={10} gap={3} hideAdmin />
                    </span>
                  </div>
                </a>
              )}
              <button className={styles.heroShareBtn} onClick={shareLink} title="Share tournament">
                <i className="ri-share-line" /> Share
              </button>
            </div>

            {tournament.description && <p className={styles.heroDesc}>{tournament.description}</p>}
          </div>

          {/* Perforated tear line */}
          <div className={styles.tear}>
            <span className={styles.notchLeft} />
            <span className={styles.notchRight} />
          </div>

          <div className={styles.ticketStub}>
            <div className={styles.stubGrid}>
              <div className={styles.stubStat}>
                <span className={styles.stubLabel}>Prize</span>
                <span className={`${styles.stubVal} ${styles.stubValAccent}`}>{prizeTotal ? fmtTZS(prizeTotal) : 'None'}</span>
              </div>
              <div className={styles.stubStat}>
                <span className={styles.stubLabel}>Players</span>
                <span className={styles.stubVal}>{loadingParticipants ? '…' : `${realCount}/${tournament.slots}`}</span>
              </div>
              <div className={styles.stubStat}>
                <span className={styles.stubLabel}>Format</span>
                <span className={styles.stubVal}>{tournament.format || '—'}</span>
              </div>
              {tournament.date && (
                <div className={styles.stubStat}>
                  <span className={styles.stubLabel}>Date</span>
                  <span className={styles.stubVal}>{tournament.date}</span>
                </div>
              )}
            </div>

            <div className={styles.heroSlotBar}>
              <div className={styles.slotTrack}>
                <div className={styles.slotFill} style={{ width: `${Math.min(100, (realCount / (tournament.slots || 1)) * 100)}%` }} />
              </div>
              <span className={styles.slotLabel}>
                {!tournament.slots ? '' : Math.max(0, tournament.slots - realCount) === 0 ? 'Full' : `${Math.max(0, tournament.slots - realCount)} spots left`}
              </span>
            </div>
          </div>
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
      {showPayModal && (() => {
        const fmtFeeLocal = n => Number(n).toLocaleString()
        return (
          <div className={styles.modalBackdrop} onClick={() => setShowPayModal(false)}>
            <div className={styles.modalSheet} onClick={e => e.stopPropagation()}>
              <button className={styles.modalClose} onClick={() => setShowPayModal(false)}><i className="ri-close-line" /></button>

              <div className={styles.payHeader}>
                <i className="ri-secure-payment-line" />
                <div>
                  <h3 className={styles.payTitle}>Send Entry Fee</h3>
                  <p className={styles.paySub}>Choose one account, send <strong>TZS {fmtFeeLocal(tournament.entrance_fee)}</strong>, then submit proof.</p>
                </div>
              </div>

              <div className={styles.payAmountPill}>
                <span>Amount to send</span>
                <strong>TZS {fmtFeeLocal(tournament.entrance_fee)}</strong>
              </div>

              <p className={styles.payChooseLabel}><span>Choose one account</span></p>

              <div className={styles.payGrid}>
                <div className={styles.payCard}>
                  <div className={styles.payCardHead}>
                    <i className="ri-sim-card-line" style={{ color: '#e11d48' }} />
                    <span>Halopesa</span>
                  </div>
                  <div className={styles.payCardNum}>
                    <span>25165945</span>
                    <button
                      className={`${styles.copyBtn} ${paySlugCopied === 'halo' ? styles.copyBtnDone : ''}`}
                      onClick={() => { navigator.clipboard?.writeText('25165945'); setPaySlugCopied('halo'); setTimeout(() => setPaySlugCopied(null), 2000) }}
                    >
                      {paySlugCopied === 'halo' ? <><i className="ri-check-line" /> Copied</> : <><i className="ri-file-copy-line" /> Copy</>}
                    </button>
                  </div>
                  <div className={styles.payCardMeta}>
                    <span>Lipa Number</span>
                    <span className={styles.payCardAcct}>NABOGAMING</span>
                  </div>
                </div>

                <div className={styles.payCard}>
                  <div className={styles.payCardHead}>
                    <i className="ri-sim-card-2-line" style={{ color: '#16a34a' }} />
                    <span>M-Pesa</span>
                  </div>
                  <div className={styles.payCardNum}>
                    <span>36835506</span>
                    <button
                      className={`${styles.copyBtn} ${paySlugCopied === 'mpesa' ? styles.copyBtnDone : ''}`}
                      onClick={() => { navigator.clipboard?.writeText('36835506'); setPaySlugCopied('mpesa'); setTimeout(() => setPaySlugCopied(null), 2000) }}
                    >
                      {paySlugCopied === 'mpesa' ? <><i className="ri-check-line" /> Copied</> : <><i className="ri-file-copy-line" /> Copy</>}
                    </button>
                  </div>
                  <div className={styles.payCardMeta}>
                    <span>Lipa Number</span>
                    <span className={styles.payCardAcct}>STEVEN DAVID</span>
                  </div>
                </div>
              </div>

              <p className={styles.payProofLabel}>After paying, paste your proof below:</p>

              <div className={styles.modalField}>
                <label><i className="ri-fingerprint-line" /> Transaction ID / Reference <span className={styles.req}>*</span></label>
                <input type="text" placeholder="e.g. ABC12345XY" value={payRef} onChange={e => setPayRef(e.target.value)} />
              </div>
              <div className={styles.modalField}>
                <label><i className="ri-phone-line" /> Phone Number Used</label>
                <input type="tel" placeholder="e.g. 0712 345 678" value={payPhone} onChange={e => setPayPhone(e.target.value)} />
              </div>

              {payErr && <p className={styles.modalErr}><i className="ri-error-warning-line" /> {payErr}</p>}

              <button
                className={styles.modalSubmit}
                onClick={submitPayment}
                disabled={payLoading || (!payRef.trim() && !payPhone.trim())}
              >
                {payLoading
                  ? <><i className="ri-loader-4-line" /> Submitting…</>
                  : <><i className="ri-check-double-line" /> I've Paid — Notify Admin</>}
              </button>
            </div>
          </div>
        )
      })()}

      {/* Tabs */}
      <div className={styles.tabs}>
        {[
          ...(tournament.stage_format === 'groups_knockout'
            ? [{ key: 'groups', icon: 'ri-layout-grid-line', title: 'Groups' }]
            : []),
          { key: 'bracket',     icon: 'ri-node-tree',     title: 'Bracket' },
          { key: 'matches',     icon: 'ri-sword-line',    title: 'Matches' },
          { key: 'leaderboard', icon: 'ri-bar-chart-line',title: 'Leaderboard' },
          { key: 'players',     icon: 'ri-group-line',    title: `Players (${loadingParticipants ? '…' : realCount})` },
        ].map(tab => (
          <button
            key={tab.key}
            className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.key)}
            title={tab.title}
            aria-label={tab.title}
          >
            <i className={tab.icon} />
            <span className={styles.tabLabel}>{tab.title}</span>
          </button>
        ))}
      </div>

      {/* ── GROUPS TAB (read-only, group stage) ── */}
      {activeTab === 'groups' && (
        <section className={styles.section}>
          {!bracketData?.groups ? (
            participants.length === 0 ? (
              <div className={styles.emptyTab}>
                <i className="ri-layout-grid-line" style={{ fontSize: 28 }} />
                <span>No one's registered yet — be the first!</span>
              </div>
            ) : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', background: 'var(--surface)' }}>
                <div style={{ padding: '10px 14px', background: 'var(--bg-2)', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Registered players</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Groups not drawn yet</span>
                </div>
                <div style={{ padding: '4px 14px 8px' }}>
                  <div style={{ display: 'flex', gap: 8, padding: '6px 0', fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    <span style={{ width: 16 }}>#</span><span style={{ flex: 1 }}>Player</span><span style={{ width: 34, textAlign: 'center' }}>Pts</span>
                  </div>
                  {participants.map((p, i) => (
                    <div key={p.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', fontSize: 12.5, borderTop: '1px solid var(--border)' }}>
                      <span style={{ width: 16, color: 'var(--text-muted)', fontWeight: 700 }}>{i + 1}</span>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', overflow: 'hidden', background: 'var(--bg-2)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800 }}>
                        {p.profiles?.avatar_url ? <img src={p.profiles.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (p.profiles?.username || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <span style={{ flex: 1, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {p.profiles?.username || 'Player'}
                        {p.user_id === user?.id && <span className={styles.youBadge}>You</span>}
                      </span>
                      <span style={{ width: 34, textAlign: 'center', fontWeight: 800, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)' }}>0</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {bracketData.stage === 'knockout' && (
                <div className={styles.feeBanner} style={{ background: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.25)', color: 'var(--accent)' }}>
                  <i className="ri-checkbox-circle-fill" />
                  <span>Group stage complete — check the Bracket tab for the knockout draw.</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className={`${styles.shareBtn} ${bracketShareCopied ? styles.shareBtnCopied : ''}`}
                  onClick={() => { setShareCardMode('standings'); setShareGroupId(null); setBracketShareModal(true) }}
                  style={{ fontSize: 11, padding: '5px 10px' }}
                >
                  <i className="ri-image-line" /> Share Card
                </button>
              </div>
              {bracketData.groups.map(group => {
                const standings = computeStandings(group)
                const fixturesOpen = !!expandedFixtures[group.id]
                return (
                  <div key={group.id} style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', background: 'var(--surface)' }}>
                    <div style={{ padding: '10px 14px', background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 800 }}>{group.name}</span>
                      <button
                        onClick={() => { setShareCardMode('standings'); setShareGroupId(group.id); setBracketShareModal(true) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', fontSize: 10.5, fontWeight: 800, color: 'var(--text-dim)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}
                      >
                        <i className="ri-image-line" style={{ fontSize: 12 }} /> Share
                      </button>
                    </div>
                    <div style={{ padding: '4px 14px 8px', overflowX: 'auto' }}>
                      <div style={{ display: 'flex', gap: 6, padding: '6px 0', fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 320 }}>
                        <span style={{ width: 16 }}>#</span>
                        <span style={{ flex: 1 }}>Player</span>
                        {['P', 'W', 'D', 'L', 'GF', 'GA', 'GD'].map(h => (
                          <span key={h} style={{ width: 22, textAlign: 'center' }}>{h}</span>
                        ))}
                        <span style={{ width: 30, textAlign: 'center' }}>Pts</span>
                      </div>
                      {standings.map(row => {
                        const advances = row.position <= (bracketData.advancePerGroup ?? tournament?.advance_per_group ?? 2)
                        return (
                          <div key={row.id} style={{
                            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', fontSize: 12, borderTop: '1px solid var(--border)', minWidth: 320,
                            borderLeft: advances ? '2px solid var(--accent)' : '2px solid transparent', paddingLeft: 4,
                          }}>
                            <span style={{ width: 16, color: 'var(--text-muted)', fontWeight: 700 }}>{row.position}</span>
                            <MarqueeText text={row.name} wrapClassName={styles.groupNameWrap} textClassName={styles.groupNameText} />
                            <span style={{ width: 22, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{row.played}</span>
                            <span style={{ width: 22, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{row.won}</span>
                            <span style={{ width: 22, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{row.drawn}</span>
                            <span style={{ width: 22, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{row.lost}</span>
                            <span style={{ width: 22, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{row.goalsFor}</span>
                            <span style={{ width: 22, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{row.goalsAgainst}</span>
                            <span style={{ width: 22, textAlign: 'center', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: row.goalDiff > 0 ? 'var(--accent)' : row.goalDiff < 0 ? '#ef4444' : 'var(--text-muted)' }}>
                              {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
                            </span>
                            <span style={{ width: 30, textAlign: 'center', fontWeight: 800, fontFamily: 'ui-monospace, monospace', color: 'var(--accent)' }}>{row.points}</span>
                          </div>
                        )
                      })}
                    </div>
                    <button
                      onClick={() => setExpandedFixtures(prev => ({ ...prev, [group.id]: !prev[group.id] }))}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        padding: '9px 14px', fontSize: 11.5, fontWeight: 800, color: 'var(--text-dim)',
                        background: 'var(--bg-2)', border: 'none', borderTop: '1px solid var(--border)', cursor: 'pointer',
                      }}
                    >
                      <i className={fixturesOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                      {fixturesOpen ? 'Hide Matches' : `View Matches (${group.fixtures.length})`}
                    </button>
                    {fixturesOpen && (
                      <div style={{ borderTop: '1px solid var(--border)' }}>
                        {group.fixtures.map(fx => {
                          const home = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.homeId)
                          const away = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.awayId)
                          const played = fx.status === 'played'
                          return (
                            <div key={fx.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                              <span style={{ flex: 1, minWidth: 0, textAlign: 'right', fontWeight: played ? 400 : 700, color: played ? 'var(--text)' : 'var(--text-muted)' }}>
                                <MarqueeText text={home?.name || '?'} wrapClassName={styles.fixtureNameWrapRight} textClassName={styles.fixtureNameText} />
                              </span>
                              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, minWidth: 42, textAlign: 'center', flexShrink: 0 }}>
                                {played ? `${fx.scoreHome} – ${fx.scoreAway}` : 'vs'}
                              </span>
                              <span style={{ flex: 1, minWidth: 0, fontWeight: played ? 400 : 700, color: played ? 'var(--text)' : 'var(--text-muted)' }}>
                                <MarqueeText text={away?.name || '?'} wrapClassName={styles.fixtureNameWrapLeft} textClassName={styles.fixtureNameText} />
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

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
          ) : !bracketData?.rounds ? (
            <div className={styles.emptyTab}>
              <i className="ri-node-tree" />
              {tournament.stage_format === 'groups_knockout' ? (
                <>
                  <p>Bracket not set up yet</p>
                  <span>It'll be generated automatically once the group stage finishes — check the Groups tab.</span>
                </>
              ) : (
                <>
                  <p>Bracket not set up yet</p>
                  {canManage
                    ? <button className={styles.adminActionBtn} style={{ marginTop: 10 }} onClick={initBracket}>
                        <i className="ri-play-circle-line" /> Generate Bracket
                      </button>
                    : <span>The organiser will set up the bracket soon!</span>
                  }
                </>
              )}
            </div>
          ) : (
            <>
              {bracketData?.teamSizeMismatch && (
                <div style={{
                  margin: '0 0 14px', padding: '12px 14px', borderRadius: 10,
                  background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)',
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                }}>
                  <i className="ri-error-warning-line" style={{ color: '#f59e0b', fontSize: 18, flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#f59e0b', marginBottom: 3 }}>
                      Match type updated to {bracketData.currentTeamSize}v{bracketData.currentTeamSize}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {'This bracket was built as ' + (bracketData.isTeamBattle ? bracketData.teamSize + 'v' + bracketData.teamSize + ' Team Battle' : '1v1 Solo') + '.'}
                      {canManage
                        ? ' Tap Reset below to apply the new format.'
                        : ' The admin will reset and regenerate before the tournament starts.'}
                    </div>
                    {canManage && (
                      <button
                        onClick={resetBracket}
                        style={{
                          marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '7px 14px', borderRadius: 8, border: 'none',
                          background: '#f59e0b', color: '#fff',
                          fontSize: 12, fontWeight: 800, cursor: 'pointer',
                        }}
                      >
                        <i className="ri-restart-line" /> Reset Bracket Now
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className={styles.bracketHeader}>
                <div className={styles.bracketInfo}>
                  <span className={styles.bracketSize}>
                    <i className="ri-node-tree" />{bracketData.bracketSize}-{bracketData.isTeamBattle ? 'team' : 'player'} bracket
                  </span>
                  {bracketData.isTeamBattle && (
                    <span className={styles.bracketPlayers} style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>
                      <i className="ri-team-line" style={{ marginRight: 4 }} />
                      {bracketData.teamSize}v{bracketData.teamSize} Team Battle
                    </span>
                  )}
                  {!bracketData.isTeamBattle && realByeCount > 0 && (
                    <span className={styles.bracketPlayers}>
                      {participants.length} registered · {realByeCount} BYE{realByeCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {!bracketData.isTeamBattle && realByeCount === 0 && participants.length > 0 && (
                    <span className={styles.bracketPlayers}>{participants.length} players · no BYEs</span>
                  )}
                </div>
                {canManage && <div className={styles.bracketAdminBadge}><img src="/tick.png" className={styles.tickIconXs} alt="admin" /></div>}
                <button
                  className={`${styles.shareBtn} ${bracketShareCopied ? styles.shareBtnCopied : ''}`}
                  onClick={() => { setShareCardMode('bracket'); setShareGroupId(null); setBracketShareModal(true) }}
                  style={{ fontSize: 11, padding: '5px 10px' }}
                >
                  <><i className="ri-image-line" /> Share Card</>
                </button>
              </div>

              <div className={styles.bracketScroll}>
                <div className={styles.bracketZoom}>
                  <div className={styles.bracketWrap} ref={bracketWrapRef} style={{ position: "relative" }}>
                    <BracketConnectorsSVG wrapRef={bracketWrapRef} bracketData={bracketData} />
                    {bracketData.rounds.map((pairs, rIdx) => {
                      const isChampion = rIdx === bracketData.rounds.length - 1
                      return (
                        <div key={rIdx} className={`${styles.bracketCol} ${isChampion ? styles.bracketColChamp : ''}`}>
                          <div className={`${styles.roundLabel} ${isChampion ? styles.roundLabelChamp : ''}`}>
                            {isChampion && <i className="ri-vip-crown-fill" style={{ marginRight: 4 }} />}
                            {getRoundLabel(rIdx, bracketData.rounds.length, bracketData.bracketSize, bracketData?.round_names)}
                          </div>
                          <div className={styles.matchList}>
                            {pairs.map((pair, pIdx) => isChampion
                              ? <div key={pIdx}><ChampDisplay
                                  entry={pair[0]}
                                  styles={styles}
                                  isAdmin={canManage}
                                  onSetWinner={() => adminSetChampion(rIdx, pIdx)}
                                  leaderboard={leaderboard}
                                  participants={participants}
                                  isTeamBattle={bracketData.isTeamBattle}
                                /></div>
                              : bracketData.isTeamBattle
                                ? (
                                  <div key={pIdx} className={styles.matchPairWrap} data-bround={rIdx} data-bpair={pIdx}>
                                    <TeamMatchCard
                                      pair={pair}
                                      styles={styles}
                                      isAdmin={canManage}
                                      teamSize={bracketData.teamSize}
                                      onSetStatus={(slotIdx, status) => adminSetSlotStatus(rIdx, pIdx, slotIdx, status)}
                                      onRenameTeam={canManage ? (slotIdx, name) => adminRenameTeam(rIdx, pIdx, slotIdx, name) : null}
                                      passPoints={getPassPoints(rIdx)}
                                      currentUserId={user?.id}
                                      globalPairIdx={pIdx}
                                      onJoin={
                                        rIdx === 0 && !registered && !isFull && !isOwnTournament && tournament?.status === 'active'
                                          ? (() => {
                                              const hasFee = (tournament.entrance_fee || 0) > 0
                                              if (!hasFee) return (teamSlotIdx, memberIdx) => attemptJoinViaSlot(pIdx, teamSlotIdx, memberIdx)
                                              if (paymentStatus === 'approved') return (teamSlotIdx, memberIdx) => attemptJoinViaSlot(pIdx, teamSlotIdx, memberIdx)
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
                                : (
                                <div key={pIdx} className={styles.matchPairWrap} data-bround={rIdx} data-bpair={pIdx}>
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
                                            if (!hasFee) return (sIdx) => attemptJoinViaSlot(pIdx, sIdx)
                                            if (paymentStatus === 'approved') return (sIdx) => attemptJoinViaSlot(pIdx, sIdx)
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
                {bracketData.isTeamBattle
                  ? <>
                      <span className={styles.legendItem}><span className={styles.dot} style={{ background: 'var(--accent)' }} /> Active</span>
                      <span className={styles.legendItem}><span className={styles.dot} style={{ background: '#f59e0b' }} /> Winning Team</span>
                      <span className={styles.legendItem}><span className={styles.dot} style={{ background: '#dc2626' }} /> Eliminated</span>
                      <span className={styles.legendItem}><span className={styles.dot} style={{ background: '#7c3aed' }} /> Disqualified</span>
                      {canManage && <span className={styles.legendHint}><i className="ri-cursor-line" /> Tap team to manage</span>}
                    </>
                  : <>
                      <span className={styles.legendItem}><span className={styles.dot} style={{ background: 'var(--accent)' }} /> Active</span>
                      <span className={styles.legendItem}><span className={styles.dot} style={{ background: '#f59e0b' }} /> Winner</span>
                      <span className={styles.legendItem}><span className={styles.dot} style={{ background: '#dc2626' }} /> Eliminated</span>
                      <span className={styles.legendItem}><span className={styles.dot} style={{ background: '#7c3aed' }} /> Disqualified</span>
                      {canManage && <span className={styles.legendHint}><i className="ri-cursor-line" /> Tap player to manage</span>}
                    </>
                }
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
          ) : bracketData?.groups && bracketData?.stage !== 'knockout' ? (
            // ── Group stage: fixtures are generated automatically per group
            // (round-robin) the moment groups are drawn — no manual matchup setup. ──
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
              {bracketData.groups.map(group => (
                <div key={group.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', background: 'rgba(var(--accent-rgb,99,102,241),0.10)', padding: '3px 9px', borderRadius: 6 }}>
                      {group.name}
                    </span>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {group.fixtures.map(fx => {
                      const home = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.homeId)
                      const away = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.awayId)
                      const played = fx.status === 'played'
                      return (
                        <div key={fx.id} style={{
                          background: 'var(--surface)',
                          border: `1px solid ${played ? 'rgba(245,158,11,0.2)' : 'var(--border)'}`,
                          borderRadius: 14, padding: '12px 16px',
                          display: 'flex', alignItems: 'center', gap: 10,
                        }}>
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, justifyContent: 'flex-end', textAlign: 'right' }}>
                            <span style={{ fontWeight: played ? 500 : 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{home?.name || '?'}</span>
                            <div style={{ width: 26, height: 26, borderRadius: '50%', overflow: 'hidden', background: 'var(--bg-2)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800 }}>
                              {home?.avatar ? <img src={home.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (home?.name || '?').slice(0, 2).toUpperCase()}
                            </div>
                          </div>
                          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            {played ? (
                              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 900, fontSize: 15 }}>{fx.scoreHome} – {fx.scoreAway}</span>
                            ) : (
                              <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.05em' }}>VS</span>
                            )}
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', color: played ? '#22c55e' : 'var(--text-muted)', textTransform: 'uppercase' }}>
                              {played ? 'Done' : 'Pending'}
                            </span>
                          </div>
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <div style={{ width: 26, height: 26, borderRadius: '50%', overflow: 'hidden', background: 'var(--bg-2)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800 }}>
                              {away?.avatar ? <img src={away.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (away?.name || '?').slice(0, 2).toUpperCase()}
                            </div>
                            <span style={{ fontWeight: played ? 500 : 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{away?.name || '?'}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              {canManage && (
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center', padding: '4px 0' }}>
                  <i className="ri-information-line" /> Enter results from the manage dashboard's Group Stage card.
                </div>
              )}
            </div>
          ) : !bracketData?.rounds || bracketData.isEmpty ? (
            <div className={styles.emptyTab}>
              <i className="ri-sword-line" /><p>No matches yet</p>
              <span>{canManage ? 'Generate the bracket to create matches.' : 'The organiser will set up the bracket soon!'}</span>
            </div>
          ) : (() => {
            const totalRounds = bracketData.rounds.length
            const allMatchups = []
            bracketData.rounds.slice(0, totalRounds - 1).forEach((pairs, rIdx) => {
              const roundLabel = getRoundLabelSimple(rIdx, totalRounds, bracketData.bracketSize, bracketData?.round_names)
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
          ) : isSquadTournament ? (
            rankedTeamLeaderboard.length === 0 ? (
              <div className={styles.emptyTab}><i className="ri-bar-chart-line" /><p>No squads registered yet</p></div>
            ) : (
              <>
                {!isCompleted && bracketData && !bracketData.isEmpty && (
                  <div className={styles.lbInProgressBanner}>
                    <i className="ri-time-line" />
                    <span>Tournament in progress — standings are provisional until a champion is crowned</span>
                  </div>
                )}
                <div className={styles.lbActions}>
                  <button className={`${styles.shareBtn} ${bracketShareCopied ? styles.shareBtnCopied : ''}`} onClick={() => { setShareCardMode('standings'); setShareGroupId(null); setBracketShareModal(true) }}>
                    <i className="ri-image-line" /> Share Standings
                  </button>
                </div>
                <div className={styles.lbList}>
                  {rankedTeamLeaderboard.map(t => (
                    <div key={t.squadId} className={styles.lbRow} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
                      <span style={{ width: 22, textAlign: 'center', fontWeight: 800, color: 'var(--text-muted)', flexShrink: 0 }}>{t.position}</span>
                      {t.image
                        ? <img src={t.image} alt="" style={{ width: 38, height: 38, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
                        : <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><i className="ri-team-line" /></div>
                      }
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <MarqueeText text={t.name} wrapClassName={styles.groupNameWrap} textClassName={styles.groupNameText} />
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.members.map(m => m.name).join(' · ')}
                        </div>
                      </div>
                      <span style={{ fontWeight: 900, fontFamily: 'ui-monospace, monospace', color: 'var(--accent)', flexShrink: 0 }}>{t.points} pts</span>
                    </div>
                  ))}
                </div>
              </>
            )
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
                        className={`${styles.lbRow} ${getLbRowClass(e)} ${bracketData ? styles.lbRowClickable : ''}`}
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
                            {/* Live bracket status chip — stage-aware */}
                            {bStatus === 'champion' && <span className={styles.liveTagChamp}><i className="ri-trophy-fill" /> Champion</span>}
                            {bStatus === 'final'    && <span className={styles.liveTagIn}><i className="ri-checkbox-circle-fill" /> Final</span>}
                            {bStatus === 'semi'     && <span className={styles.liveTagIn}><i className="ri-checkbox-circle-fill" /> Semi-Final</span>}
                            {bStatus === 'quarter'  && <span className={styles.liveTagIn}><i className="ri-checkbox-circle-fill" /> Quarter-Final</span>}
                            {bStatus === 'in'       && <span className={styles.liveTagIn}><i className="ri-checkbox-circle-fill" /> Active</span>}
                            {bStatus === 'out'      && <span className={styles.liveTagOut}><i className="ri-close-circle-fill" /> Eliminated</span>}
                          </div>
                        </div>
                        <div className={styles.lbCol_status}>
                          {/* prize column slot kept for layout */}
                        </div>
                        <div className={styles.lbCol_prize}>
                          {rowPrize && <span className={styles.lbPrizeAmt}>{fmtTZS(rowPrize)}</span>}
                        </div>
                        <span className={`${styles.lbCol_pts} ${e.points === 0 ? styles.lbPtsDim : bStatus === 'out' ? styles.lbPtsElim : ''}`}>
                          {e.points > 0 ? `${e.points} pts` : (e.lbEntry || bStatus === 'out') ? <span style={{opacity:0.45}}>0 pts</span> : '—'}
                          {e.goalDiff != null && (
                            <span style={{ display: 'block', fontSize: 9, fontWeight: 700, opacity: 0.55, marginTop: 1 }}>
                              GD {e.goalDiff > 0 ? `+${e.goalDiff}` : e.goalDiff}
                            </span>
                          )}
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


      {/* NOTE: the in-page "Manage" tab (bracket generate/reset, matchup
          planner, player counter sync, add-to-bracket, prize distribution)
          has been removed from here. All of that now lives in one place —
          the /manage route — reached via the "Manage Tournament" button
          near the top of this page. This eliminates the duplicate admin
          surfaces that used to exist across this in-page tab, the header
          Edit/Delete buttons, and the separate /edit page. */}

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

      {/* NOTE: Prize distribution modal removed from here — its trigger
          button lived in the now-deleted in-page Manage tab, so this modal
          was unreachable. The underlying logic (openPrizeDistrib,
          savePrizeDistrib, prizeDistrib state above) is left in place,
          unused for now, so it can be ported into /manage as a new tab
          in a follow-up pass rather than rewritten from scratch. */}

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

      {/* ── Squad picker sheet (open team tournaments) ── */}
      {squadPicker && (
        <div className={styles.sheetOverlay} onClick={() => setSquadPicker(null)}>
          <div className={styles.sheetBox} onClick={e => e.stopPropagation()}>
            <div className={styles.sheetHandle} />
            <div style={{ padding: '4px 4px 14px' }}>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 2 }}>Which squad?</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                This is a {tournament?.team_size}v{tournament?.team_size} team tournament. You lead more than one qualifying squad — pick which one enters as a team. The whole roster joins together.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '50vh', overflowY: 'auto' }}>
              {mySquads.map(sq => (
                <button
                  key={sq.id}
                  onClick={() => chooseSquadForJoin(sq.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, cursor: 'pointer', textAlign: 'left' }}
                >
                  {sq.image_url
                    ? <img src={sq.image_url} alt="" style={{ width: 38, height: 38, borderRadius: 9, objectFit: 'cover', flexShrink: 0 }} />
                    : <div style={{ width: 38, height: 38, borderRadius: 9, background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><i className="ri-team-line" /></div>
                  }
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sq.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sq.clan?.name || 'Clan'} · {sq.member_count || 0} members{sq.asLeader ? ' · as clan leader' : ''}</div>
                  </div>
                  <i className="ri-arrow-right-s-line" style={{ color: 'var(--text-muted)' }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Bracket / Standings Share Card modal ── */}
      <BracketShareModal
        open={bracketShareModal}
        onClose={() => setBracketShareModal(false)}
        mode={shareCardMode}
        tournament={tournament}
        bracketData={bracketData}
        groups={shareGroupId ? bracketData?.groups?.filter(g => g.id === shareGroupId) : bracketData?.groups}
        participants={shareGroupId ? (bracketData?.groups?.find(g => g.id === shareGroupId)?.members || []) : participants}
      />
    </div>
  )
}


// NOTE: MatchupPlanner moved to components/MatchupPlanner.js — it's now
// used from the consolidated /manage command center instead of here.

// ─── Sub-components ───────────────────────────────────────────────────────────

function ChampDisplay({ entry, styles, isAdmin, onSetWinner, leaderboard, participants, isTeamBattle }) {
  // entry is either a solo slot { userId, name, ... } or a team { members, teamName, ... }
  const isTeam = isTeamBattle && entry?.members !== undefined

  // ── Team champion ─────────────────────────────────────────────────────
  if (isTeam) {
    const isPending = !entry || entry.status === 'pending' || entry.status === 'bye' || !entry.members?.some(m => m?.userId)
    const isWinner = entry?.status === 'winner'
    const realMembers = (entry?.members || []).filter(m => m?.userId)
    const teamName = entry?.teamName || realMembers.map(m => m.name.slice(0,3)).join('').slice(0,8) || 'TBD'
    const totalPts = realMembers.reduce((sum, m) => {
      const lb = leaderboard?.find(e => e.user_id === m.userId)
      return sum + (lb?.points || 0)
    }, 0)
    return (
      <div className={`${styles.champDisplay} ${isWinner ? styles.champDisplayWinner : ''}`}>
        <div className={styles.champCrown}><i className="ri-vip-crown-fill" /></div>
        <div className={styles.champSlot}>
          {isPending
            ? <span className={styles.champTBD}>TBD</span>
            : <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <i className="ri-team-line" style={{ fontSize: 16, color: isWinner ? '#f59e0b' : 'var(--text-muted)' }} />
                  <span className={styles.champName}>{teamName}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
                  {realMembers.map((m, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '2px 8px 2px 4px' }}>
                      <div style={{ width: 18, height: 18, borderRadius: '50%', overflow: 'hidden', background: 'var(--surface-raised)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 800 }}>
                        {m.avatar ? <img src={m.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : m.name.slice(0,2).toUpperCase()}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>{m.name}</span>
                    </div>
                  ))}
                </div>
                {isWinner && totalPts > 0 && <span className={styles.champPtsBadge}><i className="ri-star-fill" /> {totalPts} total pts</span>}
                {isWinner && <span className={styles.champWinnerBadge}><i className="ri-trophy-fill" /> Champions</span>}
                {isAdmin && !isWinner && (
                  <button className={`${styles.slotAction} ${styles.slotActionWin}`} style={{ marginTop: 6 }} onClick={onSetWinner}>
                    <i className="ri-trophy-fill" /> Crown Champions (+30 pts each)
                  </button>
                )}
              </>
          }
        </div>
      </div>
    )
  }

  // ── Solo champion (original) ──────────────────────────────────────────
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
                <UserBadges email={champProfile?.email} plan={champProfile?.plan} planExpiresAt={champProfile?.plan_expires_at} countryFlag={champProfile?.country_flag} isSeasonWinner={champProfile?.is_season_winner} size={13} gap={2} />
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

// ─── TeamMatchCard — renders a team vs team match ──────────────────────────
// Each "slot" in the pair is a team object: { members: [...], status, teamId, teamName? }
//
// Team name logic (priority order):
//   1. team.teamName  — admin has explicitly named this team (saved in bracket_data)
//   2. Auto-generated — first 3 chars of each real member's username, joined, max 8 chars
//      e.g. members [Steve, Kalib] → "SteKal"
//   3. Fallback       — "Team 1" / "Team 2" (no members joined yet)
//
// Admin can rename a team once via the action sheet. The new name is saved
// into bracket_data by calling onRenameTeam(slotIdx, newName).

function autoTeamName(team, globalIdx) {
  // 1. Admin explicitly named this team — always use it
  if (team?.teamName) return team.teamName

  // 2. Any real members joined — build name from their usernames (even if squad not full yet)
  const realMembers = (team?.members || []).filter(
    m => m?.userId && m.name && m.name !== '?' && m.name !== 'Open' && m.name !== 'BYE' && m.name !== '—'
  )
  if (realMembers.length > 0) {
    // Take up to 3 chars of each member name, join, max 10 chars
    const combined = realMembers.map(m => m.name.slice(0, 3)).join('').slice(0, 10)
    return combined.charAt(0).toUpperCase() + combined.slice(1)
  }

  // 3. No members yet — use stable squad number from teamId (new format: "squad_0", "squad_3")
  if (team?.teamId) {
    const match = team.teamId.match(/(\d+)$/)
    if (match) return `Squad ${parseInt(match[1], 10) + 1}`
  }

  // 4. Old bracket_data has teamId: null — use globalIdx (bracket position) as stable fallback
  //    This always gives the correct Squad number since globalIdx is the team's position in round 0
  return `Squad ${globalIdx + 1}`
}

function TeamMatchCard({ pair, styles, isAdmin, teamSize, onSetStatus, onRenameTeam, passPoints, currentUserId, globalPairIdx, onJoin }) {
  const [teamA, teamB] = pair
  const [activeSheet, setActiveSheet] = useState(null)
  const [renamingTeam, setRenamingTeam] = useState(null) // { slotIdx, value }

  const isByeMatch = teamA?.status === 'bye' || teamB?.status === 'bye'
  // FIX: old bracket_data has teamId: null on open slots — don't treat them as TBD/pending
  // A team is truly "pending" (TBD) only if it's a later-round slot waiting for a winner
  // Open slots in round 0 always have status 'open' or 'active', never 'pending'
  const isPending = (t) => {
    if (!t) return false
    if (t.status === 'bye') return false
    if (t.status === 'open' || t.status === 'active' || t.status === 'winner' || t.status === 'eliminated' || t.status === 'disqualified' || t.status === 'inactive') return false
    // status === 'pending' explicitly, OR no status and no members (later-round TBD slot)
    return t.status === 'pending' || (!t.status && !t.members?.some(m => m?.userId))
  }

  // Figure out which team the current user is in (if any)
  const userTeamSlot = (() => {
    if (!currentUserId) return null
    if (teamA?.members?.some(m => m?.userId === currentUserId)) return 0
    if (teamB?.members?.some(m => m?.userId === currentUserId)) return 1
    return null
  })()

  function statusColor(status) {
    if (status === 'winner') return '#f59e0b'
    if (status === 'eliminated') return '#dc2626'
    if (status === 'disqualified') return '#7c3aed'
    if (status === 'bye') return 'var(--text-muted)'
    if (status === 'open') return 'var(--accent)'
    return 'var(--text)'
  }

  function TeamSlot({ team, slotIdx }) {
    if (!team) return null
    const isBye = team.status === 'bye'
    const isOpen = team.status === 'open'
    const pend = isPending(team)
    const won = team.status === 'winner'
    const lost = team.status === 'eliminated' || team.status === 'disqualified'
    const isMyTeam = userTeamSlot === slotIdx
    const tName = isBye ? 'BYE' : pend ? 'TBD' : autoTeamName(team, globalPairIdx * 2 + slotIdx)
    const hasAdminNamedOnce = !!team?.teamName

    return (
      <div
        style={{
          display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px',
          background: won
            ? 'rgba(245,158,11,0.07)'
            : isMyTeam
              ? 'rgba(var(--accent-rgb,99,102,241),0.07)'
              : 'var(--surface)',
          borderRadius: 0,
          opacity: lost ? 0.45 : 1,
          cursor: isAdmin && !isBye && !pend ? 'pointer' : 'default',
          position: 'relative',
        }}
        onClick={() => isAdmin && !isBye && !pend && !isOpen && setActiveSheet({ slotIdx, team })}
      >
        {/* ── Team name row ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <i className="ri-team-line" style={{ fontSize: 12, color: isOpen ? 'var(--text-muted)' : statusColor(team.status), flexShrink: 0 }} />
          <span style={{
            fontSize: 13, fontWeight: 800,
            color: isOpen ? 'var(--text-muted)' : won ? '#f59e0b' : isMyTeam ? 'var(--accent)' : 'var(--text)',
            letterSpacing: '0.02em', flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {tName}
          </span>
          {/* Status badges */}
          {won && (
            <span style={{ fontSize: 9, fontWeight: 800, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>WINNER</span>
          )}
          {team.status === 'disqualified' && (
            <span style={{ fontSize: 9, fontWeight: 800, color: '#7c3aed', background: 'rgba(124,58,237,0.1)', padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>DQ</span>
          )}
          {/* "You" badge */}
          {isMyTeam && (
            <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--accent)', background: 'rgba(var(--accent-rgb,99,102,241),0.12)', padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>YOU</span>
          )}
        </div>

        {/* ── Members row ── */}
        {!isBye && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {(team.members || []).map((m, mi) => {
              const isEmpty = !m?.userId || m.status === 'open' || m.status === 'empty' || m.status === 'pending'
              const isMe = m?.userId === currentUserId
              const canJoinSpot = isEmpty && !!onJoin
              return (
                <div key={mi}
                  onClick={e => { if (canJoinSpot) { e.stopPropagation(); onJoin(slotIdx, mi) } }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: isMe
                      ? 'rgba(var(--accent-rgb,99,102,241),0.10)'
                      : canJoinSpot
                        ? 'rgba(var(--accent-rgb,99,102,241),0.04)'
                        : 'var(--bg)',
                    border: isMe
                      ? '1px solid rgba(var(--accent-rgb,99,102,241),0.3)'
                      : canJoinSpot
                        ? '1px dashed rgba(var(--accent-rgb,99,102,241),0.4)'
                        : '1px solid var(--border)',
                    borderRadius: 20, padding: '3px 8px 3px 4px',
                    cursor: canJoinSpot ? 'pointer' : 'default',
                    transition: 'opacity 0.15s',
                  }}
                >
                  {/* Mini avatar */}
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                    background: isEmpty ? 'var(--surface)' : 'var(--surface-raised)',
                    border: isEmpty ? '1px dashed var(--border-dark)' : '1px solid var(--border-dark)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden', fontSize: 8, fontWeight: 800,
                  }}>
                    {isEmpty
                      ? <i className="ri-add-line" style={{ fontSize: 10, color: canJoinSpot ? 'var(--accent)' : 'var(--text-muted)' }} />
                      : m.avatar
                        ? <img src={m.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ color: 'var(--text-dim)' }}>{(m.name || '?').slice(0, 2).toUpperCase()}</span>
                    }
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: isMe ? 700 : canJoinSpot ? 600 : 500,
                    color: isEmpty
                      ? (canJoinSpot ? 'var(--accent)' : 'var(--text-muted)')
                      : isMe ? 'var(--accent)' : 'var(--text)',
                    maxWidth: 68, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {isEmpty ? (canJoinSpot ? 'Join' : 'Open') : isMe ? 'You' : (m.name || '?')}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className={`${styles.matchCard} ${isByeMatch ? styles.matchCardBye : ''}`} style={{ padding: 0, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <TeamSlot team={teamA} slotIdx={0} />
        <div className={styles.matchDivider}><span className={styles.vsLabel}>vs</span></div>
        <TeamSlot team={teamB} slotIdx={1} />
      </div>

      {/* ── Admin action sheet ── */}
      {activeSheet && (
        <div className={styles.sheetOverlay} onClick={() => { setActiveSheet(null); setRenamingTeam(null) }}>
          <div className={styles.sheetBox} onClick={e => e.stopPropagation()}>
            <div className={styles.sheetHandle} />

            {/* Team identity */}
            <div className={styles.sheetPlayer}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#6366f1' }}>
                <i className="ri-team-line" />
              </div>
              <div className={styles.sheetPlayerInfo}>
                <span className={styles.sheetPlayerName}>
                  {autoTeamName(activeSheet.team, globalPairIdx * 2 + activeSheet.slotIdx)}
                </span>
                <span className={styles.sheetPlayerMeta}>
                  {teamSize}v{teamSize} · {activeSheet.team.members?.filter(m => m?.userId).length || 0} / {teamSize} members
                </span>
              </div>
            </div>

            {/* ── Rename field (admin, one-time if not already named) ── */}
            {onRenameTeam && (
              <div style={{ margin: '0 0 12px', padding: '10px 14px', background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <i className="ri-edit-line" style={{ marginRight: 4 }} />
                  {activeSheet.team?.teamName ? 'Team Name (locked — already renamed)' : 'Set Team Name (one time)'}
                </div>
                {activeSheet.team?.teamName
                  ? (
                    <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{activeSheet.team.teamName}</span>
                  )
                  : renamingTeam?.slotIdx === activeSheet.slotIdx
                    ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          autoFocus
                          maxLength={12}
                          value={renamingTeam.value}
                          onChange={e => setRenamingTeam(r => ({ ...r, value: e.target.value }))}
                          placeholder="e.g. SteKal"
                          style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1.5px solid var(--accent)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 700, outline: 'none' }}
                        />
                        <button
                          onClick={() => {
                            const name = renamingTeam.value.trim()
                            if (name) { onRenameTeam(activeSheet.slotIdx, name); setActiveSheet(null); setRenamingTeam(null) }
                          }}
                          style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setRenamingTeam(null)}
                          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                        >
                          Cancel
                        </button>
                      </div>
                    )
                    : (
                      <button
                        onClick={() => setRenamingTeam({ slotIdx: activeSheet.slotIdx, value: autoTeamName(activeSheet.team, globalPairIdx * 2 + activeSheet.slotIdx) })}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px dashed var(--border-dark)', background: 'transparent', color: 'var(--accent)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                      >
                        <i className="ri-edit-line" /> Rename team
                      </button>
                    )
                }
              </div>
            )}

            {/* Match actions */}
            <div className={styles.sheetActions}>
              <button className={`${styles.sheetBtn} ${styles.sheetBtnPass}`}
                onClick={() => { onSetStatus(activeSheet.slotIdx, 'winner'); setActiveSheet(null) }}
                disabled={activeSheet.team.status === 'winner'}>
                <div className={styles.sheetBtnIcon} style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}><i className="ri-arrow-right-circle-fill" /></div>
                <div className={styles.sheetBtnText}><span>Pass team to next round</span><span className={styles.sheetBtnSub}>+{passPoints} pts per member</span></div>
                {activeSheet.team.status === 'winner' && <i className="ri-checkbox-circle-fill" style={{ color: '#f59e0b', marginLeft: 'auto', fontSize: 16 }} />}
              </button>
              <button className={`${styles.sheetBtn} ${styles.sheetBtnElim}`}
                onClick={() => { onSetStatus(activeSheet.slotIdx, 'eliminated'); setActiveSheet(null) }}
                disabled={activeSheet.team.status === 'eliminated'}>
                <div className={styles.sheetBtnIcon} style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626' }}><i className="ri-close-circle-fill" /></div>
                <div className={styles.sheetBtnText}><span>Eliminate team</span><span className={styles.sheetBtnSub}>Remove from bracket</span></div>
                {activeSheet.team.status === 'eliminated' && <i className="ri-checkbox-circle-fill" style={{ color: '#dc2626', marginLeft: 'auto', fontSize: 16 }} />}
              </button>
              <button className={`${styles.sheetBtn} ${styles.sheetBtnDQ}`}
                onClick={() => { onSetStatus(activeSheet.slotIdx, 'disqualified'); setActiveSheet(null) }}
                disabled={activeSheet.team.status === 'disqualified'}>
                <div className={styles.sheetBtnIcon} style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}><i className="ri-spam-2-fill" /></div>
                <div className={styles.sheetBtnText}><span>Disqualify team</span><span className={styles.sheetBtnSub}>Flag as rule violation</span></div>
                {activeSheet.team.status === 'disqualified' && <i className="ri-checkbox-circle-fill" style={{ color: '#7c3aed', marginLeft: 'auto', fontSize: 16 }} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
        <div data-match-card>
          <SlotRow
            entry={a} styles={styles} isAdmin={isAdmin}
            onOpen={() => openSheet(0, a)}
            passPoints={passPoints} earnedPts={getEarnedPts(a)} entryProfile={getEntryProfile(a)}
            onJoin={a?.status === 'open' && onJoin ? () => onJoin(0) : undefined}
          />
        </div>
        <div className={styles.matchDivider}><span className={styles.vsLabel}>vs</span></div>
        <div data-match-card>
          <SlotRow
            entry={b} styles={styles} isAdmin={isAdmin}
            onOpen={() => openSheet(1, b)}
            passPoints={passPoints} earnedPts={getEarnedPts(b)} entryProfile={getEntryProfile(b)}
            onJoin={b?.status === 'open' && onJoin ? () => onJoin(1) : undefined}
          />
        </div>
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
                  <UserBadges email={sheetProfile?.email} plan={sheetProfile?.plan} planExpiresAt={sheetProfile?.plan_expires_at} countryFlag={sheetProfile?.country_flag} isSeasonWinner={sheetProfile?.is_season_winner} size={13} gap={2} />
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
        <UserBadges email={entryProfile?.email} plan={entryProfile?.plan} planExpiresAt={entryProfile?.plan_expires_at} countryFlag={entryProfile?.country_flag} isSeasonWinner={entryProfile?.is_season_winner} size={10} gap={2} />
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


// ─── BracketConnectorsSVG ─────────────────────────────────────────────────────
// Uses real DOM measurements to draw L-shaped bracket connectors.
// SVG coordinate space = bracketWrap's top-left corner (position:relative).
function BracketConnectorsSVG({ wrapRef, bracketData }) {
  const svgRef = React.useRef(null)
  const [paths, setPaths] = React.useState([])
  const [svgSize, setSvgSize] = React.useState({ w: 0, h: 0 })

  React.useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || !bracketData?.rounds) return

    function compute() {
      requestAnimationFrame(() => {
        const wrapRect = wrap.getBoundingClientRect()
        if (!wrapRect.width || !wrapRect.height) return

        // SVG is absolutely positioned inside bracketWrap (position:relative)
        // All measurements are relative to wrapRect top-left
        const scrollLeft = wrap.scrollLeft || 0
        const scrollTop  = wrap.scrollTop  || 0

        setSvgSize({ w: wrap.scrollWidth, h: wrap.scrollHeight })

        const totalRounds = bracketData.rounds.length
        const newPaths = []

        for (let rIdx = 0; rIdx < totalRounds - 2; rIdx++) {
          const pairCount = bracketData.rounds[rIdx].length
          for (let pIdx = 0; pIdx < pairCount; pIdx++) {
            const srcEl = wrap.querySelector(`[data-bround="${rIdx}"][data-bpair="${pIdx}"]`)
            const dstEl = wrap.querySelector(`[data-bround="${rIdx + 1}"][data-bpair="${Math.floor(pIdx / 2)}"]`)
            if (!srcEl || !dstEl) continue

            const sRect = srcEl.getBoundingClientRect()
            const dRect = dstEl.getBoundingClientRect()

            // Convert to bracketWrap-local coordinates (add scroll offset)
            const sx = sRect.right  - wrapRect.left + scrollLeft
            const sy = sRect.top + sRect.height / 2 - wrapRect.top + scrollTop
            const dx = dRect.left   - wrapRect.left + scrollLeft
            const dy = dRect.top + dRect.height / 2 - wrapRect.top + scrollTop

            // L-shape: horizontal out → vertical → horizontal in
            const midX = sx + (dx - sx) * 0.5
            newPaths.push(`M ${sx} ${sy} H ${midX} V ${dy} H ${dx}`)
          }
        }
        setPaths(newPaths)
      })
    }

    const t1 = setTimeout(compute, 80)
    const t2 = setTimeout(compute, 400) // second pass after fonts/images settle
    const ro = new ResizeObserver(compute)
    ro.observe(wrap)
    return () => { clearTimeout(t1); clearTimeout(t2); ro.disconnect() }
  }, [wrapRef, bracketData])

  if (!paths.length) return null

  return (
    <svg
      ref={svgRef}
      style={{
        position: 'absolute',
        top: 0, left: 0,
        width: svgSize.w || '100%',
        height: svgSize.h || '100%',
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: 0,
      }}
    >
      {paths.map((d, i) => (
        <path
          key={i} d={d}
          fill="none"
          stroke="var(--border-dark)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
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
