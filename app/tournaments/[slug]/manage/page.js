'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '../../../../components/AuthProvider'
import { supabase } from '../../../../lib/supabase'
import styles from './page.module.css'
import BracketBuilder from '../../../../components/BracketBuilder'
import { buildGroups, computeStandings, isGroupStageComplete, getQualifiers } from '../../../../lib/groupStage'

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
const STATUS_ICONS  = { active: 'ri-checkbox-circle-fill', ongoing: 'ri-live-fill', upcoming: 'ri-time-fill', completed: 'ri-trophy-fill' }

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

// Slimmed-down tabs — Edit & Danger moved to Settings, Payments folded into Players
const TABS = [
  { key: 'overview',  icon: 'ri-dashboard-fill',   label: 'Overview'  },
  { key: 'players',   icon: 'ri-group-fill',        label: 'Players'   },
  { key: 'bracket',   icon: 'ri-node-tree',         label: 'Bracket'   },
  { key: 'settings',  icon: 'ri-settings-3-fill',   label: 'Settings'  },
]

// ── Tutorial steps with visual previews ──────────────────────────────────────
const TUTORIAL_STEPS = [
  // ── 1. Welcome ──────────────────────────────────────────────────────────
  {
    icon: 'ri-gamepad-fill',
    color: '#6366f1',
    title: 'Welcome to Command Centre',
    desc: 'This is your full control panel for managing a tournament. You can set status, handle players, build the bracket, and edit settings — all from here.',
    preview: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#6366f112', borderRadius: 12, border: '1.5px solid #6366f130' }}>
          <i className="ri-shield-star-fill" style={{ color: '#6366f1', fontSize: 22 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 900, color: '#6366f1' }}>Admin · Command Centre</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Full control over this tournament</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5 }}>
          {[['ri-dashboard-fill','Overview','#6366f1'],['ri-group-fill','Players','#22c55e'],['ri-node-tree','Bracket','#a78bfa'],['ri-settings-3-fill','Settings','#f59e0b']].map(([ic,l,c])=>(
            <div key={l} style={{ padding: '8px 4px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <i className={ic} style={{ color: c, fontSize: 16 }} />
              <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-muted)' }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  // ── 2. Status ────────────────────────────────────────────────────────────
  {
    icon: 'ri-live-fill',
    color: '#6366f1',
    title: 'Setting Tournament Status',
    desc: 'The status banner is always at the top. Tap any of the 4 status cards to instantly update how the tournament appears to players.',
    preview: () => (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {[
          { s: 'Active',    col: '#22c55e', ic: 'ri-checkbox-circle-fill', sub: 'Open for registration', active: false },
          { s: 'Ongoing',   col: '#6366f1', ic: 'ri-live-fill',            sub: 'Tournament in progress', active: true  },
          { s: 'Upcoming',  col: '#f59e0b', ic: 'ri-time-fill',            sub: 'Not started yet',        active: false },
          { s: 'Completed', col: '#94a3b8', ic: 'ri-trophy-fill',          sub: 'Tournament ended',       active: false },
        ].map(({ s, col, ic, sub, active }) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 9px', borderRadius: 10, border: `1.5px solid ${active ? col : 'var(--border)'}`, background: active ? col + '15' : 'var(--surface)' }}>
            <i className={ic} style={{ color: active ? col : 'var(--text-muted)', fontSize: 15, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: active ? col : 'var(--text)' }}>{s}</div>
              <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>{sub}</div>
            </div>
          </div>
        ))}
      </div>
    ),
  },
  // ── 3. KPI strip ─────────────────────────────────────────────────────────
  {
    icon: 'ri-bar-chart-2-fill',
    color: '#22c55e',
    title: 'Stats at a Glance',
    desc: 'The 4 stat cards show Players registered, Available open slots, how many Bracket rounds exist, and how many players are Scored on the leaderboard.',
    preview: () => (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5 }}>
        {[['16','Players','/ 16','#22c55e','ri-group-fill'],['0','Avail.','open','#f59e0b','ri-door-open-line'],['4','Rounds','live','#6366f1','ri-node-tree'],['8','Scored','ranked','#f59e0b','ri-bar-chart-fill']].map(([v,l,sub,c,ic])=>(
          <div key={l} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <i className={ic} style={{ color: c, fontSize: 13 }} />
            <div style={{ fontSize: 15, fontWeight: 900, color: c }}>{v}</div>
            <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase' }}>{l}</div>
            <div style={{ fontSize: 7, color: 'var(--text-muted)' }}>{sub}</div>
          </div>
        ))}
      </div>
    ),
  },
  // ── 4. Overview tab ──────────────────────────────────────────────────────
  {
    icon: 'ri-dashboard-fill',
    color: '#6366f1',
    title: 'Overview Tab',
    desc: 'The Overview shows your bracket summary, quick Generate/Reset buttons, and a mini leaderboard of the top 5 scores. No need to dig into other tabs for a quick check.',
    preview: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <i className="ri-node-tree" style={{ color: '#6366f1', fontSize: 14 }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>Bracket</span>
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            {[['4','Rounds','#6366f1'],['16','Slots','#22c55e'],['1v1','Format','var(--text-muted)']].map(([v,l,c])=>(
              <div key={l} style={{ flex: 1, textAlign: 'center', padding: '6px 0', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: c }}>{v}</div>
                <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: '10px 12px' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Top Scores</div>
          {[['🥇','NasGaming','320'],['🥈','AlphaX','280'],['🥉','ZeroK','240']].map(([badge,name,pts])=>(
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12 }}>{badge}</span>
              <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{name}</span>
              <span style={{ fontSize: 11, fontWeight: 900, color: '#f59e0b' }}>{pts} pts</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  // ── 5. Players tab ───────────────────────────────────────────────────────
  {
    icon: 'ri-group-fill',
    color: '#22c55e',
    title: 'Players Tab',
    desc: 'Every registered player appears here. You can see their level, bracket status (In / Out / Champion), and remove them if needed.',
    preview: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {[
          { init: 'NG', name: 'NasGaming', lv: 'Lv.24', badge: '🏆', bc: null, dot: '#f59e0b' },
          { init: 'AX', name: 'AlphaX',   lv: 'Lv.18', badge: null, bc: null, dot: '#22c55e' },
          { init: 'ZK', name: 'ZeroK',    lv: 'Lv.12', badge: 'OUT', bc: '#dc2626', dot: '#dc2626' },
        ].map(p => (
          <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: '#6366f120', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, color: '#6366f1' }}>{p.init}</div>
              <div style={{ position: 'absolute', bottom: 0, right: 0, width: 8, height: 8, borderRadius: '50%', background: p.dot, border: '1.5px solid var(--surface)' }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{p.name}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{p.lv}</div>
            </div>
            {p.badge && !p.bc && <span style={{ fontSize: 14 }}>{p.badge}</span>}
            {p.badge && p.bc && <span style={{ fontSize: 9, fontWeight: 900, padding: '2px 6px', borderRadius: 4, background: p.bc + '20', color: p.bc }}>{p.badge}</span>}
            <div style={{ width: 24, height: 24, borderRadius: 7, border: '1px solid #dc262630', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#dc2626' }}><i className="ri-user-unfollow-line" /></div>
          </div>
        ))}
      </div>
    ),
  },
  // ── 6. Entry fee payments ────────────────────────────────────────────────
  {
    icon: 'ri-money-dollar-circle-fill',
    color: '#f59e0b',
    title: 'Approving Payments',
    desc: 'If your tournament has an entry fee, players submit payment screenshots. A yellow warning appears on the Players tab when payments need your approval — tap Approve on each player.',
    preview: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 10, background: '#f59e0b10', border: '1.5px solid #f59e0b30' }}>
          <i className="ri-alarm-warning-fill" style={{ color: '#f59e0b', fontSize: 16 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b' }}>2 payments awaiting approval</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Tap Approve on each player below</div>
          </div>
        </div>
        {[['JK','JohnK','PENDING'],['MN','Nashe','PENDING']].map(([init,name,status])=>(
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: '#6366f120', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, color: '#6366f1', flexShrink: 0 }}>{init}</div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{name}</div></div>
            <span style={{ fontSize: 8, fontWeight: 900, padding: '2px 6px', borderRadius: 4, background: '#f59e0b20', color: '#f59e0b' }}>{status}</span>
            <div style={{ padding: '4px 9px', borderRadius: 6, background: '#22c55e', fontSize: 9, fontWeight: 800, color: '#fff' }}>Approve</div>
          </div>
        ))}
      </div>
    ),
  },
  // ── 7. Generate bracket ──────────────────────────────────────────────────
  {
    icon: 'ri-node-tree',
    color: '#a78bfa',
    title: 'Generating the Bracket',
    desc: 'Go to the Bracket tab and tap "Generate from Players". It randomly seeds all registered players into a single-elimination bracket. You need at least 2 players.',
    preview: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ padding: '11px', borderRadius: 11, background: '#a78bfa', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 13, fontWeight: 800, color: '#fff' }}>
          <i className="ri-play-fill" /> Generate from Players
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-around' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {['PlayerA','PlayerB','PlayerC','PlayerD'].map(n=>(
              <div key={n} style={{ padding: '4px 9px', background: '#22c55e12', border: '1px solid #22c55e30', borderRadius: 6, fontSize: 9, fontWeight: 700, color: '#22c55e' }}>{n}</div>
            ))}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 18 }}>›</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {['?','?'].map((n,i)=>(
              <div key={i} style={{ padding: '4px 9px', background: '#a78bfa12', border: '1px solid #a78bfa30', borderRadius: 6, fontSize: 9, fontWeight: 700, color: '#a78bfa' }}>{n}</div>
            ))}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 18 }}>›</div>
          <div style={{ padding: '4px 9px', background: '#f59e0b12', border: '1px solid #f59e0b30', borderRadius: 6, fontSize: 9, fontWeight: 700, color: '#f59e0b' }}>🏆 TBD</div>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>Players are randomly seeded into slots</div>
      </div>
    ),
  },
  // ── 8. Bracket editor ────────────────────────────────────────────────────
  {
    icon: 'ri-edit-box-fill',
    color: '#a78bfa',
    title: 'Editing the Bracket',
    desc: 'After generating, you can drag players to swap slots, and tap the bracket in the public view to mark winners and advance them. The editor updates live.',
    preview: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <i className="ri-node-tree" style={{ color: '#a78bfa', fontSize: 14 }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>Bracket Editor</span>
            <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-muted)' }}>Drag to swap</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '4px 0' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[['NasG','active','#22c55e'],['AlphaX','active','#22c55e']].map(([n,s,c])=>(
                <div key={n} style={{ padding: '5px 8px', background: c+'12', border: `1.5px solid ${c}40`, borderRadius: 7, fontSize: 9, fontWeight: 800, color: c, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <i className="ri-draggable" style={{ opacity: 0.5, fontSize: 10 }} /> {n}
                </div>
              ))}
            </div>
            <div style={{ width: 16, height: 40, borderTop: '2px solid var(--border)', borderRight: '2px solid var(--border)', borderBottom: '2px solid var(--border)', marginRight: 4 }} />
            <div style={{ padding: '5px 8px', background: '#a78bfa12', border: '1.5px solid #a78bfa40', borderRadius: 7, fontSize: 9, fontWeight: 800, color: '#a78bfa' }}>?</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 9, background: '#6366f108', border: '1px solid #6366f120' }}>
          <i className="ri-information-line" style={{ color: '#6366f1', fontSize: 13 }} />
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Unplaced players appear below the bracket for easy adding</div>
        </div>
      </div>
    ),
  },
  // ── 9. Reset bracket ─────────────────────────────────────────────────────
  {
    icon: 'ri-restart-line',
    color: '#ef4444',
    title: 'Resetting the Bracket',
    desc: 'Use Reset Bracket to clear all placements and start fresh — useful when match type changes (e.g. switching from 1v1 to 2v2). This also clears the leaderboard scores.',
    preview: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ padding: '10px 12px', borderRadius: 11, background: '#ef444412', border: '1.5px solid #ef444430', display: 'flex', alignItems: 'center', gap: 9 }}>
          <i className="ri-error-warning-fill" style={{ color: '#ef4444', fontSize: 20 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#ef4444' }}>Reset Bracket?</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Clears all placements and scores</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          <div style={{ flex: 1, padding: '9px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Cancel</div>
          <div style={{ flex: 1, padding: '9px', borderRadius: 10, background: '#ef4444', textAlign: 'center', fontSize: 12, fontWeight: 800, color: '#fff' }}>Confirm Reset</div>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>A confirm dialog always appears before resetting</div>
      </div>
    ),
  },
  // ── 10. Match types ──────────────────────────────────────────────────────
  {
    icon: 'ri-team-fill',
    color: '#a78bfa',
    title: 'Match Types (1v1 to 8v8)',
    desc: 'You can run Solo (1v1), Duo (2v2), Squad (4v4), or full team (8v8) tournaments. Change the match type in Settings → Edit Details → Match Type, then reset and regenerate the bracket.',
    preview: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ display: 'flex', gap: 7 }}>
          {[['1v1','Solo',true],['2v2','Team',false],['4v4','Team',false],['8v8','Team',false]].map(([l,s,active])=>(
            <div key={l} style={{ flex: 1, padding: '8px 4px', borderRadius: 10, border: `1.5px solid ${active ? '#a78bfa' : 'var(--border)'}`, background: active ? '#a78bfa' : 'var(--surface)', textAlign: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: active ? '#fff' : 'var(--text)' }}>{l}</div>
              <div style={{ fontSize: 8, color: active ? '#ffffff99' : 'var(--text-muted)' }}>{s}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: '8px 10px', borderRadius: 9, background: '#f59e0b10', border: '1px solid #f59e0b30', display: 'flex', alignItems: 'center', gap: 7 }}>
          <i className="ri-information-line" style={{ color: '#f59e0b', fontSize: 14 }} />
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Changing match type requires a bracket reset to take effect</div>
        </div>
      </div>
    ),
  },
  // ── 11. Settings — Edit Details ──────────────────────────────────────────
  {
    icon: 'ri-settings-3-fill',
    color: '#f59e0b',
    title: 'Settings → Edit Details',
    desc: 'Edit the tournament name, description, game, format, date, prize pool, entry fee, slots, and match type. Hit Save after any changes.',
    preview: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          ['Tournament Name', 'STRONG HAND ✋'],
          ['Game', 'eFootball'],
          ['Prize Pool (TZS)', '500,000'],
          ['Entry Fee (TZS)', '2,000'],
          ['Slots', '16'],
        ].map(([label, val]) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
            <div style={{ padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>{val}</div>
          </div>
        ))}
        <div style={{ marginTop: 2, padding: '9px', borderRadius: 10, background: '#f59e0b', textAlign: 'center', fontSize: 12, fontWeight: 800, color: '#000' }}>
          <i className="ri-save-line" /> Save Changes
        </div>
      </div>
    ),
  },
  // ── 12. Pro & Elite toggle ───────────────────────────────────────────────
  {
    icon: 'ri-vip-crown-fill',
    color: '#a855f7',
    title: 'Pro & Elite Only Mode',
    desc: 'Toggle this in Settings to restrict the tournament to Pro and Elite tier members only. Regular players won\'t be able to join or see the register button.',
    preview: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[false, true].map(on => (
          <div key={String(on)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 13px', borderRadius: 12, border: `1.5px solid ${on ? '#a855f740' : 'var(--border)'}`, background: on ? '#a855f710' : 'var(--surface)' }}>
            <i className={on ? 'ri-vip-crown-fill' : 'ri-vip-crown-line'} style={{ color: on ? '#a855f7' : 'var(--text-muted)', fontSize: 20 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: on ? '#a855f7' : 'var(--text)' }}>Pro & Elite Only</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{on ? 'Only Pro & Elite members can join.' : 'Open to all players.'}</div>
            </div>
            <div style={{ width: 36, height: 20, borderRadius: 10, background: on ? '#a855f7' : 'var(--border)', position: 'relative', flexShrink: 0 }}>
              <div style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff' }} />
            </div>
          </div>
        ))}
      </div>
    ),
  },
  // ── 13. Transfer players ─────────────────────────────────────────────────
  {
    icon: 'ri-swap-line',
    color: '#6366f1',
    title: 'Transferring Players',
    desc: 'In Settings → Advanced, you can move all registered players to a different tournament at once. Useful when merging tournaments or rescheduling. Players get notified automatically.',
    preview: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ padding: '9px 12px', borderRadius: 10, background: '#6366f108', border: '1.5px solid #6366f130' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#6366f1', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}><i className="ri-swap-line" /> Transfer Players</div>
          {['NABO CUP S2','STRONG HAND 2'].map((name,i)=>(
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', marginTop: 4, borderRadius: 9, border: `1.5px solid ${i===0 ? '#6366f1' : 'var(--border)'}`, background: i===0 ? '#6366f112' : 'var(--surface)' }}>
              <i className="ri-tournament-line" style={{ color: i===0 ? '#6366f1' : 'var(--text-muted)', fontSize: 14 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{name}</div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>8/32 players · active</div>
              </div>
              {i===0 && <i className="ri-checkbox-circle-fill" style={{ color: '#6366f1', fontSize: 16 }} />}
            </div>
          ))}
        </div>
        <div style={{ padding: '9px', borderRadius: 10, background: '#6366f1', textAlign: 'center', fontSize: 12, fontWeight: 800, color: '#fff' }}>
          <i className="ri-swap-line" /> Transfer 16 Players
        </div>
      </div>
    ),
  },
  // ── 14. Delete ───────────────────────────────────────────────────────────
  {
    icon: 'ri-delete-bin-fill',
    color: '#ef4444',
    title: 'Deleting a Tournament',
    desc: 'In Settings → Advanced → Danger Zone. Deleting permanently removes all players, bracket, payments, and scores. A confirmation dialog appears first — this cannot be undone.',
    preview: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ padding: '12px 13px', borderRadius: 12, background: '#ef444410', border: '1.5px solid #ef444430' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <i className="ri-error-warning-fill" style={{ color: '#ef4444', fontSize: 18 }} />
            <span style={{ fontSize: 13, fontWeight: 800, color: '#ef4444' }}>Danger Zone</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
            Permanently removes all bracket data, participants, payments, and scores. Cannot be undone.
          </div>
          <div style={{ padding: '9px', borderRadius: 10, background: '#ef4444', textAlign: 'center', fontSize: 12, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <i className="ri-delete-bin-fill" /> Delete Tournament
          </div>
        </div>
      </div>
    ),
  },
  // ── 15. Sync + notifications ─────────────────────────────────────────────
  {
    icon: 'ri-refresh-line',
    color: '#22c55e',
    title: 'Sync & Notifications',
    desc: 'Use "Sync Player Count" in Overview to fix the registered count if it looks off. Players are auto-notified when the bracket is generated or they are transferred to another tournament.',
    preview: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ padding: '10px 12px', borderRadius: 11, border: '1.5px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 9 }}>
          <i className="ri-refresh-line" style={{ color: '#22c55e', fontSize: 18 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>Sync Player Count</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Fixes mismatched registered_count</div>
          </div>
          <div style={{ padding: '5px 10px', borderRadius: 8, background: '#22c55e', fontSize: 11, fontWeight: 800, color: '#fff' }}>Sync</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[
            { ic: 'ri-node-tree', col: '#a78bfa', title: 'Bracket generated', sub: 'All players notified with their slot' },
            { ic: 'ri-swap-line', col: '#6366f1', title: 'Transfer complete', sub: 'Players notified of new tournament' },
          ].map(n => (
            <div key={n.title} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, background: n.col+'10', border: `1px solid ${n.col}25` }}>
              <i className={n.ic} style={{ color: n.col, fontSize: 15 }} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{n.title}</div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{n.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
]

// ── Tutorial overlay ──────────────────────────────────────────────────────────
function TutorialOverlay({ onClose }) {
  const [step, setStep] = useState(0)
  const current = TUTORIAL_STEPS[step]
  const isLast = step === TUTORIAL_STEPS.length - 1
  const Preview = current.preview

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.78)',
      display: 'flex', alignItems: 'flex-end',
      padding: '0 0 24px',
    }} onClick={onClose}>
      <div style={{ width: '100%', padding: '0 16px' }} onClick={e => e.stopPropagation()}>
        <div style={{
          background: 'var(--surface)', borderRadius: 24,
          padding: '20px 18px 18px', position: 'relative',
          border: '1px solid var(--border)',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.25)',
        }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: current.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: current.color, flexShrink: 0 }}>
              <i className={current.icon} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Step {step + 1} of {TUTORIAL_STEPS.length}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{current.title}</div>
            </div>
            <button onClick={onClose} style={{
              width: 28, height: 28, borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--bg)',
              color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15, cursor: 'pointer', flexShrink: 0,
            }}>
              <i className="ri-close-line" />
            </button>
          </div>

          {/* Progress bar */}
          <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
            {TUTORIAL_STEPS.map((s, i) => (
              <div key={i} onClick={() => setStep(i)} style={{
                height: 3, borderRadius: 3, flex: 1, cursor: 'pointer',
                background: i <= step ? s.color : 'var(--border)',
                transition: 'background 0.25s',
              }} />
            ))}
          </div>

          {/* Visual preview */}
          <div style={{
            background: 'var(--bg)', borderRadius: 14,
            border: '1px solid var(--border)',
            padding: '12px', marginBottom: 12,
            minHeight: 120,
          }}>
            <Preview />
          </div>

          {/* Description */}
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 16 }}>
            {current.desc}
          </div>

          {/* Navigation */}
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)} style={{
                flex: 1, padding: '11px', borderRadius: 12,
                border: '1.5px solid var(--border)', background: 'var(--bg)',
                color: 'var(--text-muted)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                ← Back
              </button>
            )}
            <button onClick={isLast ? onClose : () => setStep(s => s + 1)} style={{
              flex: 2, padding: '11px', borderRadius: 12,
              border: 'none', background: current.color,
              color: isLast ? '#000' : '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {isLast ? 'Got it 🎮' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

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
  const [groupScoreDraft, setGroupScoreDraft] = useState({}) // { [fixtureId]: { home, away } }
  const [groupSavingId,   setGroupSavingId]   = useState(null)
  const [showTutorial, setShowTutorial] = useState(false)
  // ── Edit form state ───────────────────────────────────────────────────────
  const [editForm,     setEditForm]     = useState(null)
  const [editSaving,   setEditSaving]   = useState(false)
  const [editSaved,    setEditSaved]    = useState(false)
  const [editError,    setEditError]    = useState('')
  const [toast,        setToast]        = useState(null)
  // ── Transfer state ────────────────────────────────────────────────────────
  const [showTransfer,     setShowTransfer]     = useState(false)
  const [transferTargets,  setTransferTargets]  = useState([])
  const [transferTarget,   setTransferTarget]   = useState(null)
  const [transferLoading,  setTransferLoading]  = useState(false)
  const [transferDone,     setTransferDone]     = useState(false)
  // ── Settings accordion ────────────────────────────────────────────────────
  const [settingsSection,  setSettingsSection]  = useState('edit') // 'edit' | 'danger'
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
      const updatePayload = {
        bracket_data: bd,
        round_names: bd?.round_names ?? null,
        ...(bd?.slot_count > 0 ? { slots: bd.slot_count } : {}),
      }
      const { error } = await supabase.from('tournaments').update(updatePayload).eq('id', id.current)
      if (error) showToast('Failed to save bracket.', 'error')
      else {
        showToast('Bracket saved!')
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

  // ── Group stage actions ─────────────────────────────────────────────────────
  async function initGroups() {
    if (!await verifyCanManage()) return
    if (realCount < 2) { showToast('Need at least 2 players.', 'error'); return }
    const teamSize = tournament?.team_size || 1
    const groupCount = tournament?.group_count || 4
    const groups = buildGroups(participants, groupCount, teamSize)
    const bd = { stage: 'groups', groups, advancePerGroup: tournament?.advance_per_group || 2 }
    const { error } = await supabase.from('tournaments').update({ bracket_data: bd }).eq('id', id.current)
    if (error) { showToast('Failed to generate groups.', 'error'); return }
    setBracketData(bd)
    showToast('Groups generated!', 'success')
    const notifs = participants.filter(p => p.user_id).map(p => ({
      user_id: p.user_id, title: `Groups drawn — ${tournament.name}`,
      body: 'The group stage is set. Check your group and fixtures!',
      type: 'tournament', meta: { tournament_id: id.current }, read: false,
    }))
    if (notifs.length) await supabase.from('notifications').insert(notifs)
    load()
  }

  async function resetGroups() {
    if (!await verifyCanManage()) return
    setConfirm({
      message: 'Reset the group draw? All group fixtures and scores will be cleared.',
      onConfirm: async () => {
        setConfirm(null)
        await supabase.from('tournament_leaderboard').delete().eq('tournament_id', id.current)
        await supabase.from('tournaments').update({ bracket_data: null }).eq('id', id.current)
        setBracketData(null)
        showToast('Groups reset.', 'success')
        load()
      },
    })
  }

  async function advanceToKnockout() {
    if (!await verifyCanManage()) return
    const { data: freshT } = await supabase.from('tournaments').select('bracket_data').eq('id', id.current).single()
    const freshBd = parseBracketData(freshT?.bracket_data) ?? bracketData
    if (!freshBd?.groups) { showToast('No group data found.', 'error'); return }
    if (!isGroupStageComplete(freshBd.groups)) { showToast('All group fixtures must be played first.', 'error'); return }

    const teamSize = tournament?.team_size || 1
    const advancePerGroup = freshBd.advancePerGroup || tournament?.advance_per_group || 2
    const qualifiers = getQualifiers(freshBd.groups, advancePerGroup)
    if (qualifiers.length < 2) { showToast('Not enough qualifiers to build a bracket.', 'error'); return }

    const knockout = buildBracket(qualifiers, teamSize)
    const merged = { ...freshBd, stage: 'knockout', ...knockout }
    const { error } = await supabase.from('tournaments').update({ bracket_data: merged }).eq('id', id.current)
    if (error) { showToast('Failed to build knockout bracket.', 'error'); return }
    setBracketData(merged)
    showToast('Knockout bracket generated!', 'success')
    const notifs = participants.filter(p => p.user_id).map(p => ({
      user_id: p.user_id, title: `Knockout stage begins — ${tournament.name}`,
      body: 'Groups are done — check the bracket to see if you advanced!',
      type: 'tournament', meta: { tournament_id: id.current }, read: false,
    }))
    if (notifs.length) await supabase.from('notifications').insert(notifs)
    load()
  }

  async function saveFixtureScore(groupId, fixtureId) {
    const draft = groupScoreDraft[fixtureId]
    if (!draft || draft.home === '' || draft.away === '') return
    setGroupSavingId(fixtureId)
    const { data: freshT } = await supabase.from('tournaments').select('bracket_data').eq('id', id.current).single()
    const freshBd = parseBracketData(freshT?.bracket_data) ?? bracketData
    const newGroups = freshBd.groups.map(g => {
      if (g.id !== groupId) return g
      return {
        ...g,
        fixtures: g.fixtures.map(fx => fx.id !== fixtureId ? fx : {
          ...fx, scoreHome: Number(draft.home), scoreAway: Number(draft.away), status: 'played',
        }),
      }
    })
    const newBd = { ...freshBd, groups: newGroups }
    await supabase.from('tournaments').update({ bracket_data: newBd }).eq('id', id.current)
    setBracketData(newBd)
    setGroupSavingId(null)
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
      const { data: existing } = await supabase.from('tournament_participants').select('user_id').eq('tournament_id', transferTarget)
      const existingIds = new Set((existing || []).map(e => e.user_id))
      const toInsert = participants.filter(p => !existingIds.has(p.user_id)).map(p => ({ tournament_id: transferTarget, user_id: p.user_id }))
      if (toInsert.length > 0) {
        await supabase.from('tournament_participants').insert(toInsert)
        const newCount = (existing?.length || 0) + toInsert.length
        await supabase.from('tournaments').update({ registered_count: newCount }).eq('id', transferTarget)
      }
      const targetT = transferTargets.find(t => t.id === transferTarget)
      const notifs = participants.map(p => ({
        user_id: p.user_id, title: 'You have been transferred',
        body: `You've been moved to "${targetT?.name || 'a new tournament'}". Check it out!`,
        type: 'tournament', meta: { tournament_id: transferTarget }, read: false,
      }))
      for (let i = 0; i < notifs.length; i += 100) await supabase.from('notifications').insert(notifs.slice(i, i + 100))
      setTransferDone(true)
      showToast(`${toInsert.length} player${toInsert.length !== 1 ? 's' : ''} transferred successfully!`)
    } catch (err) { showToast('Transfer failed: ' + err.message, 'error') }
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
  if (loading) return <div className={styles.loadWrap}><div className="loader" /></div>
  if (!tournament) return <div className={styles.loadWrap}><p style={{ color: 'var(--text-muted)' }}>Tournament not found.</p></div>

  // ── Derived ───────────────────────────────────────────────────────────────
  const realCount       = participants.length
  const openSlots       = Math.max(0, (tournament.slots || 0) - realCount)
  const bracketRounds   = bracketData?.rounds?.length ?? 0
  const hasBracket      = bracketData && !bracketData.isEmpty
  const pendingPayments = participants.filter(p => p.payment_status === 'payment_submitted')

  const inBracketSet = new Set()
  bracketData?.rounds[0]?.forEach(pair => pair.forEach(s => {
    if (bracketData.isTeamBattle) (s?.members || []).forEach(m => { if (m?.userId) inBracketSet.add(m.userId) })
    else if (s?.userId) inBracketSet.add(s.userId)
  }))
  const unplaced = participants.filter(p => !inBracketSet.has(p.user_id))

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>

      {/* ── Tutorial overlay ── */}
      {showTutorial && <TutorialOverlay onClose={() => setShowTutorial(false)} />}

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
        {/* Tutorial help button */}
        <button className={styles.headerIconBtn} onClick={() => setShowTutorial(true)} title="How this works">
          <i className="ri-question-line" />
        </button>
        <button className={styles.headerIconBtn}
          onClick={() => router.push(`/tournaments/${tournament.slug || tournament.id}`)}>
          <i className="ri-eye-line" />
        </button>
      </div>

      {/* ── Status banner ── */}
      <div style={{ padding: '12px 16px 0' }}>
        <div style={{
          background: 'var(--surface)', borderRadius: 16,
          border: `1.5px solid ${STATUS_COLORS[tournament.status]}33`,
          padding: '14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: STATUS_COLORS[tournament.status] + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: STATUS_COLORS[tournament.status], flexShrink: 0 }}>
              <i className={STATUS_ICONS[tournament.status]} />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current Status</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: STATUS_COLORS[tournament.status], textTransform: 'capitalize' }}>{tournament.status}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            {[
              { s: 'active',    icon: 'ri-checkbox-circle-fill', label: 'Active',    sub: 'Open for registration' },
              { s: 'ongoing',   icon: 'ri-live-fill',            label: 'Ongoing',   sub: 'Tournament in progress' },
              { s: 'upcoming',  icon: 'ri-time-fill',            label: 'Upcoming',  sub: 'Not started yet' },
              { s: 'completed', icon: 'ri-trophy-fill',          label: 'Completed', sub: 'Tournament ended' },
            ].map(({ s, icon, label, sub }) => {
              const isActive = tournament.status === s
              const col = STATUS_COLORS[s]
              return (
                <button key={s} onClick={() => updateStatus(s)} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '9px 10px', borderRadius: 11, cursor: 'pointer',
                  border: `1.5px solid ${isActive ? col : 'var(--border)'}`,
                  background: isActive ? col + '18' : 'var(--bg)',
                  textAlign: 'left', width: '100%', fontFamily: 'inherit',
                }}>
                  <i className={icon} style={{ color: isActive ? col : 'var(--text-muted)', fontSize: 16, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: isActive ? col : 'var(--text)' }}>{label}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className={styles.kpis}>
        {[
          { val: realCount, sub: `/ ${tournament.slots}`, label: 'Players', color: '#22c55e', icon: 'ri-group-fill' },
          { val: openSlots, sub: 'open slots', label: 'Available', color: openSlots > 0 ? '#f59e0b' : 'var(--text-muted)', icon: 'ri-door-open-line' },
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

      {/* ── Chip row (contextual info only) ── */}
      {((tournament.team_size || 1) > 1 || tournament.entrance_fee > 0 || pendingPayments.length > 0) && (
        <div className={styles.chipsRow}>
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
            <div className={`${styles.chip} ${styles.chipDanger}`} onClick={() => setActiveTab('players')}>
              <i className="ri-alarm-warning-fill" /> {pendingPayments.length} payment{pendingPayments.length !== 1 ? 's' : ''} pending
            </div>
          )}
        </div>
      )}

      {/* ── Tab bar (4 tabs now) ── */}
      <div className={styles.tabs}>
        {TABS.map(t => (
          <button key={t.key}
            className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(t.key)}>
            <i className={t.icon} />
            {t.label}
            {/* Badge for pending payments on Players tab */}
            {t.key === 'players' && pendingPayments.length > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 16, height: 16, borderRadius: '50%',
                background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 900,
                marginLeft: 2,
              }}>{pendingPayments.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className={styles.body}>

        {/* ════ OVERVIEW ════ */}
        {activeTab === 'overview' && <>

          {/* Group Stage card — only for groups_knockout tournaments, before knockout kicks in */}
          {tournament?.stage_format === 'groups_knockout' && bracketData?.stage !== 'knockout' && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <i className="ri-layout-grid-line" style={{ color: '#f59e0b', fontSize: 16 }} />
                <span className={styles.cardTitle}>Group Stage</span>
                {saving && <span className={styles.cardSaving}><i className="ri-loader-4-line" /> Saving…</span>}
              </div>
              {bracketData?.groups ? (
                <>
                  <div className={styles.statRow}>
                    {[
                      { val: bracketData.groups.length, label: 'Groups', color: '#f59e0b' },
                      { val: bracketData.groups.reduce((n, g) => n + g.fixtures.filter(f => f.status === 'played').length, 0) + '/' + bracketData.groups.reduce((n, g) => n + g.fixtures.length, 0), label: 'Played', color: '#6366f1' },
                      { val: bracketData.advancePerGroup ?? tournament?.advance_per_group ?? 2, label: 'Advance ea.', color: '#22c55e' },
                    ].map(s => (
                      <div key={s.label} className={styles.statBox}>
                        <span className={styles.statBoxVal} style={{ color: s.color }}>{s.val}</span>
                        <span className={styles.statBoxLabel}>{s.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className={styles.btnRow}>
                    <button
                      className={styles.btnPrimary}
                      onClick={advanceToKnockout}
                      disabled={!isGroupStageComplete(bracketData.groups)}
                      title={!isGroupStageComplete(bracketData.groups) ? 'All fixtures must be played first' : ''}
                    >
                      <i className="ri-play-fill" /> Advance to Knockout
                    </button>
                    <button className={styles.btnDanger} onClick={resetGroups}>
                      <i className="ri-restart-line" /> Reset Groups
                    </button>
                  </div>

                  {/* Per-group standings + fixture score entry */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
                    {bracketData.groups.map(group => {
                      const standings = computeStandings(group)
                      return (
                        <div key={group.id} style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                          <div style={{ padding: '9px 12px', background: 'var(--bg-2)', fontSize: 12, fontWeight: 800 }}>{group.name}</div>

                          {/* Standings */}
                          <div style={{ padding: '8px 12px' }}>
                            {standings.map(row => (
                              <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 11.5 }}>
                                <span style={{ width: 16, color: 'var(--text-muted)', fontWeight: 700 }}>{row.position}</span>
                                <span style={{ flex: 1, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                                <span style={{ color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{row.played}p</span>
                                <span style={{ fontWeight: 800, fontFamily: 'ui-monospace, monospace', color: 'var(--accent)' }}>{row.points}pts</span>
                              </div>
                            ))}
                          </div>

                          {/* Fixtures */}
                          <div style={{ borderTop: '1px solid var(--border)' }}>
                            {group.fixtures.map(fx => {
                              const home = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.homeId)
                              const away = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.awayId)
                              const draft = groupScoreDraft[fx.id] ?? { home: fx.scoreHome ?? '', away: fx.scoreAway ?? '' }
                              return (
                                <div key={fx.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderBottom: '1px solid var(--border)', fontSize: 11.5 }}>
                                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: fx.status === 'played' ? 400 : 700 }}>{home?.name || '?'}</span>
                                  <input type="number" value={draft.home} placeholder="-" style={{ width: 34, textAlign: 'center', padding: '4px 2px', borderRadius: 6, border: '1px solid var(--border-dark)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12 }}
                                    onChange={e => setGroupScoreDraft(d => ({ ...d, [fx.id]: { ...draft, home: e.target.value } }))} />
                                  <span style={{ color: 'var(--text-muted)' }}>–</span>
                                  <input type="number" value={draft.away} placeholder="-" style={{ width: 34, textAlign: 'center', padding: '4px 2px', borderRadius: 6, border: '1px solid var(--border-dark)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12 }}
                                    onChange={e => setGroupScoreDraft(d => ({ ...d, [fx.id]: { ...draft, away: e.target.value } }))} />
                                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: fx.status === 'played' ? 400 : 700 }}>{away?.name || '?'}</span>
                                  <button
                                    onClick={() => saveFixtureScore(group.id, fx.id)}
                                    disabled={groupSavingId === fx.id}
                                    style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: fx.status === 'played' ? 'var(--bg-2)' : 'var(--accent)', color: fx.status === 'played' ? 'var(--text-muted)' : '#fff', flexShrink: 0, cursor: 'pointer' }}
                                  >
                                    <i className={groupSavingId === fx.id ? 'ri-loader-4-line' : 'ri-check-line'} />
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className={styles.btnRow}>
                  <button className={styles.btnPrimary} onClick={initGroups} disabled={realCount < 2}>
                    <i className="ri-play-fill" /> Generate Groups
                    {realCount < 2 && <span style={{ fontSize: 10, opacity: 0.6 }}> (2+ needed)</span>}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Quick-action bracket card */}
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
              <button className={styles.btnGhost} onClick={() => setActiveTab('bracket')}>
                <i className="ri-edit-line" /> Edit
              </button>
              <button className={styles.btnGhost} onClick={() => router.push(`/tournaments/${tournament.slug || tournament.id}`)}>
                <i className="ri-eye-line" />
              </button>
            </div>
          </div>

          {/* Sync count */}
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
          {/* Pending payments callout */}
          {pendingPayments.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', borderRadius: 12,
              background: '#f59e0b12', border: '1.5px solid #f59e0b33', marginBottom: 4,
            }}>
              <i className="ri-alarm-warning-fill" style={{ color: '#f59e0b', fontSize: 18 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b' }}>{pendingPayments.length} payment{pendingPayments.length !== 1 ? 's' : ''} awaiting approval</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Tap Approve on each player below</div>
              </div>
            </div>
          )}

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
                      <span className={styles.playerMeta}>Lv.{p.profiles?.level ?? 1}
                        {payStatus && (
                          <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 800,
                            background: payStatus === 'approved' ? '#22c55e20' : '#f59e0b20',
                            color: payStatus === 'approved' ? '#22c55e' : '#f59e0b',
                          }}>
                            {payStatus === 'approved' ? 'PAID' : 'PENDING'}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className={styles.playerBadges}>
                      {bStatus === 'champion' && <span>🏆</span>}
                      {bStatus === 'out'      && <span className={styles.badgeOut}>OUT</span>}
                      {payStatus === 'payment_submitted' && (
                        <button className={styles.btnAmber} onClick={() => approvePayment(p.user_id)}>Approve</button>
                      )}
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
            {bracketData?.teamSizeMismatch && (
              <div className={styles.mismatchBanner}>
                <i className="ri-error-warning-line" style={{ color: '#f59e0b', fontSize: 18, flexShrink: 0 }} />
                <div>
                  <div className={styles.mismatchTitle}>Match type changed to {bracketData.currentTeamSize}v{bracketData.currentTeamSize}</div>
                  <div className={styles.mismatchSub}>Reset bracket to apply the new format.</div>
                </div>
              </div>
            )}
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
            <div className={styles.card} style={{ padding: '14px 16px' }}>
              <div className={styles.cardHead}>
                <i className="ri-node-tree" style={{ color: '#6366f1', fontSize: 16 }} />
                <span className={styles.cardTitle}>Bracket Editor</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  Drag to swap · Tap to rename
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

        {/* ════ SETTINGS ════ */}
        {activeTab === 'settings' && editForm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Section toggle */}
            <div style={{ display: 'flex', background: 'var(--surface)', borderRadius: 12, padding: 4, gap: 4, border: '1px solid var(--border)' }}>
              {[
                { key: 'edit', label: 'Edit Details', icon: 'ri-edit-line' },
                { key: 'danger', label: 'Advanced', icon: 'ri-error-warning-line' },
              ].map(s => (
                <button key={s.key} onClick={() => setSettingsSection(s.key)} style={{
                  flex: 1, padding: '8px 12px', borderRadius: 9, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  border: 'none', fontFamily: 'inherit',
                  background: settingsSection === s.key
                    ? (s.key === 'danger' ? '#ef444418' : '#6366f118')
                    : 'transparent',
                  color: settingsSection === s.key
                    ? (s.key === 'danger' ? '#ef4444' : '#6366f1')
                    : 'var(--text-muted)',
                }}>
                  <i className={s.icon} /> {s.label}
                </button>
              ))}
            </div>

            {/* ── Edit Details section ── */}
            {settingsSection === 'edit' && (
              <div className={styles.card} style={{ padding: '16px' }}>
                <div className={styles.cardHead} style={{ marginBottom: 14 }}>
                  <i className="ri-settings-3-line" style={{ color: '#6366f1', fontSize: 16 }} />
                  <span className={styles.cardTitle}>Tournament Details</span>
                  <button onClick={saveEdit} disabled={editSaving} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 8, background: editSaved ? '#22c55e' : '#6366f1', color: '#fff', border: 'none', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                    {editSaving ? <><i className="ri-loader-4-line" /> Saving…</> : editSaved ? <><i className="ri-check-line" /> Saved</> : <><i className="ri-save-line" /> Save</>}
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

                  <div className={styles.field}>
                    <label>Slots</label>
                    <input type="number" value={editForm.slots} onChange={e => setEF('slots', e.target.value)} placeholder="e.g. 32" className={styles.input} />
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
            )}

            {/* ── Advanced / Danger section ── */}
            {settingsSection === 'danger' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Transfer Players */}
                <div className={styles.dangerCard} style={{ borderColor: '#6366f130', background: '#6366f108' }}>
                  <div className={styles.dangerHead} style={{ color: '#6366f1' }}>
                    <i className="ri-swap-line" style={{ fontSize: 18 }} /> Transfer Players
                  </div>
                  <p className={styles.dangerSub}>
                    Move all {participants.length} registered players into another tournament with the same match type ({tournament?.team_size === 1 ? '1v1 Solo' : `${tournament?.team_size}v${tournament?.team_size} Team`}).
                  </p>
                  {!showTransfer ? (
                    <button className={styles.btnPrimary} onClick={loadTransferTargets} disabled={participants.length === 0} style={{ opacity: participants.length === 0 ? 0.5 : 1 }}>
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
                                  <button key={t.id} onClick={() => setTransferTarget(isSelected ? null : t.id)} disabled={isFull}
                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${isSelected ? '#6366f1' : 'var(--border)'}`, background: isSelected ? '#6366f112' : 'var(--surface)', cursor: isFull ? 'not-allowed' : 'pointer', opacity: isFull ? 0.5 : 1, textAlign: 'left', width: '100%' }}>
                                    <i className="ri-tournament-line" style={{ color: isSelected ? '#6366f1' : 'var(--text-muted)', fontSize: 16, flexShrink: 0 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{t.registered_count || 0}/{t.slots} players · {t.status}{isFull && ' · FULL'}</div>
                                    </div>
                                    {isSelected && <i className="ri-checkbox-circle-fill" style={{ color: '#6366f1', fontSize: 18, flexShrink: 0 }} />}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={transferPlayers} disabled={!transferTarget || transferLoading}
                              style={{ flex: 1, padding: '10px', borderRadius: 9, background: transferTarget ? '#6366f1' : 'var(--border)', color: transferTarget ? '#fff' : 'var(--text-muted)', border: 'none', fontSize: 13, fontWeight: 800, cursor: transferTarget ? 'pointer' : 'default' }}>
                              {transferLoading ? <><i className="ri-loader-4-line" /> Transferring…</> : <><i className="ri-swap-line" /