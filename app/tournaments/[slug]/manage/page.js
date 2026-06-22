'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '../../../../components/AuthProvider'
import { supabase } from '../../../../lib/supabase'
import styles from './page.module.css'
import BracketBuilder from '../../../../components/BracketBuilder'

// ── Helpers ───────────────────────────────────────────────────────────────────
function getPlayerBracketStatus(userId, bracketData) {
  if (!bracketData?.rounds || !userId) return null
  const totalRounds = bracketData.rounds.length
  let deepestActive = -1, isEliminated = false, found = false
  bracketData.rounds.forEach((pairs, rIdx) => {
    pairs.forEach(pair => {
      pair.forEach(slot => {
        if (!slot || slot.status === 'bye') return
        let inSlot = false
        if (bracketData.isTeamBattle) inSlot = (slot.members || []).some(m => m?.userId === userId)
        else inSlot = slot.userId === userId
        if (!inSlot) return
        found = true
        const isOut = slot.status === 'eliminated' || slot.status === 'disqualified'
        if (!isOut && rIdx > deepestActive) deepestActive = rIdx
        if (isOut) isEliminated = true
      })
    })
  })
  if (!found) return null
  if (isEliminated && deepestActive === -1) return 'out'
  const fromEnd = (totalRounds - 1) - deepestActive
  if (fromEnd === 0) return 'champion'
  if (fromEnd === 1) return 'final'
  if (fromEnd === 2) return 'semi'
  return 'in'
}

function parseBracketData(raw) {
  if (!raw) return null
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
}
function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p }

function buildLobbyBracket(maxSlots, teamSize = 1) {
  if (!maxSlots || maxSlots < 2) return null
  const size = nextPow2(maxSlots)
  if (teamSize > 1) {
    const teamCount = Math.ceil(size / teamSize)
    const openTeam = () => ({
      members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'Open', avatar: null, status: 'open' })),
      status: 'open', teamId: null,
    })
    const teams = Array.from({ length: teamCount }, openTeam)
    const rounds = []
    let cur = teams
    while (cur.length > 1) {
      const pairs = []
      for (let i = 0; i < cur.length; i += 2) pairs.push([{ ...cur[i] }, { ...cur[i+1] }])
      rounds.push(pairs)
      cur = pairs.map(() => ({ members: Array.from({ length: teamSize }, () => ({ userId: null, name: '?', avatar: null, status: 'pending' })), status: 'pending', teamId: null }))
    }
    rounds.push([[{ members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'TBD', avatar: null, status: 'pending' })), status: 'pending', teamId: null }, null]])
    return { rounds, bracketSize: size, isEmpty: true, teamSize, isTeamBattle: true }
  }
  const open = Array.from({ length: size }, () => ({ userId: null, name: 'Open', avatar: null, status: 'open' }))
  const rounds = []
  let cur = open
  while (cur.length > 1) {
    const pairs = []
    for (let i = 0; i < cur.length; i += 2) pairs.push([{ ...cur[i] }, { ...cur[i+1] }])
    rounds.push(pairs)
    cur = pairs.map(() => ({ userId: null, name: '?', avatar: null, status: 'pending' }))
  }
  rounds.push([[{ userId: null, name: 'TBD', avatar: null, status: 'pending' }, null]])
  return { rounds, bracketSize: size, isEmpty: true, teamSize: 1 }
}

function buildBracket(parts, teamSize = 1) {
  if (!parts || parts.length < 2) return null
  if (teamSize > 1) {
    const shuffled = [...parts].sort(() => Math.random() - 0.5)
    const teams = []
    for (let i = 0; i < shuffled.length; i += teamSize) {
      const members = shuffled.slice(i, i + teamSize).map(p => ({ userId: p.user_id, name: p.profiles?.username || '?', avatar: p.profiles?.avatar_url || null, status: 'active' }))
      while (members.length < teamSize) members.push({ userId: null, name: '—', avatar: null, status: 'empty' })
      teams.push({ members, status: 'active', teamId: `team_${i}` })
    }
    if (teams.length < 2) return null
    const size = nextPow2(teams.length)
    for (let i = 0; i < size - teams.length; i++) teams.push({ members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'BYE', avatar: null, status: 'bye' })), status: 'bye', teamId: `bye_${i}` })
    const rounds = []
    let cur = teams
    while (cur.length > 1) {
      const pairs = []
      for (let i = 0; i < cur.length; i += 2) pairs.push([{ ...cur[i] }, { ...cur[i+1] }])
      rounds.push(pairs)
      cur = pairs.map(() => ({ members: Array.from({ length: teamSize }, () => ({ userId: null, name: '?', avatar: null, status: 'pending' })), status: 'pending', teamId: null }))
    }
    rounds.push([[{ members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'TBD', avatar: null, status: 'pending' })), status: 'pending', teamId: null }, null]])
    return { rounds, bracketSize: size, teamSize, isTeamBattle: true }
  }
  const size = nextPow2(parts.length)
  const slots = [
    ...parts.map(p => ({ userId: p.user_id, name: p.profiles?.username || '?', avatar: p.profiles?.avatar_url || null, status: 'active' })),
    ...Array(size - parts.length).fill(null).map(() => ({ userId: null, name: 'BYE', avatar: null, status: 'bye' })),
  ]
  const rounds = []
  let cur = slots
  while (cur.length > 1) {
    const pairs = []
    for (let i = 0; i < cur.length; i += 2) pairs.push([{ ...cur[i] }, { ...cur[i+1] }])
    rounds.push(pairs)
    cur = pairs.map(() => ({ userId: null, name: '?', avatar: null, status: 'pending' }))
  }
  rounds.push([[{ userId: null, name: 'TBD', avatar: null, status: 'pending' }, null]])
  return { rounds, bracketSize: size, teamSize: 1 }
}

const fmtTZS = v => v ? `TZS ${Number(v).toLocaleString()}` : '—'
const STATUS_COLORS = { active: '#22c55e', ongoing: '#6366f1', upcoming: '#f59e0b', completed: '#94a3b8' }

const GAME_SLUGS_MANAGE = ['pubgm','freefire','codm','bussid','efootball','dls','fifa']
const GAME_NAMES_MANAGE = { pubgm:'PUBGM', freefire:'Free Fire', codm:'Call of Duty', bussid:'Maleo BUSSID', efootball:'eFootball', dls:'DLS26', fifa:'FIFA 26' }
const FORMATS_MANAGE    = ['Solo','Duo','Squad','Team','League','Round Robin','Bo3','Bo5']
const STATUSES_MANAGE   = ['active','ongoing','upcoming','completed']
const TEAM_SIZE_OPTS    = [
  { value: 1, label: '1v1', sub: 'Solo' },
  { value: 2, label: '2v2', sub: 'Team' },
  { value: 4, label: '4v4', sub: 'Team' },
  { value: 8, label: '8v8', sub: 'Team' },
]

const TABS = [
  { key: 'overview',  icon: 'ri-dashboard-fill',         label: 'Overview' },
  { key: 'players',   icon: 'ri-group-fill',              label: 'Players'  },
  { key: 'bracket',   icon: 'ri-node-tree',               label: 'Bracket'  },
  { key: 'edit',      icon: 'ri-settings-3-fill',         label: 'Edit'     },
  { key: 'payments',  icon: 'ri-money-dollar-circle-fill', label: 'Payments' },
  { key: 'danger',    icon: 'ri-error-warning-fill',      label: 'Danger'   },
]

// ── Confirm modal ─────────────────────────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <p className={styles.modalMsg}>{message}</p>
        <div className={styles.modalBtns}>
          <button className={styles.modalCancel} onClick={onCancel}>Cancel</button>
          <button className={styles.modalConfirm} onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

// ── Avatar helper ─────────────────────────────────────────────────────────────
function Avatar({ src, name, size = 36, radius = 10 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: radius, background: 'var(--bg-2)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.36, fontWeight: 800, color: 'var(--text-muted)', flexShrink: 0 }}>
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (name || '?')[0].toUpperCase()}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function TournamentManage() {
  const { slug }  = useParams()
  const router    = useRouter()
  const { user, isAdmin } = useAuth()

  const [tournament,   setTournament]   = useState(null)
  const [participants, setParticipants] = useState([])
  const [leaderboard,  setLeaderboard]  = useState([])
  const [bracketData,  setBracketData]  = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [activeTab,    setActiveTab]    = useState('overview')
  const [confirm,      setConfirm]      = useState(null)
  // ── Edit tab form state ───────────────────────────────────────────────────
  const [editForm,     setEditForm]     = useState(null)   // populated when tournament loads
  const [editSaving,   setEditSaving]   = useState(false)
  const [editSaved,    setEditSaved]    = useState(false)
  const [editError,    setEditError]    = useState('')
  const [toast,        setToast]        = useState(null)
  // ── Transfer state ────────────────────────────────────────────────────────
  const [showTransfer,     setShowTransfer]     = useState(false)
  const [transferTargets,  setTransferTargets]  = useState([])   // tournaments to transfer to
  const [transferTarget,   setTransferTarget]   = useState(null) // selected tournament id
  const [transferLoading,  setTransferLoading]  = useState(false)
  const [transferDone,     setTransferDone]     = useState(false)
  const toastTimer = useRef(null)
  const id = useRef(null)

  const showToast = useCallback((msg, type = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ msg, type })
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }, [])

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!slug) return
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)
    const { data: t, error } = await (isUUID
      ? supabase.from('tournaments').select('*').eq('id', slug).maybeSingle()
      : supabase.from('tournaments').select('*').eq('slug', slug).maybeSingle())
    if (error || !t) { setLoading(false); return }
    id.current = t.id
    setTournament(t)
    setEditForm({
      name:         t.name         || '',
      description:  t.description  || '',
      game_slug:    t.game_slug    || 'pubgm',
      format:       t.format       || '',
      slots:        t.slots        ?? '',
      entrance_fee: t.entrance_fee ?? '',
      date:         t.date         || '',
      status:       t.status       || 'active',
      team_size:    t.team_size    || 1,
      prize:        t.prize        || '',
      pro_only:     t.pro_only     || false,
    })

    const [partsRes, lbRes, pmtsRes] = await Promise.all([
      supabase.from('tournament_participants')
        .select('*, profiles(username, avatar_url, level, country_flag, is_season_winner)')
        .eq('tournament_id', t.id),
      supabase.from('tournament_leaderboard')
        .select('*, profiles(username, avatar_url)')
        .eq('tournament_id', t.id)
        .order('position', { ascending: true }),
      supabase.from('tournament_payments')
        .select('user_id, status')
        .eq('tournament_id', t.id),
    ])

    if (partsRes.error) console.error('manage: participants fetch error', partsRes.error)
    if (lbRes.error)    console.error('manage: leaderboard fetch error', lbRes.error)

    // Merge payment status onto each participant
    const payMap = Object.fromEntries((pmtsRes.data || []).map(p => [p.user_id, p.status]))
    const partsWithPayment = (partsRes.data || []).map(p => ({ ...p, payment_status: payMap[p.user_id] || null }))

    setParticipants(partsWithPayment)
    setLeaderboard(lbRes.data || [])

    const parsed = parseBracketData(t.bracket_data)
    const dbTeamSize = t.team_size || 1
    if (!parsed) {
      setBracketData(t.slots >= 2 ? buildLobbyBracket(t.slots, dbTeamSize) : null)
    } else {
      const mode = parsed.isTeamBattle ? (parsed.teamSize || 2) : 1
      if (mode !== dbTeamSize && parsed.isEmpty) setBracketData(buildLobbyBracket(t.slots, dbTeamSize))
      else if (mode !== dbTeamSize && !parsed.isEmpty) setBracketData({ ...parsed, teamSizeMismatch: true, currentTeamSize: dbTeamSize })
      else setBracketData(parsed)
    }
    setLoading(false)
  }, [slug])

  useEffect(() => { load() }, [load])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  // ── Auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!loading && tournament && user) {
      if (!isAdmin && tournament.created_by !== user.id) router.replace(`/tournaments/${slug}`)
    }
  }, [loading, tournament, user, isAdmin, slug, router])

  // ── Server-side permission check ──────────────────────────────────────────
  async function verifyCanManage() {
    if (!user) return false
    const ADMIN_EMAILS = ['stevenmsambwa8@gmail.com', 'nabogamingss1@gmail.com']
    const [{ data: { user: fresh } }, { data: t }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('tournaments').select('created_by').eq('id', id.current).maybeSingle(),
    ])
    return ADMIN_EMAILS.includes(fresh?.email) || t?.created_by === user.id
  }

  async function saveBracket(bd) {
    setSaving(true)
    try {
      // bd includes round_names and slot_count embedded by BracketBuilder
      const updatePayload = {
        bracket_data: bd,
        // Persist round names as their own column so slug page / leaderboard can read without parsing full bracket
        round_names: bd?.round_names ?? null,
        // Update slots to match actual bracket capacity (counted from open slots in round 0)
        ...(bd?.slot_count > 0 ? { slots: bd.slot_count } : {}),
      }
      const { error } = await supabase.from('tournaments').update(updatePayload).eq('id', id.current)
      if (error) showToast('Failed to save bracket.', 'error')
      else {
        showToast('Bracket saved!')
        // Keep local tournament state in sync
        setTournament(t => ({ ...t, round_names: bd?.round_names ?? t?.round_names, ...(bd?.slot_count > 0 ? { slots: bd.slot_count } : {}) }))
      }
    } catch { showToast('Network error.', 'error') }
    finally { setSaving(false) }
  }

  // ── Bracket actions ───────────────────────────────────────────────────────
  async function initBracket() {
    if (!await verifyCanManage()) return
    const teamSize = tournament?.team_size || 1
    const bd = buildBracket(participants, teamSize)
    if (!bd) { showToast('Need at least 2 players.', 'error'); return }
    const { error } = await supabase.from('tournaments').update({ bracket_data: bd }).eq('id', id.current)
    if (error) { showToast('Failed to generate bracket.', 'error'); return }
    setBracketData(bd)
    showToast('Bracket generated!', 'success')
    const notifs = participants.filter(p => p.user_id).map(p => ({
      user_id: p.user_id, title: `Bracket generated — ${tournament.name}`,
      body: 'The bracket is live. Check your slot!',
      type: 'tournament', meta: { tournament_id: id.current }, read: false,
    }))
    if (notifs.length) await supabase.from('notifications').insert(notifs)
    load()
  }

  async function resetBracket() {
    if (!await verifyCanManage()) return
    const teamSize = tournament?.team_size || 1
    const slots    = tournament?.slots    || 32
    setConfirm({
      message: `Reset to a fresh ${teamSize > 1 ? teamSize + 'v' + teamSize + ' team' : '1v1'} lobby? All placements and points will be cleared.`,
      onConfirm: async () => {
        setConfirm(null)
        await supabase.from('tournament_leaderboard').delete().eq('tournament_id', id.current)
        const fresh = buildLobbyBracket(slots, teamSize)
        await supabase.from('tournaments').update({ bracket_data: fresh }).eq('id', id.current)
        setBracketData(fresh)
        showToast('Bracket reset.', 'success')
        load()
      },
    })
  }

  // ── Player actions ────────────────────────────────────────────────────────
  async function removeParticipant(userId, username) {
    if (!await verifyCanManage()) return
    setConfirm({
      message: `Remove ${username || 'this player'} from the tournament? Their bracket slot will be cleared.`,
      onConfirm: async () => {
        setConfirm(null)
        await Promise.all([
          supabase.from('tournament_participants').delete().eq('tournament_id', id.current).eq('user_id', userId),
          supabase.from('tournament_leaderboard').delete().eq('tournament_id', id.current).eq('user_id', userId),
          supabase.from('tournament_payments').delete().eq('tournament_id', id.current).eq('user_id', userId),
        ])
        if (bracketData) {
          const openSlot   = { userId: null, name: 'Open', avatar: null, status: 'open' }
          const openMember = { userId: null, name: 'Open', avatar: null, status: 'open' }
          const newRounds = bracketData.rounds.map(r => r.map(pair =>
            bracketData.isTeamBattle
              ? pair.map(team => !team?.members ? team : { ...team, members: team.members.map(m => m?.userId === userId ? openMember : m), status: team.members.every(m => !m?.userId || m.userId === userId) ? 'open' : team.status })
              : pair.map(s => s?.userId === userId ? openSlot : s)
          ))
          const nb = { ...bracketData, rounds: newRounds }
          await saveBracket(nb); setBracketData(nb)
        }
        showToast(`${username || 'Player'} removed.`, 'success')
        load()
      },
    })
  }

  async function approvePayment(userId) {
    if (!await verifyCanManage()) return
    await supabase.from('tournament_payments').update({ status: 'approved' }).eq('tournament_id', id.current).eq('user_id', userId)
    showToast('Payment approved.', 'success')
    load()
  }

  async function addToBracket(p) {
    if (!await verifyCanManage()) return
    const { data: freshT } = await supabase.from('tournaments').select('bracket_data').eq('id', id.current).single()
    const freshBd = parseBracketData(freshT?.bracket_data) ?? bracketData
    if (!freshBd) return
    const { data: prof } = await supabase.from('profiles').select('username, avatar_url').eq('id', p.user_id).maybeSingle()
    const mSlot = { userId: p.user_id, name: prof?.username || 'Player', avatar: prof?.avatar_url || null, status: 'active' }
    let placed = false, newRounds
    if (freshBd.isTeamBattle) {
      newRounds = freshBd.rounds.map((r, ri) => {
        if (ri !== 0 || placed) return r
        return r.map(pair => pair.map(team => {
          if (placed || !team || team.status === 'bye') return team
          const mi = (team.members || []).findIndex(m => !m?.userId || m.status === 'open' || m.status === 'empty' || m.status === 'pending')
          if (mi === -1) return team
          placed = true
          const nm = team.members.map((m, i) => i === mi ? mSlot : m)
          return { ...team, members: nm, status: nm.every(m => m?.userId) ? 'active' : 'open' }
        }))
      })
    } else {
      let pick = null
      freshBd.rounds[0]?.forEach((pair, pi) => pair.forEach((s, si) => { if (!pick && !s?.userId && (s?.status === 'open' || s?.status === 'bye')) pick = { pi, si } }))
      if (!pick) { showToast('No open slots.', 'error'); return }
      newRounds = freshBd.rounds.map((r, ri) => ri !== 0 ? r : r.map((pair, pi) => pi !== pick.pi ? pair : pair.map((s, si) => si === pick.si ? mSlot : s)))
      placed = true
    }
    if (!placed) { showToast('No open slots.', 'error'); return }
    const nb = { ...freshBd, rounds: newRounds, isEmpty: false }
    await saveBracket(nb); setBracketData(nb)
    showToast(`${prof?.username || 'Player'} added to bracket.`, 'success')
  }

  // ── Other actions ─────────────────────────────────────────────────────────
  async function syncCount() {
    if (!await verifyCanManage()) return
    const { count } = await supabase.from('tournament_participants').select('*', { count: 'exact', head: true }).eq('tournament_id', id.current)
    await supabase.from('tournaments').update({ registered_count: count || 0 }).eq('id', id.current)
    showToast(`Count synced: ${count}`, 'success')
    load()
  }

  async function updateStatus(newStatus) {
    if (!await verifyCanManage()) return
    await supabase.from('tournaments').update({ status: newStatus }).eq('id', id.current)
    setTournament(t => ({ ...t, status: newStatus }))
    showToast(`Status → ${newStatus}`, 'success')
  }

  // ── Transfer players to another tournament ────────────────────────────────
  async function saveEdit() {
    if (!editForm?.name?.trim()) { setEditError('Name is required'); return }
    setEditSaving(true); setEditError(''); setEditSaved(false)
    const { error: err } = await supabase.from('tournaments').update({
      name:         editForm.name.trim(),
      description:  editForm.description?.trim() || null,
      game_slug:    editForm.game_slug,
      format:       editForm.format,
      slots:        Number(editForm.slots) || tournament.slots,
      entrance_fee: editForm.entrance_fee !== '' ? String(editForm.entrance_fee) : null,
      date:         editForm.date || null,
      status:       editForm.status,
      team_size:    Number(editForm.team_size) || 1,
      prize:        editForm.prize || null,
      pro_only:     editForm.pro_only || false,
    }).eq('id', id.current)
    setEditSaving(false)
    if (err) { setEditError(err.message); return }
    setEditSaved(true)
    setTournament(t => ({ ...t, ...editForm }))
    showToast('Tournament updated!')
    setTimeout(() => setEditSaved(false), 2500)
  }

  function setEF(key, val) { setEditForm(f => ({ ...f, [key]: val })); setEditSaved(false); setEditError('') }

  async function loadTransferTargets() {
    setShowTransfer(true)
    setTransferLoading(true)
    setTransferDone(false)
    setTransferTarget(null)
    // Load other active tournaments with matching team_size
    const { data } = await supabase
      .from('tournaments')
      .select('id, name, slug, team_size, registered_count, slots, status')
      .neq('id', id.current)
      .eq('team_size', tournament?.team_size || 1)
      .in('status', ['active', 'upcoming'])
      .order('created_at', { ascending: false })
      .limit(20)
    setTransferTargets(data || [])
    setTransferLoading(false)
  }

  async function transferPlayers() {
    if (!transferTarget || !participants.length) return
    setTransferLoading(true)
    try {
      // Get players already in target tournament (avoid duplicates)
      const { data: existing } = await supabase
        .from('tournament_participants')
        .select('user_id')
        .eq('tournament_id', transferTarget)
      const existingIds = new Set((existing || []).map(e => e.user_id))

      const toInsert = participants
        .filter(p => !existingIds.has(p.user_id))
        .map(p => ({ tournament_id: transferTarget, user_id: p.user_id }))

      if (toInsert.length > 0) {
        await supabase.from('tournament_participants').insert(toInsert)
        // Update registered_count on target
        const newCount = (existing?.length || 0) + toInsert.length
        await supabase.from('tournaments').update({ registered_count: newCount }).eq('id', transferTarget)
      }

      // Notify transferred players
      const targetT = transferTargets.find(t => t.id === transferTarget)
      const notifs = participants.map(p => ({
        user_id:     p.user_id,
        title:       'You have been transferred',
        body:        `You've been moved to "${targetT?.name || 'a new tournament'}". Check it out!`,
        type:        'tournament',
        meta:        { tournament_id: transferTarget },
        read:        false,
      }))
      for (let i = 0; i < notifs.length; i += 100) {
        await supabase.from('notifications').insert(notifs.slice(i, i + 100))
      }

      setTransferDone(true)
      showToast(`${toInsert.length} player${toInsert.length !== 1 ? 's' : ''} transferred successfully!`)
    } catch (err) {
      showToast('Transfer failed: ' + err.message, 'error')
    }
    setTransferLoading(false)
  }

  async function deleteTournament() {
    if (!await verifyCanManage()) return
    setConfirm({
      message: 'Permanently delete this tournament? All data — participants, bracket, payments, scores — will be lost. Cannot be undone.',
      onConfirm: async () => {
        setConfirm(null)
        await Promise.all([
          supabase.from('tournament_leaderboard').delete().eq('tournament_id', id.current),
          supabase.from('tournament_participants').delete().eq('tournament_id', id.current),
          supabase.from('tournament_payments').delete().eq('tournament_id', id.current),
        ])
        await supabase.from('tournaments').delete().eq('id', id.current)
        router.replace('/tournaments')
      },
    })
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className={styles.loadWrap}>
      <div className="loader" />
    </div>
  )
  if (!tournament) return (
    <div className={styles.loadWrap}>
      <p style={{ color: 'var(--text-muted)' }}>Tournament not found.</p>
    </div>
  )

  // ── Derived ───────────────────────────────────────────────────────────────
  const realCount       = participants.length
  const openSlots       = Math.max(0, (tournament.slots || 0) - realCount)
  const bracketRounds   = bracketData?.rounds?.length ?? 0
  const hasBracket      = bracketData && !bracketData.isEmpty
  const pendingPayments = participants.filter(p => p.payment?.[0]?.status === 'payment_submitted')

  const inBracketSet = new Set()
  bracketData?.rounds[0]?.forEach(pair => pair.forEach(s => {
    if (bracketData.isTeamBattle) (s?.members || []).forEach(m => { if (m?.userId) inBracketSet.add(m.userId) })
    else if (s?.userId) inBracketSet.add(s.userId)
  }))
  const unplaced = participants.filter(p => !inBracketSet.has(p.user_id))

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>

      {/* ── Toast ── */}
      {toast && (
        <div className={`${styles.toast} ${styles['toast' + toast.type.charAt(0).toUpperCase() + toast.type.slice(1)]}`}>
          {toast.msg}
        </div>
      )}

      {/* ── Confirm ── */}
      {confirm && <ConfirmModal message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}

      {/* ── Header ── */}
      <div className={styles.header}>
        <button className={styles.headerBack} onClick={() => router.back()}>
          <i className="ri-arrow-left-line" />
        </button>
        <div className={styles.headerInfo}>
          <div className={styles.headerRole}>
            {isAdmin ? '⬡ Admin · Command Centre' : '◈ Creator · Command Centre'}
          </div>
          <div className={styles.headerTitle}>{tournament.name}</div>
        </div>
        <button className={`${styles.headerIconBtn} ${styles.headerIconBtnAccent}`}
          onClick={() => router.push(`/tournaments/${tournament.slug || tournament.id}/edit`)}>
          <i className="ri-edit-line" />
        </button>
        <button className={styles.headerIconBtn}
          onClick={() => router.push(`/tournaments/${tournament.slug || tournament.id}`)}>
          <i className="ri-eye-line" />
        </button>
      </div>

      {/* ── KPI strip ── */}
      <div className={styles.kpis}>
        {[
          { val: realCount, sub: `/ ${tournament.slots}`, label: 'Players', color: '#22c55e', icon: 'ri-group-fill' },
          { val: openSlots, sub: 'open slots',            label: 'Available', color: openSlots > 0 ? '#f59e0b' : 'var(--text-muted)', icon: 'ri-door-open-line' },
          { val: bracketRounds, sub: hasBracket ? 'bracket live' : 'no bracket', label: 'Rounds', color: '#6366f1', icon: 'ri-node-tree' },
          { val: leaderboard.length, sub: 'ranked', label: 'Scored', color: '#f59e0b', icon: 'ri-bar-chart-fill' },
        ].map(k => (
          <div key={k.label} className={styles.kpi}>
            <i className={`${k.icon} ${styles.kpiIcon}`} style={{ color: k.color }} />
            <span className={styles.kpiVal} style={{ color: k.color }}>{k.val}</span>
            <span className={styles.kpiLabel}>{k.label}</span>
            <span className={styles.kpiSub}>{k.sub}</span>
          </div>
        ))}
      </div>

      {/* ── Chips ── */}
      <div className={styles.chipsRow}>
        <div className={`${styles.chip} ${styles.chip}`} style={{ color: STATUS_COLORS[tournament.status], borderColor: STATUS_COLORS[tournament.status] + '33', background: STATUS_COLORS[tournament.status] + '11' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[tournament.status], flexShrink: 0 }} />
          {tournament.status}
        </div>
        {(tournament.team_size || 1) > 1 && (
          <div className={`${styles.chip} ${styles.chipIndigo}`}>
            <i className="ri-team-line" /> {tournament.team_size}v{tournament.team_size}
          </div>
        )}
        {tournament.entrance_fee > 0 && (
          <div className={`${styles.chip} ${styles.chipAmber}`}>
            <i className="ri-money-dollar-circle-line" /> {fmtTZS(tournament.entrance_fee)}
          </div>
        )}
        {pendingPayments.length > 0 && (
          <div className={`${styles.chip} ${styles.chipDanger}`} onClick={() => setActiveTab('payments')}>
            <i className="ri-alarm-warning-fill" /> {pendingPayments.length} pending
          </div>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div className={styles.tabs}>
        {TABS.map(t => (
          <button key={t.key} className={`${styles.tab} ${activeTab === t.key ? (t.key === 'danger' ? styles.tabDanger : styles.tabActive) : ''}`}
            onClick={() => setActiveTab(t.key)}>
            <i className={t.icon} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className={styles.body}>

        {/* ════ OVERVIEW ════ */}
        {activeTab === 'overview' && <>

          {/* Bracket card */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <i className="ri-node-tree" style={{ color: '#6366f1', fontSize: 16 }} />
              <span className={styles.cardTitle}>Bracket</span>
              {saving && <span className={styles.cardSaving}><i className="ri-loader-4-line" /> Saving…</span>}
            </div>
            {bracketData?.teamSizeMismatch && (
              <div className={styles.mismatchBanner}>
                <i className="ri-error-warning-line" style={{ color: '#f59e0b', fontSize: 18, flexShrink: 0 }} />
                <div>
                  <div className={styles.mismatchTitle}>Match type changed to {bracketData.currentTeamSize}v{bracketData.currentTeamSize}</div>
                  <div className={styles.mismatchSub}>Reset and regenerate to apply the new format.</div>
                </div>
              </div>
            )}
            <div className={styles.statRow}>
              {[
                { val: bracketRounds, label: 'Rounds', color: '#6366f1' },
                { val: bracketData?.bracketSize ?? 0, label: 'Slots', color: '#22c55e' },
                { val: bracketData?.isTeamBattle ? `${bracketData.teamSize}v${bracketData.teamSize}` : '1v1', label: 'Format', color: bracketData?.isTeamBattle ? '#a78bfa' : 'var(--text-muted)' },
              ].map(s => (
                <div key={s.label} className={styles.statBox}>
                  <span className={styles.statBoxVal} style={{ color: s.color }}>{s.val}</span>
                  <span className={styles.statBoxLabel}>{s.label}</span>
                </div>
              ))}
            </div>
            <div className={styles.btnRow}>
              {!hasBracket
                ? <button className={styles.btnPrimary} onClick={initBracket} disabled={realCount < 2}>
                    <i className="ri-play-fill" /> Generate Bracket
                    {realCount < 2 && <span style={{ fontSize: 10, opacity: 0.6 }}> (2+ needed)</span>}
                  </button>
                : <button className={styles.btnDanger} onClick={resetBracket}>
                    <i className="ri-restart-line" /> Reset Bracket
                  </button>
              }
              <button className={styles.btnGhost} onClick={() => router.push(`/tournaments/${tournament.slug || tournament.id}`)}>
                <i className="ri-eye-line" />
              </button>
            </div>
          </div>

          {/* Status */}
          <div className={styles.card}>
            <div className={styles.sectionLabel}>Set Status</div>
            <div className={styles.statusRow}>
              {['active','ongoing','upcoming','completed'].map(s => (
                <button key={s} className={`${styles.statusChip} ${tournament.status === s ? styles.statusChipActive : ''}`}
                  style={tournament.status === s ? { background: STATUS_COLORS[s], borderColor: STATUS_COLORS[s] } : {}}
                  onClick={() => updateStatus(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Sync */}
          <button className={styles.btnFull} onClick={syncCount}>
            <i className="ri-refresh-line" /> Sync Player Count
          </button>

          {/* Top scores */}
          {leaderboard.length > 0 && (
            <div className={styles.card}>
              <div className={styles.sectionLabel}>Top Scores</div>
              {leaderboard.slice(0, 5).map((e, i) => (
                <div key={e.user_id} className={styles.scoreRow}>
                  <span className={styles.scoreRank}>{i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`}</span>
                  <span className={styles.scoreName}>{e.profiles?.username || '—'}</span>
                  <span className={styles.scorePts}>{e.points ?? 0} <span className={styles.scorePtsSub}>pts</span></span>
                </div>
              ))}
            </div>
          )}
        </>}

        {/* ════ PLAYERS ════ */}
        {activeTab === 'players' && <>
          {participants.length === 0
            ? <p className={styles.empty}>No players yet</p>
            : participants.map(p => {
                const bStatus = getPlayerBracketStatus(p.user_id, bracketData)
                const dotColor = bStatus==='champion'?'#f59e0b':bStatus==='out'?'#dc2626':'#22c55e'
                const payStatus = p.payment_status
                return (
                  <div key={p.id} className={styles.playerRow}>
                    <div className={styles.playerAvatar}>
                      <Avatar src={p.profiles?.avatar_url} name={p.profiles?.username} size={36} radius={10} />
                      <span className={styles.playerDot} style={{ background: dotColor }} />
                    </div>
                    <div className={styles.playerInfo}>
                      <span className={styles.playerName}>{p.profiles?.username || 'Unknown'}</span>
                      <span className={styles.playerMeta}>Lv.{p.profiles?.level ?? 1}</span>
                    </div>
                    <div className={styles.playerBadges}>
                      {bStatus === 'champion' && <span>🏆</span>}
                      {bStatus === 'out'      && <span className={styles.badgeOut}>OUT</span>}
                      {payStatus === 'payment_submitted' && (
                        <button className={styles.btnAmber} onClick={() => approvePayment(p.user_id)}>Approve</button>
                      )}
                      {payStatus === 'approved' && <span className={styles.badgePaid}>PAID</span>}
                      <button className={styles.btnRemove} onClick={() => removeParticipant(p.user_id, p.profiles?.username)}>
                        <i className="ri-user-unfollow-line" />
                      </button>
                    </div>
                  </div>
                )
              })
          }
        </>}

        {/* ════ BRACKET ════ */}
        {activeTab === 'bracket' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* mismatch warning */}
            {bracketData?.teamSizeMismatch && (
              <div className={styles.mismatchBanner}>
                <i className="ri-error-warning-line" style={{ color: '#f59e0b', fontSize: 18, flexShrink: 0 }} />
                <div>
                  <div className={styles.mismatchTitle}>Match type changed to {bracketData.currentTeamSize}v{bracketData.currentTeamSize}</div>
                  <div className={styles.mismatchSub}>Reset bracket to apply the new format.</div>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className={styles.btnRow}>
              {!hasBracket
                ? <button className={styles.btnPrimary} onClick={initBracket} disabled={realCount < 2}>
                    <i className="ri-play-fill" /> Generate from Players
                    {realCount < 2 && <span style={{ fontSize: 10, opacity: 0.6 }}> (2+ needed)</span>}
                  </button>
                : <button className={styles.btnDanger} onClick={resetBracket}>
                    <i className="ri-restart-line" /> Reset Bracket
                  </button>
              }
              <button className={styles.btnGhost} onClick={() => router.push(`/tournaments/${tournament.slug || tournament.id}`)}>
                <i className="ri-eye-line" /> View
              </button>
            </div>

            {/* Free-form bracket builder */}
            <div className={styles.card} style={{ padding: '14px 16px' }}>
              <div className={styles.cardHead}>
                <i className="ri-node-tree" style={{ color: '#6366f1', fontSize: 16 }} />
                <span className={styles.cardTitle}>Bracket Editor</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  Drag to swap · Tap to rename · Add rounds
                </span>
              </div>
              <BracketBuilder
                bracketData={bracketData}
                onChange={(bd) => setBracketData(bd)}
                onSave={saveBracket}
                participants={participants}
                teamSize={tournament?.team_size || 1}
                saving={saving}
                manageMode={true}
              />
            </div>

            {/* Unplaced players */}
            {unplaced.length > 0 && (
              <div className={styles.unplacedCard}>
                <div className={styles.unplacedHead}>{unplaced.length} unplaced player{unplaced.length !== 1 ? 's' : ''}</div>
                {unplaced.map(p => (
                  <div key={p.user_id} className={styles.unplacedRow}>
                    <div className={styles.unplacedAvatar}>
                      <Avatar src={p.profiles?.avatar_url} name={p.profiles?.username} size={28} radius={7} />
                    </div>
                    <span className={styles.unplacedName}>{p.profiles?.username || 'Player'}</span>
                    <button className={styles.btnAdd} onClick={() => addToBracket(p)}>+ Add to bracket</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════ PAYMENTS ════ */}
        {activeTab === 'payments' && <>
          {participants.filter(p => p.payment_status).length === 0
            ? <p className={styles.empty}>No payment records</p>
            : participants.filter(p => p.payment_status).map(p => (
                <div key={p.id} className={`${styles.payCard} ${p.payment_status === 'approved' ? styles.payApprovedBorder : p.payment_status === 'payment_submitted' ? styles.payPendingBorder : ''}`}>
                  <Avatar src={p.profiles?.avatar_url} name={p.profiles?.username} size={36} radius={10} />
                  <div className={styles.playerInfo}>
                    <span className={styles.playerName}>{p.profiles?.username || 'Unknown'}</span>
                    <span className={styles.playerMeta}>{fmtTZS(tournament.entrance_fee)} entry fee</span>
                  </div>
                  {p.payment_status === 'approved'
                    ? <span className={styles.badgePaid}>APPROVED</span>
                    : p.payment_status === 'payment_submitted'
                      ? <button className={styles.btnAmber} onClick={() => approvePayment(p.user_id)}>Approve</button>
                      : <span className={styles.playerMeta}>{p.payment_status}</span>
                  }
                </div>
              ))
          }
        </>}

        {/* ════ DANGER ════ */}
        {/* ════ EDIT ════ */}
        {activeTab === 'edit' && editForm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div className={styles.card} style={{ padding: '16px' }}>
              <div className={styles.cardHead} style={{ marginBottom: 14 }}>
                <i className="ri-settings-3-line" style={{ color: '#6366f1', fontSize: 16 }} />
                <span className={styles.cardTitle}>Tournament Details</span>
                <button onClick={saveEdit} disabled={editSaving} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 8, background: editSaved ? '#22c55e' : '#6366f1', color: '#fff', border: 'none', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                  {editSaving ? <><i className="ri-loader-4-line" /> Saving…</> : editSaved ? <><i className="ri-check-line" /> Saved</> : <><i className="ri-save-line" /> Save Changes</>}
                </button>
              </div>

              {editError && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#ef444415', color: '#ef4444', fontSize: 12, fontWeight: 600, marginBottom: 12 }}><i className="ri-error-warning-line" /> {editError}</div>}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                <div className={styles.field}>
                  <label>Tournament Name</label>
                  <input value={editForm.name} onChange={e => setEF('name', e.target.value)} placeholder="Tournament name" className={styles.input} />
                </div>

                <div className={styles.field}>
                  <label>Description</label>
                  <textarea rows={3} value={editForm.description} onChange={e => setEF('description', e.target.value)} placeholder="Optional rules or info…" className={styles.textarea} />
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label>Game</label>
                    <select value={editForm.game_slug} onChange={e => setEF('game_slug', e.target.value)} className={styles.select}>
                      {GAME_SLUGS_MANAGE.map(s => <option key={s} value={s}>{GAME_NAMES_MANAGE[s]}</option>)}
                    </select>
                  </div>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label>Format</label>
                    <select value={editForm.format} onChange={e => setEF('format', e.target.value)} className={styles.select}>
                      {FORMATS_MANAGE.map(f => <option key={f}>{f}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label>Status</label>
                    <select value={editForm.status} onChange={e => setEF('status', e.target.value)} className={styles.select}>
                      {STATUSES_MANAGE.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label>Date</label>
                    <input value={editForm.date} onChange={e => setEF('date', e.target.value)} placeholder="e.g. Jun 28" className={styles.input} />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label>Prize Pool (TZS)</label>
                    <input value={editForm.prize} onChange={e => setEF('prize', e.target.value)} placeholder="e.g. 500,000" className={styles.input} />
                  </div>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label>Entry Fee (TZS)</label>
                    <input value={editForm.entrance_fee} onChange={e => setEF('entrance_fee', e.target.value)} placeholder="Leave blank = free" className={styles.input} />
                  </div>
                </div>

                <div className={styles.field}>
                  <label>Match Type</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                    {TEAM_SIZE_OPTS.map(opt => (
                      <button key={opt.value} type="button" onClick={() => setEF('team_size', opt.value)}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '8px 14px', borderRadius: 10, border: 'none', fontFamily: 'inherit', cursor: 'pointer', minWidth: 60, background: editForm.team_size === opt.value ? '#6366f1' : 'var(--surface)', color: editForm.team_size === opt.value ? '#fff' : 'var(--text)' }}>
                        <span style={{ fontWeight: 800, fontSize: 14 }}>{opt.label}</span>
                        <span style={{ fontSize: 10, opacity: 0.75 }}>{opt.sub}</span>
                      </button>
                    ))}
                  </div>
                  {editForm.team_size !== (tournament?.team_size || 1) && (
                    <p style={{ marginTop: 8, fontSize: 12, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <i className="ri-information-line" />
                      Match type changed — reset bracket in the Bracket tab to apply.
                    </p>
                  )}
                </div>

                {/* Pro Only toggle */}
                <button type="button" onClick={() => setEF('pro_only', !editForm.pro_only)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${editForm.pro_only ? '#a855f740' : 'var(--border)'}`, background: editForm.pro_only ? '#a855f710' : 'var(--surface)', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                  <i className={editForm.pro_only ? 'ri-vip-crown-fill' : 'ri-vip-crown-line'} style={{ color: editForm.pro_only ? '#a855f7' : 'var(--text-muted)', fontSize: 18 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: editForm.pro_only ? '#a855f7' : 'var(--text)' }}>Pro & Elite Only</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{editForm.pro_only ? 'Only Pro & Elite members can join.' : 'Open to all players.'}</div>
                  </div>
                  <div style={{ width: 36, height: 20, borderRadius: 10, background: editForm.pro_only ? '#a855f7' : 'var(--border)', position: 'relative', flexShrink: 0, transition: 'background 0.2s' }}>
                    <div style={{ position: 'absolute', top: 2, left: editForm.pro_only ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'danger' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* ── Transfer Players ── */}
            <div className={styles.dangerCard} style={{ borderColor: '#6366f130', background: '#6366f108' }}>
              <div className={styles.dangerHead} style={{ color: '#6366f1' }}>
                <i className="ri-swap-line" style={{ fontSize: 18 }} /> Transfer Players
              </div>
              <p className={styles.dangerSub}>
                Move all {participants.length} registered players from this tournament into another existing tournament.
                Only tournaments with the same match type ({tournament?.team_size === 1 ? '1v1 Solo' : `${tournament?.team_size}v${tournament?.team_size} Team`}) are shown.
                Players already in the target tournament won't be duplicated.
              </p>

              {!showTransfer ? (
                <button
                  className={styles.btnPrimary}
                  onClick={loadTransferTargets}
                  disabled={participants.length === 0}
                  style={{ opacity: participants.length === 0 ? 0.5 : 1 }}
                >
                  <i className="ri-swap-line" /> Choose Destination Tournament
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {transferLoading && !transferTargets.length && (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                      <i className="ri-loader-4-line" /> Loading tournaments…
                    </div>
                  )}

                  {!transferLoading && !transferDone && transferTargets.length === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                      No matching tournaments found. Create a new tournament with the same match type first.
                    </div>
                  )}

                  {transferDone ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: '#22c55e15', border: '1px solid #22c55e30' }}>
                      <i className="ri-checkbox-circle-fill" style={{ color: '#22c55e', fontSize: 18 }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>Transfer complete!</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          Players moved to "{transferTargets.find(t => t.id === transferTarget)?.name}". They were notified.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {transferTargets.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {transferTargets.map(t => {
                            const isFull = (t.registered_count || 0) >= (t.slots || 0)
                            const isSelected = transferTarget === t.id
                            return (
                              <button
                                key={t.id}
                                onClick={() => setTransferTarget(isSelected ? null : t.id)}
                                disabled={isFull}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 10,
                                  padding: '10px 12px', borderRadius: 10,
                                  border: `1.5px solid ${isSelected ? '#6366f1' : 'var(--border)'}`,
                                  background: isSelected ? '#6366f112' : 'var(--surface)',
                                  cursor: isFull ? 'not-allowed' : 'pointer',
                                  opacity: isFull ? 0.5 : 1,
                                  textAlign: 'left', width: '100%',
                                }}
                              >
                                <i className="ri-tournament-line" style={{ color: isSelected ? '#6366f1' : 'var(--text-muted)', fontSize: 16, flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                    {t.registered_count || 0}/{t.slots} players · {t.status}
                                    {isFull && ' · FULL'}
                                  </div>
                                </div>
                                {isSelected && <i className="ri-checkbox-circle-fill" style={{ color: '#6366f1', fontSize: 18, flexShrink: 0 }} />}
                              </button>
                            )
                          })}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={transferPlayers}
                          disabled={!transferTarget || transferLoading}
                          style={{ flex: 1, padding: '10px', borderRadius: 9, background: transferTarget ? '#6366f1' : 'var(--border)', color: transferTarget ? '#fff' : 'var(--text-muted)', border: 'none', fontSize: 13, fontWeight: 800, cursor: transferTarget ? 'pointer' : 'default' }}
                        >
                          {transferLoading ? <><i className="ri-loader-4-line" /> Transferring…</> : <><i className="ri-swap-line" /> Transfer {participants.length} Players</>}
                        </button>
                        <button onClick={() => { setShowTransfer(false); setTransferTarget(null); setTransferDone(false) }}
                          style={{ padding: '10px 14px', borderRadius: 9, background: 'var(--surface)', border: '1.5px solid var(--border)', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ── Delete Tournament ── */}
            <div className={styles.dangerCard}>
              <div className={styles.dangerHead}>
                <i className="ri-error-warning-fill" style={{ fontSize: 18 }} /> Danger Zone
              </div>
              <p className={styles.dangerSub}>
                Deleting this tournament permanently removes all bracket data, participants, payments, and leaderboard entries. This cannot be undone.
              </p>
              <button className={styles.btnDangerFull} onClick={deleteTournament}>
                <i className="ri-delete-bin-fill" style={{ fontSize: 18 }} /> Delete Tournament
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
