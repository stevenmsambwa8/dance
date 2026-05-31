'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '../../../../components/AuthProvider'
import { supabase } from '../../../../lib/supabase'

// ── Helpers ──────────────────────────────────────────────────────────────────
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
    let current = teams
    while (current.length > 1) {
      const pairs = []
      for (let i = 0; i < current.length; i += 2) pairs.push([{ ...current[i] }, { ...current[i + 1] }])
      rounds.push(pairs)
      current = pairs.map(() => ({ members: Array.from({ length: teamSize }, () => ({ userId: null, name: '?', avatar: null, status: 'pending' })), status: 'pending', teamId: null }))
    }
    rounds.push([[{ members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'TBD', avatar: null, status: 'pending' })), status: 'pending', teamId: null }, null]])
    return { rounds, bracketSize: size, isEmpty: true, teamSize, isTeamBattle: true }
  }
  const open = Array.from({ length: size }, () => ({ userId: null, name: 'Open', avatar: null, status: 'open' }))
  const rounds = []
  let current = open
  while (current.length > 1) {
    const pairs = []
    for (let i = 0; i < current.length; i += 2) pairs.push([{ ...current[i] }, { ...current[i + 1] }])
    rounds.push(pairs)
    current = pairs.map(() => ({ userId: null, name: '?', avatar: null, status: 'pending' }))
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
    let current = teams
    while (current.length > 1) {
      const pairs = []
      for (let i = 0; i < current.length; i += 2) pairs.push([{ ...current[i] }, { ...current[i + 1] }])
      rounds.push(pairs)
      current = pairs.map(() => ({ members: Array.from({ length: teamSize }, () => ({ userId: null, name: '?', avatar: null, status: 'pending' })), status: 'pending', teamId: null }))
    }
    rounds.push([[{ members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'TBD', avatar: null, status: 'pending' })), status: 'pending', teamId: null }, null]])
    return { rounds, bracketSize: size, byeCount: size - teams.length, teamSize, isTeamBattle: true }
  }
  const size = nextPow2(parts.length)
  const slots = [...parts.map(p => ({ userId: p.user_id, name: p.profiles?.username || '?', avatar: p.profiles?.avatar_url || null, status: 'active' })), ...Array(size - parts.length).fill(null).map(() => ({ userId: null, name: 'BYE', avatar: null, status: 'bye' }))]
  const rounds = []
  let current = slots
  while (current.length > 1) {
    const pairs = []
    for (let i = 0; i < current.length; i += 2) pairs.push([{ ...current[i] }, { ...current[i + 1] }])
    rounds.push(pairs)
    current = pairs.map(() => ({ userId: null, name: '?', avatar: null, status: 'pending' }))
  }
  rounds.push([[{ userId: null, name: 'TBD', avatar: null, status: 'pending' }, null]])
  return { rounds, bracketSize: size, byeCount: size - parts.length, teamSize: 1 }
}
const fmtTZS = v => v ? `TZS ${Number(v).toLocaleString()}` : '—'

// ── Toast ─────────────────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)
  const show = useCallback((msg, type = 'success') => {
    if (timer.current) clearTimeout(timer.current)
    setToast({ msg, type })
    timer.current = setTimeout(() => setToast(null), 3000)
  }, [])
  return { toast, show }
}

// ── Confirm modal ─────────────────────────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:1000,display:'flex',alignItems:'flex-end',justifyContent:'center',padding:16 }}>
      <div style={{ background:'#1a1d2e',borderRadius:20,padding:24,width:'100%',maxWidth:400,border:'1px solid rgba(255,255,255,0.08)' }}>
        <p style={{ color:'rgba(255,255,255,0.85)',fontSize:14,lineHeight:1.6,margin:'0 0 20px',textAlign:'center' }}>{message}</p>
        <div style={{ display:'flex',gap:10 }}>
          <button onClick={onCancel} style={{ flex:1,padding:'11px 0',borderRadius:10,border:'1px solid rgba(255,255,255,0.1)',background:'transparent',color:'rgba(255,255,255,0.5)',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit' }}>Cancel</button>
          <button onClick={onConfirm} style={{ flex:1,padding:'11px 0',borderRadius:10,border:'none',background:'#dc2626',color:'#fff',fontSize:13,fontWeight:800,cursor:'pointer',fontFamily:'inherit' }}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function TournamentManage() {
  const { slug }  = useParams()
  const router    = useRouter()
  const { user, isAdmin } = useAuth()

  const [tournament,    setTournament]    = useState(null)
  const [participants,  setParticipants]  = useState([])
  const [leaderboard,   setLeaderboard]   = useState([])
  const [bracketData,   setBracketData]   = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(false)
  const [activeTab,     setActiveTab]     = useState('overview')
  const [confirm,       setConfirm]       = useState(null)
  const { toast, show: showToast }        = useToast()
  const id = useRef(null)

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

    const [{ data: parts }, { data: lb }] = await Promise.all([
      supabase.from('tournament_participants').select('*, profiles(username, avatar_url, level, tier, email, country_flag, is_season_winner), payment:tournament_payments(status)').eq('tournament_id', t.id),
      supabase.from('tournament_leaderboard').select('*, profiles(username, avatar_url)').eq('tournament_id', t.id).order('position', { ascending: true }),
    ])
    setParticipants(parts || [])
    setLeaderboard(lb || [])

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

  // ── Auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!loading && tournament && user) {
      const canManage = isAdmin || tournament.created_by === user.id
      if (!canManage) router.replace(`/tournaments/${slug}`)
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
      const { error } = await supabase.from('tournaments').update({ bracket_data: bd }).eq('id', id.current)
      if (error) showToast('Failed to save bracket.', 'error')
    } catch { showToast('Network error.', 'error') }
    finally { setSaving(false) }
  }

  async function initBracket() {
    if (!await verifyCanManage()) return
    const teamSize = tournament?.team_size || 1
    const bd = buildBracket(participants, teamSize)
    if (!bd) { showToast('Need at least 2 players.', 'error'); return }
    const { error } = await supabase.from('tournaments').update({ bracket_data: bd }).eq('id', id.current)
    if (error) { showToast('Failed to save bracket.', 'error'); return }
    setBracketData(bd)
    showToast('Bracket generated!', 'success')
    await supabase.from('notifications').insert(
      participants.filter(p => p.user_id).map(p => ({
        user_id: p.user_id, title: `Bracket generated — ${tournament.name}`,
        body: 'The bracket is live. Check your slot!',
        type: 'tournament', meta: { tournament_id: id.current }, read: false,
      }))
    )
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
        showToast('Bracket reset to fresh lobby.', 'success')
        load()
      },
    })
  }

  async function syncCount() {
    if (!await verifyCanManage()) return
    const { count } = await supabase.from('tournament_participants').select('*', { count: 'exact', head: true }).eq('tournament_id', id.current)
    await supabase.from('tournaments').update({ registered_count: count || 0 }).eq('id', id.current)
    showToast(`Count synced: ${count}`, 'success')
    load()
  }

  async function approvePayment(userId) {
    if (!await verifyCanManage()) return
    await supabase.from('tournament_payments').update({ status: 'approved' }).eq('tournament_id', id.current).eq('user_id', userId)
    showToast('Payment approved.', 'success')
    load()
  }

  async function removeParticipant(userId) {
    if (!await verifyCanManage()) return
    setConfirm({
      message: 'Remove this player from the tournament? Their bracket slot will be cleared.',
      onConfirm: async () => {
        setConfirm(null)
        await Promise.all([
          supabase.from('tournament_participants').delete().eq('tournament_id', id.current).eq('user_id', userId),
          supabase.from('tournament_leaderboard').delete().eq('tournament_id', id.current).eq('user_id', userId),
          supabase.from('tournament_payments').delete().eq('tournament_id', id.current).eq('user_id', userId),
        ])
        if (bracketData) {
          const openSlot = { userId: null, name: 'Open', avatar: null, status: 'open' }
          const openMember = { userId: null, name: 'Open', avatar: null, status: 'open' }
          const newRounds = bracketData.rounds.map(r => r.map(pair =>
            bracketData.isTeamBattle
              ? pair.map(team => !team?.members ? team : {
                  ...team,
                  members: team.members.map(m => m?.userId === userId ? openMember : m),
                  status: team.members.some(m => m?.userId && m.userId !== userId) ? team.status : 'open',
                })
              : pair.map(s => s?.userId === userId ? openSlot : s)
          ))
          const nb = { ...bracketData, rounds: newRounds }
          await saveBracket(nb)
          setBracketData(nb)
        }
        showToast('Player removed.', 'success')
        load()
      },
    })
  }

  async function updateStatus(newStatus) {
    if (!await verifyCanManage()) return
    await supabase.from('tournaments').update({ status: newStatus }).eq('id', id.current)
    setTournament(t => ({ ...t, status: newStatus }))
    showToast(`Status → ${newStatus}`, 'success')
  }

  async function deleteTournament() {
    if (!await verifyCanManage()) return
    setConfirm({
      message: 'Permanently delete this tournament? All data will be lost. This cannot be undone.',
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

  // ── Derived ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0c14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <i className="ri-loader-4-line" style={{ fontSize: 32, color: '#6366f1', animation: 'spin 1s linear infinite' }} />
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, letterSpacing: '0.1em' }}>LOADING</span>
        </div>
      </div>
    )
  }

  if (!tournament) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0c14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'rgba(255,255,255,0.3)' }}>Tournament not found.</p>
      </div>
    )
  }

  const realCount     = participants.length
  const openSlots     = Math.max(0, (tournament.slots || 0) - realCount)
  const bracketRounds = bracketData?.rounds?.length ?? 0
  const hasBracket    = bracketData && !bracketData.isEmpty
  const isCompleted   = tournament.status === 'completed'
  const pendingPayments = participants.filter(p => p.payment?.[0]?.status === 'payment_submitted')
  const statusColors  = { active: '#22c55e', ongoing: '#6366f1', upcoming: '#f59e0b', completed: '#94a3b8' }
  const TABS = [
    { key: 'overview',  icon: 'ri-dashboard-fill',   label: 'Overview'  },
    { key: 'players',   icon: 'ri-group-fill',         label: 'Players'   },
    { key: 'bracket',   icon: 'ri-node-tree',          label: 'Bracket'   },
    { key: 'payments',  icon: 'ri-money-dollar-circle-fill', label: 'Payments' },
    { key: 'danger',    icon: 'ri-error-warning-fill', label: 'Danger'    },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0a0c14', fontFamily: 'inherit', paddingBottom: 40 }}>

      {/* ── Ambient background ── */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(99,102,241,0.12) 0%, transparent 70%)' }} />

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700,
          background: toast.type === 'error' ? '#dc2626' : toast.type === 'info' ? '#6366f1' : '#16a34a',
          color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── Confirm modal ── */}
      {confirm && <ConfirmModal message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 500, margin: '0 auto' }}>

        {/* ── Header ── */}
        <div style={{ padding: '16px 16px 0', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button onClick={() => router.back()} style={{
            width: 36, height: 36, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, cursor: 'pointer', flexShrink: 0,
          }}>
            <i className="ri-arrow-left-line" />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.15em', color: '#818cf8', marginBottom: 2 }}>
              {isAdmin ? '⬡ ADMIN' : '◈ CREATOR'} · COMMAND CENTRE
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {tournament.name}
            </div>
          </div>
          <button onClick={() => router.push(`/tournaments/${tournament.slug || tournament.id}/edit`)}
            style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.12)', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, cursor: 'pointer', flexShrink: 0 }}>
            <i className="ri-edit-line" />
          </button>
          <button onClick={() => router.push(`/tournaments/${tournament.slug || tournament.id}`)}
            style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, cursor: 'pointer', flexShrink: 0 }}>
            <i className="ri-eye-line" />
          </button>
        </div>

        {/* ── KPI strip ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, padding: '0 16px', marginBottom: 16 }}>
          {[
            { val: realCount, sub: `/ ${tournament.slots}`, label: 'PLAYERS', color: '#22c55e', icon: 'ri-group-fill' },
            { val: openSlots, sub: 'open', label: 'SLOTS', color: openSlots > 0 ? '#f59e0b' : '#94a3b8', icon: 'ri-door-open-line' },
            { val: bracketRounds, sub: hasBracket ? 'live' : 'empty', label: 'ROUNDS', color: '#6366f1', icon: 'ri-node-tree' },
            { val: leaderboard.length, sub: 'scored', label: 'RANKED', color: '#f59e0b', icon: 'ri-bar-chart-fill' },
          ].map(k => (
            <div key={k.label} style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 12, padding: '10px 10px 8px', display: 'flex', flexDirection: 'column', gap: 1,
            }}>
              <i className={k.icon} style={{ fontSize: 11, color: k.color, marginBottom: 2 }} />
              <span style={{ fontSize: 22, fontWeight: 900, color: k.color, lineHeight: 1, letterSpacing: '-0.02em' }}>{k.val}</span>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{k.label}</span>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>{k.sub}</span>
            </div>
          ))}
        </div>

        {/* ── Status + type row ── */}
        <div style={{ display: 'flex', gap: 8, padding: '0 16px', marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColors[tournament.status] || '#94a3b8', flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 800, color: statusColors[tournament.status] || '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{tournament.status}</span>
          </div>
          {(tournament.team_size || 1) > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 20, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <i className="ri-team-line" style={{ color: '#818cf8', fontSize: 12 }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: '#818cf8' }}>{tournament.team_size}v{tournament.team_size} TEAM</span>
            </div>
          )}
          {tournament.entrance_fee > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 20, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <i className="ri-money-dollar-circle-line" style={{ color: '#f59e0b', fontSize: 12 }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: '#f59e0b' }}>{fmtTZS(tournament.entrance_fee)}</span>
            </div>
          )}
          {pendingPayments.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 20, background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.25)', cursor: 'pointer' }}
              onClick={() => setActiveTab('payments')}>
              <i className="ri-alarm-warning-fill" style={{ color: '#f87171', fontSize: 12 }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: '#f87171' }}>{pendingPayments.length} PENDING</span>
            </div>
          )}
        </div>

        {/* ── Tab bar ── */}
        <div style={{ display: 'flex', gap: 0, padding: '0 16px', marginBottom: 16, background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)', overflowX: 'auto' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 9, fontWeight: 900, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: activeTab === t.key ? '#a5b4fc' : 'rgba(255,255,255,0.25)',
              borderBottom: activeTab === t.key ? '2px solid #6366f1' : '2px solid transparent',
              flexShrink: 0, transition: 'all 0.15s',
            }}>
              <i className={t.icon} style={{ fontSize: 17, color: activeTab === t.key ? '#818cf8' : 'rgba(255,255,255,0.2)' }} />
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ padding: '0 16px' }}>

          {/* ════════════════════ OVERVIEW ════════════════════ */}
          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Bracket status card */}
              <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 14, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <i className="ri-node-tree" style={{ color: '#818cf8', fontSize: 16 }} />
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#a5b4fc' }}>Bracket</span>
                  {saving && <span style={{ fontSize: 10, color: '#6366f1', marginLeft: 'auto' }}><i className="ri-loader-4-line" /> Saving…</span>}
                </div>
                {bracketData?.teamSizeMismatch && (
                  <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: '#fbbf24' }}>
                    <i className="ri-error-warning-line" /> Match type changed to {bracketData.currentTeamSize}v{bracketData.currentTeamSize} — reset to apply.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#6366f1' }}>{bracketRounds}</div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: '0.08em' }}>ROUNDS</div>
                  </div>
                  <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#22c55e' }}>{bracketData?.bracketSize ?? 0}</div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: '0.08em' }}>SLOTS</div>
                  </div>
                  <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: bracketData?.isTeamBattle ? '#a78bfa' : '#94a3b8' }}>{bracketData?.isTeamBattle ? bracketData.teamSize+'v'+bracketData.teamSize : '1v1'}</div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: '0.08em' }}>FORMAT</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {!hasBracket
                    ? <button onClick={initBracket} disabled={realCount < 2} style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', background: realCount < 2 ? 'rgba(99,102,241,0.3)' : '#6366f1', color: '#fff', fontSize: 13, fontWeight: 800, cursor: realCount < 2 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <i className="ri-play-fill" /> Generate Bracket {realCount < 2 && <span style={{ fontSize: 10, opacity: 0.6 }}>(need 2+)</span>}
                      </button>
                    : <button onClick={resetBracket} style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid rgba(220,38,38,0.3)', background: 'rgba(220,38,38,0.08)', color: '#f87171', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <i className="ri-restart-line" /> Reset Bracket
                      </button>
                  }
                  <button onClick={() => router.push(`/tournaments/${tournament.slug || tournament.id}`)}
                    style={{ padding: '11px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <i className="ri-eye-line" /> View
                  </button>
                </div>
              </div>

              {/* Status control */}
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.25)', marginBottom: 10 }}>SET STATUS</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {['active','ongoing','upcoming','completed'].map(s => (
                    <button key={s} onClick={() => updateStatus(s)} style={{
                      padding: '7px 14px', borderRadius: 8, border: 'none', fontFamily: 'inherit',
                      fontWeight: 800, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize',
                      background: tournament.status === s ? (statusColors[s] || '#94a3b8') : 'rgba(255,255,255,0.05)',
                      color: tournament.status === s ? '#fff' : 'rgba(255,255,255,0.4)',
                    }}>{s}</button>
                  ))}
                </div>
              </div>

              {/* Sync count */}
              <button onClick={syncCount} style={{ width: '100%', padding: '11px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <i className="ri-refresh-line" /> Sync Player Count
              </button>

              {/* Top scores */}
              {leaderboard.length > 0 && (
                <div style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.12)', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', color: 'rgba(245,158,11,0.5)', marginBottom: 10 }}>TOP SCORES</div>
                  {leaderboard.slice(0, 5).map((e, i) => (
                    <div key={e.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: i < 4 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                      <span style={{ fontSize: 14, width: 24, textAlign: 'center' }}>{i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`}</span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.8)' }}>{e.profiles?.username || '—'}</span>
                      <span style={{ fontSize: 14, fontWeight: 900, color: '#f59e0b' }}>{e.points ?? 0} <span style={{ fontSize: 10, opacity: 0.5 }}>pts</span></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ════════════════════ PLAYERS ════════════════════ */}
          {activeTab === 'players' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {participants.length === 0
                ? <p style={{ color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: '40px 0', fontSize: 13 }}>No players yet</p>
                : participants.map(p => {
                    const bStatus = p.bracket_status
                    const dotColor = bStatus==='champion'?'#f59e0b':bStatus==='out'?'#dc2626':'#22c55e'
                    const payStatus = p.payment?.[0]?.status
                    return (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.4)', position: 'relative' }}>
                          {p.profiles?.avatar_url ? <img src={p.profiles.avatar_url} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }} /> : (p.profiles?.username||'?')[0].toUpperCase()}
                          <span style={{ position:'absolute',bottom:1,right:1,width:8,height:8,borderRadius:'50%',background:dotColor,border:'1.5px solid #0a0c14' }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.profiles?.username || 'Unknown'}</div>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Lv.{p.profiles?.level ?? 1} · {p.profiles?.tier || '—'}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                          {bStatus === 'champion' && <span style={{ fontSize: 14 }}>🏆</span>}
                          {bStatus === 'out' && <span style={{ fontSize: 9, fontWeight: 900, color: '#f87171', background: 'rgba(220,38,38,0.12)', padding: '2px 6px', borderRadius: 4 }}>OUT</span>}
                          {payStatus === 'payment_submitted' && (
                            <button onClick={() => approvePayment(p.user_id)} style={{ fontSize: 10, fontWeight: 800, color: '#fbbf24', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', padding: '3px 8px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}>APPROVE</button>
                          )}
                          {payStatus === 'approved' && <span style={{ fontSize: 9, fontWeight: 900, color: '#4ade80', background: 'rgba(34,197,94,0.1)', padding: '2px 6px', borderRadius: 4 }}>PAID</span>}
                          <button onClick={() => removeParticipant(p.user_id)} style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid rgba(220,38,38,0.2)', background: 'rgba(220,38,38,0.06)', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, cursor: 'pointer' }}>
                            <i className="ri-user-unfollow-line" />
                          </button>
                        </div>
                      </div>
                    )
                  })
              }
            </div>
          )}

          {/* ════════════════════ BRACKET ════════════════════ */}
          {activeTab === 'bracket' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {bracketData?.teamSizeMismatch && (
                <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 10 }}>
                  <i className="ri-error-warning-line" style={{ color: '#f59e0b', fontSize: 18, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#f59e0b', marginBottom: 3 }}>Match type changed to {bracketData.currentTeamSize}v{bracketData.currentTeamSize}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Reset and regenerate to apply the new format.</div>
                    <button onClick={resetBracket} style={{ marginTop: 8, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#f59e0b', color: '#000', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                      <i className="ri-restart-line" /> Reset Now
                    </button>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                {!hasBracket
                  ? <button onClick={initBracket} disabled={realCount < 2} style={{ flex: 1, padding: '13px', borderRadius: 12, border: 'none', background: realCount < 2 ? 'rgba(99,102,241,0.3)' : '#6366f1', color: '#fff', fontSize: 14, fontWeight: 800, cursor: realCount < 2 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <i className="ri-play-fill" style={{ fontSize: 18 }} /> Generate Bracket
                    </button>
                  : <button onClick={resetBracket} style={{ flex: 1, padding: '13px', borderRadius: 12, border: '1px solid rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.07)', color: '#f87171', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <i className="ri-restart-line" style={{ fontSize: 18 }} /> Reset Bracket
                    </button>
                }
                <button onClick={() => router.push(`/tournaments/${tournament.slug || tournament.id}`)}
                  style={{ padding: '13px 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="ri-external-link-line" />
                </button>
              </div>
              {/* Unplaced players */}
              {bracketData && (() => {
                const inBracket = new Set()
                bracketData.rounds[0]?.forEach(pair => pair.forEach(s => {
                  if (bracketData.isTeamBattle) (s?.members||[]).forEach(m => { if (m?.userId) inBracket.add(m.userId) })
                  else if (s?.userId) inBracket.add(s.userId)
                }))
                const unplaced = participants.filter(p => !inBracket.has(p.user_id))
                if (!unplaced.length) return null
                return (
                  <div style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.1)', borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ fontSize: 10, fontWeight: 900, color: 'rgba(245,158,11,0.5)', letterSpacing: '0.1em', marginBottom: 10 }}>UNPLACED — {unplaced.length} PLAYER{unplaced.length!==1?'S':''}</div>
                    {unplaced.map(p => (
                      <div key={p.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>
                          {p.profiles?.avatar_url ? <img src={p.profiles.avatar_url} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }} /> : (p.profiles?.username||'?')[0].toUpperCase()}
                        </div>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{p.profiles?.username||'Player'}</span>
                        <button onClick={async () => {
                          if (!await verifyCanManage()) return
                          const { data: freshT } = await supabase.from('tournaments').select('bracket_data').eq('id', id.current).single()
                          const freshBd = parseBracketData(freshT?.bracket_data) ?? bracketData
                          if (!freshBd) return
                          const { data: prof } = await supabase.from('profiles').select('username, avatar_url').eq('id', p.user_id).maybeSingle()
                          const mSlot = { userId: p.user_id, name: prof?.username||'Player', avatar: prof?.avatar_url||null, status: 'active' }
                          let placed = false, newRounds
                          if (freshBd.isTeamBattle) {
                            newRounds = freshBd.rounds.map((r, ri) => {
                              if (ri !== 0 || placed) return r
                              return r.map(pair => pair.map(team => {
                                if (placed || !team || team.status==='bye') return team
                                const mi = (team.members||[]).findIndex(m => !m?.userId || m.status==='open'||m.status==='empty'||m.status==='pending')
                                if (mi===-1) return team
                                placed = true
                                const nm = team.members.map((m,i) => i===mi?mSlot:m)
                                return { ...team, members: nm, status: nm.every(m=>m?.userId)?'active':'open' }
                              }))
                            })
                          } else {
                            let pick = null
                            freshBd.rounds[0]?.forEach((pair,pi) => pair.forEach((s,si) => { if (!pick && !s?.userId && (s?.status==='open'||s?.status==='bye')) pick={pi,si} }))
                            if (!pick) { showToast('No open slots.','error'); return }
                            newRounds = freshBd.rounds.map((r,ri) => ri!==0?r:r.map((pair,pi) => pi!==pick.pi?pair:pair.map((s,si)=>si===pick.si?mSlot:s)))
                            placed = true
                          }
                          if (!placed) { showToast('No open slots.','error'); return }
                          const nb = { ...freshBd, rounds: newRounds, isEmpty: false }
                          await saveBracket(nb); setBracketData(nb)
                          showToast(`${prof?.username||'Player'} added to bracket.`,'success')
                        }} style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.1)', color: '#818cf8', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}

          {/* ════════════════════ PAYMENTS ════════════════════ */}
          {activeTab === 'payments' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {participants.filter(p => p.payment?.[0]).length === 0
                ? <p style={{ color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: '40px 0', fontSize: 13 }}>No payment records</p>
                : participants.filter(p => p.payment?.[0]).map(p => {
                    const pay = p.payment[0]
                    return (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${pay.status==='approved'?'rgba(34,197,94,0.15)':pay.status==='payment_submitted'?'rgba(245,158,11,0.2)':'rgba(255,255,255,0.05)'}`, borderRadius: 12 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.4)' }}>
                          {p.profiles?.avatar_url ? <img src={p.profiles.avatar_url} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }} /> : (p.profiles?.username||'?')[0].toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{p.profiles?.username || 'Unknown'}</div>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{fmtTZS(tournament.entrance_fee)} entry fee</div>
                        </div>
                        {pay.status === 'approved'
                          ? <span style={{ fontSize: 10, fontWeight: 900, color: '#4ade80', background: 'rgba(34,197,94,0.1)', padding: '4px 10px', borderRadius: 6 }}>APPROVED</span>
                          : pay.status === 'payment_submitted'
                            ? <button onClick={() => approvePayment(p.user_id)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#f59e0b', color: '#000', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Approve</button>
                            : <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{pay.status}</span>
                        }
                      </div>
                    )
                  })
              }
            </div>
          )}

          {/* ════════════════════ DANGER ZONE ════════════════════ */}
          {activeTab === 'danger' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: 'rgba(220,38,38,0.05)', border: '1px solid rgba(220,38,38,0.15)', borderRadius: 14, padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <i className="ri-error-warning-fill" style={{ color: '#f87171', fontSize: 18 }} />
                  <span style={{ fontSize: 13, fontWeight: 900, color: '#f87171', letterSpacing: '0.05em' }}>DANGER ZONE</span>
                </div>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6, margin: '0 0 16px' }}>
                  Deleting this tournament permanently removes all bracket data, participants, payments, and leaderboard entries. This cannot be undone.
                </p>
                <button onClick={deleteTournament} style={{ width: '100%', padding: '13px', borderRadius: 12, border: '1px solid rgba(220,38,38,0.35)', background: 'rgba(220,38,38,0.1)', color: '#f87171', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <i className="ri-delete-bin-fill" style={{ fontSize: 18 }} /> Delete Tournament
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
