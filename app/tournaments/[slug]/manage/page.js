'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '../../../../components/AuthProvider'
import { supabase } from '../../../../lib/supabase'
import styles from './page.module.css'
import BracketBuilder from '../../../../components/BracketBuilder'
import { buildGroups, computeStandings, isGroupStageComplete, getQualifiers } from '../../../../lib/groupStage'
import usePageLoading from '../../../../components/usePageLoading'
import useTranslation from '../../../../lib/useTranslation'
import { getTimeStatus, toLocalInputValue, formatDuration, formatTimeOfDay, isTimeUp } from '../../../../lib/roundTimers'
import { randomizeMatchSchedule, knockoutKey, fixtureKey } from '../../../../lib/matchScheduler'

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
  const { t } = useTranslation()
  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <p className={styles.modalMsg}>{message}</p>
        <div className={styles.modalBtns}>
          <button className={styles.modalCancel} onClick={onCancel}>{t('common.cancel')}</button>
          <button className={styles.modalConfirm} onClick={onConfirm}>{t('common.confirm')}</button>
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
  const { t } = useTranslation()

  const [tournament,   setTournament]   = useState(null)
  const [participants, setParticipants] = useState([])
  const [leaderboard,  setLeaderboard]  = useState([])
  const [pointsEditorId, setPointsEditorId] = useState(null) // user_id of player whose points editor is open
  const [pointsDraft, setPointsDraft] = useState('')
  const [pointsEditMode, setPointsEditMode] = useState('delta') // 'delta' (Adjust by) or 'set' (overwrite exact value)
  const [standingsEditorKey, setStandingsEditorKey] = useState(null) // `${groupId}:${memberId}` of the group-table Pts cell being edited
  const [standingsDraft, setStandingsDraft] = useState('')
  const [bracketData,  setBracketData]  = useState(null)
  const [loading,      setLoading]      = useState(true)
  usePageLoading(loading)
  const [saving,       setSaving]       = useState(false)
  const [activeTab,    setActiveTab]    = useState('overview')
  const [nowTick,      setNowTick]      = useState(() => Date.now())
  const [confirm,      setConfirm]      = useState(null)
  const [groupScoreDraft, setGroupScoreDraft] = useState({}) // { [fixtureId]: { home, away } }
  const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
  const [fxScheduleForm, setFxScheduleForm] = useState({ date: todayLocal(), startHour: 14, endHour: 23, duration: 30 })
  const [koScheduleForm, setKoScheduleForm] = useState({ date: todayLocal(), startHour: 14, endHour: 23, duration: 30 })
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
      setBracketData((t.slots >= 2 && t.stage_format !== 'groups_knockout') ? buildLobbyBracket(t.slots, dbTeamSize) : null)
    } else {
      const mode = parsed.isTeamBattle ? (parsed.teamSize || 2) : 1
      if (mode !== dbTeamSize && parsed.isEmpty) setBracketData(buildLobbyBracket(t.slots, dbTeamSize))
      else if (mode !== dbTeamSize && !parsed.isEmpty) setBracketData({ ...parsed, teamSizeMismatch: true, currentTeamSize: dbTeamSize })
      else setBracketData(parsed)
    }
    setLoading(false)
  }, [slug])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 15000)
    return () => clearInterval(iv)
  }, [])
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
      if (error) showToast(t('tournaments.failedSaveBracket'), 'error')
      else {
        showToast(t('tournaments.bracketSavedToast'))
        setTournament(tt => ({ ...tt, round_names: bd?.round_names ?? tt?.round_names, ...(bd?.slot_count > 0 ? { slots: bd.slot_count } : {}) }))
      }
    } catch { showToast(t('tournaments.networkErrorShort'), 'error') }
    finally { setSaving(false) }
  }

  // ── Bracket actions ───────────────────────────────────────────────────────
  async function initBracket() {
    if (!await verifyCanManage()) return
    const teamSize = tournament?.team_size || 1
    const bd = buildBracket(participants, teamSize)
    if (!bd) { showToast(t('tournaments.needAtLeast2Players'), 'error'); return }
    const { error } = await supabase.from('tournaments').update({ bracket_data: bd }).eq('id', id.current)
    if (error) { showToast(t('tournaments.failedGenerateBracket'), 'error'); return }
    setBracketData(bd)
    showToast(t('tournaments.bracketGenerated'), 'success')
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
      message: `${t('tournaments.resetToFreshLobbyPrefix')} ${teamSize > 1 ? teamSize + 'v' + teamSize + ' ' + t('tournaments.teamLower') : '1v1'} ${t('tournaments.lobbyPlacementsCleared')}`,
      onConfirm: async () => {
        setConfirm(null)
        await supabase.from('tournament_leaderboard').delete().eq('tournament_id', id.current)
        const fresh = buildLobbyBracket(slots, teamSize)
        await supabase.from('tournaments').update({ bracket_data: fresh }).eq('id', id.current)
        setBracketData(fresh)
        showToast(t('tournaments.bracketResetDone'), 'success')
        load()
      },
    })
  }

  // ── Group stage actions ─────────────────────────────────────────────────────
  async function initGroups() {
    if (!await verifyCanManage()) return
    if (realCount < 2) { showToast(t('tournaments.needAtLeast2Players'), 'error'); return }
    const teamSize = tournament?.team_size || 1
    const isLeague = tournament?.stage_format === 'league'
    const groupCount = isLeague ? 1 : (tournament?.group_count || 4)
    const legs = isLeague ? (tournament?.group_count || 2) : 1
    const advancePerGroup = tournament?.advance_per_group || (isLeague ? 3 : 2)
    const groups = buildGroups(participants, groupCount, teamSize, legs)
    const bd = { stage: 'groups', groups, advancePerGroup }
    const { error } = await supabase.from('tournaments').update({ bracket_data: bd }).eq('id', id.current)
    if (error) { showToast(t('tournaments.failedGenerateGroups'), 'error'); return }
    setBracketData(bd)
    showToast(isLeague ? 'Fixtures generated!' : t('tournaments.groupsGenerated'), 'success')
    const notifs = participants.filter(p => p.user_id).map(p => ({
      user_id: p.user_id, title: isLeague ? `League fixtures set — ${tournament.name}` : `Groups drawn — ${tournament.name}`,
      body: isLeague ? 'The league table is set. Check your fixtures!' : 'The group stage is set. Check your group and fixtures!',
      type: 'tournament', meta: { tournament_id: id.current }, read: false,
    }))
    if (notifs.length) await supabase.from('notifications').insert(notifs)
    load()
  }

  async function resetGroups() {
    if (!await verifyCanManage()) return
    setConfirm({
      message: t('tournaments.resetGroupDrawConfirm'),
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

  // Builds the knockout bracket from completed groups and persists it.
  // Called automatically the moment the final group fixture is scored — no
  // admin click needed. Returns the merged bracket_data on success, or null.
  async function autoBuildKnockout(freshBd) {
    if (!freshBd?.groups) return null
    if (!isGroupStageComplete(freshBd.groups)) return null
    if (freshBd.stage === 'knockout') return null // already advanced

    const teamSize = tournament?.team_size || 1
    const advancePerGroup = freshBd.advancePerGroup || tournament?.advance_per_group || 2
    const qualifiers = getQualifiers(freshBd.groups, advancePerGroup)
    if (qualifiers.length < 2) return null

    const knockout = buildBracket(qualifiers, teamSize)
    const merged = { ...freshBd, stage: 'knockout', ...knockout }
    const { error } = await supabase.from('tournaments').update({ bracket_data: merged }).eq('id', id.current)
    if (error) return null
    setBracketData(merged)
    showToast(t('tournaments.groupStageCompleteAutoKnockout'), 'success')
    const notifs = participants.filter(p => p.user_id).map(p => ({
      user_id: p.user_id, title: `Knockout stage begins — ${tournament.name}`,
      body: 'Groups are done — check the bracket to see if you advanced!',
      type: 'tournament', meta: { tournament_id: id.current }, read: false,
    }))
    if (notifs.length) await supabase.from('notifications').insert(notifs)
    return merged
  }

  // Locks in final standings the moment the last league fixture is scored —
  // no admin click needed. Awards a modest podium bonus (reusing the same
  // points plumbing as per-fixture scoring) and marks the tournament
  // completed. Returns the merged bracket_data on success, or null.
  async function finalizeLeague(freshBd) {
    if (!freshBd?.groups?.[0]) return null
    if (!isGroupStageComplete(freshBd.groups)) return null
    if (freshBd.stage === 'complete') return null // already finalized

    const table = freshBd.groups[0]
    const podium = freshBd.advancePerGroup || tournament?.advance_per_group || 3
    const standings = computeStandings(table)
    const winners = standings.slice(0, podium).map(row => ({ id: row.id, name: row.name, points: row.points, position: row.position }))
    if (!winners.length) return null

    const merged = { ...freshBd, stage: 'complete', winners, podium }
    const { error } = await supabase.from('tournaments').update({ bracket_data: merged, status: 'completed' }).eq('id', id.current)
    if (error) return null
    setBracketData(merged)
    setTournament(tt => ({ ...tt, status: 'completed' }))
    showToast('League complete — champions decided! 🏆', 'success')

    const BONUS_BY_POSITION = { 1: 30, 2: 20, 3: 10 }
    await Promise.all(winners.flatMap(w => {
      const member = table.members.find(m => (m.id ?? m.userId ?? m.teamId) === w.id)
      const bonus = BONUS_BY_POSITION[w.position] || 5
      return resolveMemberUserIds(member).map(uid => awardGroupPoints(uid, bonus))
    }))
    const champion = winners.find(w => w.position === 1)
    if (champion) {
      const champMember = table.members.find(m => (m.id ?? m.userId ?? m.teamId) === champion.id)
      await Promise.all(resolveMemberUserIds(champMember).map(uid => supabase.from('profiles').update({ is_season_winner: true }).eq('id', uid)))
    }

    const winnerIds = new Set(winners.flatMap(w => resolveMemberUserIds(table.members.find(m => (m.id ?? m.userId ?? m.teamId) === w.id))))
    const notifs = participants.filter(p => p.user_id).map(p => {
      const isWinner = winnerIds.has(p.user_id)
      const rank = winners.find(w => resolveMemberUserIds(table.members.find(m => (m.id ?? m.userId ?? m.teamId) === w.id)).includes(p.user_id))?.position
      return {
        user_id: p.user_id,
        title: isWinner ? `You finished #${rank} — ${tournament.name}` : `League complete — ${tournament.name}`,
        body: isWinner ? `Congrats — you finished #${rank} on the table! Check your wallet for bonus pts.` : 'All fixtures are played. Check the final table!',
        type: isWinner ? 'tournament_champion' : 'tournament', meta: { tournament_id: id.current }, read: false,
      }
    })
    if (notifs.length) await supabase.from('notifications').insert(notifs)
    return merged
  }

  function resolveMemberUserIds(member) {
    if (!member) return []
    if (member.players?.length) return member.players.map(p => p.userId).filter(Boolean) // team unit
    return member.id ? [member.id] : [] // solo unit — id IS the userId
  }

  // ── Points adjustment — shared by (1) automatic group-stage win/draw/loss
  // scoring and (2) manual admin adjustments (no-show penalties, corrections,
  // bonuses). Deltas can be negative and are NOT floored at 0 — a penalized
  // player's tournament points can legitimately go negative, same as their
  // global profile points, so organisers can dock a no-show without it
  // silently getting clamped back up. ──────────────────────────────────────
  async function awardGroupPoints(userId, delta) {
    if (!userId || !delta) return
    const { data: ex } = await supabase.from('tournament_leaderboard').select('id, points').eq('tournament_id', id.current).eq('user_id', userId).maybeSingle()
    let newPoints, entryId
    if (ex) {
      newPoints = (ex.points || 0) + delta
      await supabase.from('tournament_leaderboard').update({ points: newPoints }).eq('id', ex.id)
      entryId = ex.id
    } else {
      // No row yet == the player is sitting at 0 pts (never scored/adjusted
      // before). Insert fresh and keep the returned id so the local state
      // patch below can add a real entry for them.
      newPoints = delta
      const { data: ins } = await supabase.from('tournament_leaderboard')
        .insert({ tournament_id: id.current, user_id: userId, points: newPoints, position: 99 })
        .select('id').single()
      entryId = ins?.id
    }
    const { error: rpcErr } = await supabase.rpc('increment_points', { uid: userId, amount: delta })
    if (rpcErr) {
      const { data: p } = await supabase.from('profiles').select('points').eq('id', userId).maybeSingle()
      if (p) await supabase.from('profiles').update({ points: (p.points || 0) + delta }).eq('id', userId)
    }
    setLeaderboard(prev => {
      const idx = prev.findIndex(e => e.user_id === userId)
      if (idx === -1) {
        // BUG FIX: a player with no existing leaderboard row (still on 0 pts)
        // was silently dropped here — the DB write above went through fine,
        // but the UI kept showing 0 until a full reload. Add them locally so
        // a -3 no-show penalty on a never-scored player shows up immediately.
        const profile = participants.find(p => p.user_id === userId)?.profiles || null
        return [...prev, { id: entryId, tournament_id: id.current, user_id: userId, points: newPoints, position: 99, profiles: profile }]
      }
      const next = [...prev]
      next[idx] = { ...next[idx], points: newPoints }
      return next
    })
    return newPoints
  }

  // Admin-facing wrapper: applies a manual delta (positive or negative) to a
  // player's tournament points and surfaces a toast, used for the "Adjust
  // Points" control and no-show penalty shortcuts.
  async function adjustPointsManually(userId, username, delta) {
    if (!userId || !delta) return
    const newPoints = await awardGroupPoints(userId, delta)
    showToast(`${delta > 0 ? '+' : ''}${delta} pts ${delta > 0 ? 'awarded to' : 'deducted from'} ${username || 'player'}${newPoints != null ? ` (now ${newPoints})` : ''}`)
  }

  // Group-stage standings adjustment: writes a persistent per-member delta
  // into bracket_data.groups[].adjustments so it's layered into
  // computeStandings() and actually shows up in the Pts column of the group
  // table (no-show penalties/manual edits previously only touched
  // tournament_leaderboard, which the standings table never reads from).
  // Mirrors the same delta into the per-user tournament leaderboard / global
  // profile points via awardGroupPoints so both views stay in sync.
  async function applyGroupPenalty(groupId, member, delta) {
    if (!member || !delta) return
    const memberId = member.id ?? member.userId ?? member.teamId
    const { data: freshT } = await supabase.from('tournaments').select('bracket_data').eq('id', id.current).single()
    const freshBd = parseBracketData(freshT?.bracket_data) ?? bracketData
    const newGroups = freshBd.groups.map(g => g.id !== groupId ? g : {
      ...g,
      adjustments: { ...(g.adjustments || {}), [memberId]: ((g.adjustments || {})[memberId] || 0) + delta },
    })
    const newBd = { ...freshBd, groups: newGroups }
    await supabase.from('tournaments').update({ bracket_data: newBd }).eq('id', id.current)
    setBracketData(newBd)
    const uids = resolveMemberUserIds(member)
    await Promise.all(uids.map(uid => awardGroupPoints(uid, delta)))
    showToast(`${delta > 0 ? '+' : ''}${delta} pts ${delta > 0 ? 'awarded to' : 'deducted from'} ${member.name || 'player'} on the table`)
  }

  // Admin-facing wrapper: OVERWRITES a player's tournament points to an exact
  // value, instead of adding a delta — lets the organiser directly correct an
  // already-applied score on the table (e.g. a no-show penalty typed wrong,
  // or a stray manual adjustment) without having to back-calculate the delta.
  async function setPointsExactly(userId, username, targetPoints) {
    if (!userId || targetPoints == null || Number.isNaN(targetPoints)) return
    const { data: ex } = await supabase.from('tournament_leaderboard').select('id, points').eq('tournament_id', id.current).eq('user_id', userId).maybeSingle()
    const oldPoints = ex?.points || 0
    const delta = targetPoints - oldPoints
    let entryId = ex?.id
    if (ex) {
      await supabase.from('tournament_leaderboard').update({ points: targetPoints }).eq('id', ex.id)
    } else {
      const { data: ins } = await supabase.from('tournament_leaderboard')
        .insert({ tournament_id: id.current, user_id: userId, points: targetPoints, position: 99 })
        .select('id').single()
      entryId = ins?.id
    }
    if (delta) {
      const { error: rpcErr } = await supabase.rpc('increment_points', { uid: userId, amount: delta })
      if (rpcErr) {
        const { data: p } = await supabase.from('profiles').select('points').eq('id', userId).maybeSingle()
        if (p) await supabase.from('profiles').update({ points: (p.points || 0) + delta }).eq('id', userId)
      }
    }
    setLeaderboard(prev => {
      const idx = prev.findIndex(e => e.user_id === userId)
      if (idx === -1) {
        const profile = participants.find(p => p.user_id === userId)?.profiles || null
        return [...prev, { id: entryId, tournament_id: id.current, user_id: userId, points: targetPoints, position: 99, profiles: profile }]
      }
      const next = [...prev]
      next[idx] = { ...next[idx], points: targetPoints }
      return next
    })
    showToast(`Points for ${username || 'player'} set to ${targetPoints}`)
  }

  // ── Per-match schedule (group/league fixtures + knockout matches) ───────
  // Each individual match gets its OWN random start/end slot inside the play
  // window — stored at bracket_data.match_schedule[matchKey] = { start, end }.
  // Keys: 'fx:<fixtureId>' for group/league fixtures, 'ko:<rIdx>-<pIdx>' for
  // knockout bracket pairings. Shared with the public page and the pending-
  // submissions feed so the lock applies everywhere consistently.
  async function saveMatchSchedule(nextSchedule) {
    const newBd = { ...bracketData, match_schedule: nextSchedule }
    setBracketData(newBd)
    await supabase.from('tournaments').update({ bracket_data: newBd }).eq('id', id.current)
  }

  async function randomizeFixtureSchedule() {
    if (!bracketData?.groups) return
    const keys = bracketData.groups.flatMap(g => g.fixtures.filter(f => f.status !== 'played').map(f => fixtureKey(f.id)))
    if (!keys.length) { showToast('No unplayed fixtures to schedule.', 'error'); return }
    const fresh = randomizeMatchSchedule(keys, {
      date: fxScheduleForm.date, windowStartHour: Number(fxScheduleForm.startHour),
      windowEndHour: Number(fxScheduleForm.endHour), durationMinutes: Number(fxScheduleForm.duration),
    })
    await saveMatchSchedule({ ...(bracketData.match_schedule || {}), ...fresh })
    showToast(`Scheduled ${keys.length} fixture${keys.length !== 1 ? 's' : ''} between ${fxScheduleForm.startHour}:00–${fxScheduleForm.endHour}:00.`)
  }

  async function randomizeKnockoutSchedule() {
    if (!bracketData?.rounds) return
    const keys = []
    bracketData.rounds.forEach((pairs, rIdx) => {
      pairs.forEach((pair, pIdx) => {
        const [a, b] = pair || []
        if (!a || !b) return
        if (['bye', 'winner', 'eliminated', 'open', 'pending'].includes(a.status) || ['bye', 'winner', 'eliminated', 'open', 'pending'].includes(b.status)) return
        if (!(a.userId || a.teamId) || !(b.userId || b.teamId)) return
        keys.push(knockoutKey(rIdx, pIdx))
      })
    })
    if (!keys.length) { showToast('No live matches with two real players yet.', 'error'); return }
    const fresh = randomizeMatchSchedule(keys, {
      date: koScheduleForm.date, windowStartHour: Number(koScheduleForm.startHour),
      windowEndHour: Number(koScheduleForm.endHour), durationMinutes: Number(koScheduleForm.duration),
    })
    await saveMatchSchedule({ ...(bracketData.match_schedule || {}), ...fresh })
    showToast(`Scheduled ${keys.length} match${keys.length !== 1 ? 'es' : ''} between ${koScheduleForm.startHour}:00–${koScheduleForm.endHour}:00.`)
  }

  async function shuffleOneMatch(key, form) {
    if (!bracketData) return
    const fresh = randomizeMatchSchedule([key], {
      date: form.date, windowStartHour: Number(form.startHour), windowEndHour: Number(form.endHour), durationMinutes: Number(form.duration),
    })
    await saveMatchSchedule({ ...(bracketData.match_schedule || {}), ...fresh })
  }

  async function clearOneMatchSchedule(key) {
    if (!bracketData) return
    const next = { ...(bracketData.match_schedule || {}) }
    delete next[key]
    await saveMatchSchedule(next)
  }

  async function saveFixtureScore(groupId, fixtureId) {
    const draft = groupScoreDraft[fixtureId]
    if (!draft || draft.home === '' || draft.away === '') return
    setGroupSavingId(fixtureId)
    const { data: freshT } = await supabase.from('tournaments').select('bracket_data').eq('id', id.current).single()
    const freshBd = parseBracketData(freshT?.bracket_data) ?? bracketData
    const group = freshBd.groups.find(g => g.id === groupId)
    const oldFixture = group?.fixtures.find(fx => fx.id === fixtureId)
    const wasPlayed = oldFixture?.status === 'played'
    const oldHome = oldFixture?.scoreHome, oldAway = oldFixture?.scoreAway
    const scoreHome = Number(draft.home), scoreAway = Number(draft.away)

    const newGroups = freshBd.groups.map(g => {
      if (g.id !== groupId) return g
      return {
        ...g,
        fixtures: g.fixtures.map(fx => fx.id !== fixtureId ? fx : {
          ...fx, scoreHome, scoreAway, status: 'played',
        }),
      }
    })
    let newBd = { ...freshBd, groups: newGroups }
    await supabase.from('tournaments').update({ bracket_data: newBd }).eq('id', id.current)
    setBracketData(newBd)

    // ── Award group-stage points: 3 for a win, 1 each for a draw, 0 for a loss.
    // If this fixture was already scored, apply the DELTA between the old and
    // new result — correcting a mistyped score now keeps the leaderboard
    // accurate instead of leaving stale points from the first entry. ──
    if (group) {
      const homeMember = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === oldFixture?.homeId)
      const awayMember = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === oldFixture?.awayId)
      const newHomePts = scoreHome > scoreAway ? 3 : scoreHome === scoreAway ? 1 : 0
      const newAwayPts = scoreAway > scoreHome ? 3 : scoreAway === scoreHome ? 1 : 0
      let oldHomePts = 0, oldAwayPts = 0
      if (wasPlayed && oldHome != null && oldAway != null) {
        oldHomePts = oldHome > oldAway ? 3 : oldHome === oldAway ? 1 : 0
        oldAwayPts = oldAway > oldHome ? 3 : oldAway === oldHome ? 1 : 0
      }
      const homeDelta = newHomePts - oldHomePts
      const awayDelta = newAwayPts - oldAwayPts
      const jobs = []
      if (homeDelta !== 0) resolveMemberUserIds(homeMember).forEach(uid => jobs.push(awardGroupPoints(uid, homeDelta)))
      if (awayDelta !== 0) resolveMemberUserIds(awayMember).forEach(uid => jobs.push(awardGroupPoints(uid, awayDelta)))
      if (jobs.length) await Promise.all(jobs)
    }

    // ── Auto-advance: the instant every fixture across every group has been
    // played, either build the knockout bracket (groups_knockout) or lock in
    // final standings (league) automatically — no button needed. ──
    if (isGroupStageComplete(newGroups)) {
      if (tournament?.stage_format === 'league') {
        const finalized = await finalizeLeague(newBd)
        if (finalized) newBd = finalized
      } else {
        const merged = await autoBuildKnockout(newBd)
        if (merged) newBd = merged
      }
    }
    setGroupSavingId(null)
  }

  // ── Player actions ────────────────────────────────────────────────────────
  async function removeParticipant(userId, username) {
    if (!await verifyCanManage()) return
    setConfirm({
      message: `${t('tournaments.removePrefix')} ${username || t('tournaments.thisPlayer')} ${t('tournaments.removeSuffix')}`,
      onConfirm: async () => {
        setConfirm(null)
        await Promise.all([
          supabase.from('tournament_participants').delete().eq('tournament_id', id.current).eq('user_id', userId),
          supabase.from('tournament_leaderboard').delete().eq('tournament_id', id.current).eq('user_id', userId),
          supabase.from('tournament_payments').delete().eq('tournament_id', id.current).eq('user_id', userId),
        ])
        if (bracketData?.rounds) {
          const openSlot   = { userId: null, name: t('tournaments.openStatus'), avatar: null, status: 'open' }
          const openMember = { userId: null, name: t('tournaments.openStatus'), avatar: null, status: 'open' }
          const newRounds = bracketData.rounds.map(r => r.map(pair =>
            bracketData.isTeamBattle
              ? pair.map(team => !team?.members ? team : { ...team, members: team.members.map(m => m?.userId === userId ? openMember : m), status: team.members.every(m => !m?.userId || m.userId === userId) ? 'open' : team.status })
              : pair.map(s => s?.userId === userId ? openSlot : s)
          ))
          const nb = { ...bracketData, rounds: newRounds }
          await saveBracket(nb); setBracketData(nb)
        }
        showToast(`${username || t('tournaments.playerLabel')} ${t('tournaments.removedSuffix')}`, 'success')
        load()
      },
    })
  }

  async function approvePayment(userId) {
    if (!await verifyCanManage()) return
    await supabase.from('tournament_payments').update({ status: 'approved' }).eq('tournament_id', id.current).eq('user_id', userId)
    showToast(t('tournaments.paymentApproved'), 'success')
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
      if (!pick) { showToast(t('tournaments.noOpenSlots'), 'error'); return }
      newRounds = freshBd.rounds.map((r, ri) => ri !== 0 ? r : r.map((pair, pi) => pi !== pick.pi ? pair : pair.map((s, si) => si === pick.si ? mSlot : s)))
      placed = true
    }
    if (!placed) { showToast(t('tournaments.noOpenSlots'), 'error'); return }
    const nb = { ...freshBd, rounds: newRounds, isEmpty: false }
    await saveBracket(nb); setBracketData(nb)
    showToast(`${prof?.username || t('tournaments.playerLabel')} ${t('tournaments.addedToBracketSuffix')}`, 'success')
  }

  async function syncCount() {
    if (!await verifyCanManage()) return
    const { count } = await supabase.from('tournament_participants').select('*', { count: 'exact', head: true }).eq('tournament_id', id.current)
    await supabase.from('tournaments').update({ registered_count: count || 0 }).eq('id', id.current)
    showToast(`${t('tournaments.countSyncedPrefix')} ${count}`, 'success')
    load()
  }

  async function updateStatus(newStatus) {
    if (!await verifyCanManage()) return
    await supabase.from('tournaments').update({ status: newStatus }).eq('id', id.current)
    setTournament(tt => ({ ...tt, status: newStatus }))
    showToast(`${t('tournaments.statusArrow')} ${newStatus}`, 'success')
  }

  async function saveEdit() {
    if (!editForm?.name?.trim()) { setEditError(t('tournaments.nameIsRequired')); return }
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
    setTournament(tt => ({ ...tt, ...editForm }))
    showToast(t('tournaments.tournamentUpdated'))
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
      showToast(`${toInsert.length} ${toInsert.length !== 1 ? t('tournaments.playersTransferredSuccess') : t('tournaments.playerTransferredSuccess')}`)
    } catch (err) { showToast(t('tournaments.transferFailedPrefix') + err.message, 'error') }
    setTransferLoading(false)
  }

  async function deleteTournament() {
    if (!await verifyCanManage()) return
    setConfirm({
      message: t('tournaments.deleteTournamentConfirm'),
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
  if (loading) return null
  if (!tournament) return <div className={styles.loadWrap}><p style={{ color: 'var(--text-muted)' }}>{t('tournaments.notFound')}</p></div>

  // ── Derived ───────────────────────────────────────────────────────────────
  const realCount       = participants.length
  const openSlots       = Math.max(0, (tournament.slots || 0) - realCount)
  const bracketRounds   = bracketData?.rounds?.length ?? 0
  const hasBracket      = !!(bracketData && !bracketData.isEmpty && bracketData.rounds)
  const pendingPayments = participants.filter(p => p.payment_status === 'payment_submitted')

  const inBracketSet = new Set()
  bracketData?.rounds?.[0]?.forEach(pair => pair.forEach(s => {
    if (bracketData.isTeamBattle) (s?.members || []).forEach(m => { if (m?.userId) inBracketSet.add(m.userId) })
    else if (s?.userId) inBracketSet.add(s.userId)
  }))
  const unplaced = participants.filter(p => !inBracketSet.has(p.user_id))

  // Individual matches whose personal timer has run out and still need a decision/score.
  const matchSchedule = bracketData?.match_schedule || {}
  const expiredKoCount = Object.entries(matchSchedule).filter(([k, rt]) => {
    if (!k.startsWith('ko:') || !rt?.end || new Date(rt.end).getTime() > nowTick) return false
    const [rIdxStr, pIdxStr] = k.slice(3).split('-')
    const pair = bracketData?.rounds?.[Number(rIdxStr)]?.[Number(pIdxStr)]
    const [a, b] = pair || []
    return a && b && a.status !== 'winner' && b.status !== 'winner'
  }).length
  const expiredFxCount = Object.entries(matchSchedule).filter(([k, rt]) => {
    if (!k.startsWith('fx:') || !rt?.end || new Date(rt.end).getTime() > nowTick) return false
    const fid = k.slice(3)
    return (bracketData?.groups || []).some(g => g.fixtures.some(f => String(f.id) === fid && f.status !== 'played'))
  }).length

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
            {isAdmin ? <>⬡ {t('tournaments.adminCommandCentre')}</> : <>◈ {t('tournaments.creatorCommandCentre')}</>}
          </div>
          <div className={styles.headerTitle}>{tournament.name}</div>
        </div>
        {/* Tutorial help button */}
        <button className={styles.headerIconBtn} onClick={() => setShowTutorial(true)} title={t('tournaments.howThisWorks')}>
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
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('tournaments.currentStatus')}</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: STATUS_COLORS[tournament.status], textTransform: 'capitalize' }}>{tournament.status}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            {[
              { s: 'active',    icon: 'ri-checkbox-circle-fill', label: t('common.active'),    sub: t('tournaments.openForRegistration') },
              { s: 'ongoing',   icon: 'ri-live-fill',            label: t('tournaments.ongoingStatus'),   sub: t('tournaments.tournamentInProgressShort') },
              { s: 'upcoming',  icon: 'ri-time-fill',            label: t('tournaments.upcomingStatus'),  sub: t('tournaments.notStartedYet') },
              { s: 'completed', icon: 'ri-trophy-fill',          label: t('tournaments.completedStatus'), sub: t('tournaments.tournamentEnded') },
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
          { val: realCount, sub: `/ ${tournament.slots}`, label: t('players.players'), color: '#22c55e', icon: 'ri-group-fill' },
          { val: openSlots, sub: t('tournaments.openSlotsLower'), label: t('tournaments.availableLabel'), color: openSlots > 0 ? '#f59e0b' : 'var(--text-muted)', icon: 'ri-door-open-line' },
          { val: bracketRounds, sub: hasBracket ? t('tournaments.bracketLiveLower') : t('tournaments.noBracketLower'), label: t('tournaments.roundsLabel'), color: '#6366f1', icon: 'ri-node-tree' },
          { val: leaderboard.length, sub: t('tournaments.rankedLower'), label: t('tournaments.scoredLabel'), color: '#f59e0b', icon: 'ri-bar-chart-fill' },
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
              <i className="ri-alarm-warning-fill" /> {pendingPayments.length} {pendingPayments.length !== 1 ? t('tournaments.paymentsPending') : t('tournaments.paymentPending')}
            </div>
          )}
        </div>
      )}

      {/* ── Tab bar (4 tabs now) ── */}
      <div className={styles.tabs}>
        {TABS.map(tab => (
          <button key={tab.key}
            className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.key)}>
            <i className={tab.icon} />
            {t(`tournaments.manageTab_${tab.key}`)}
            {/* Badge for pending payments on Players tab */}
            {tab.key === 'players' && pendingPayments.length > 0 && (
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
          {['groups_knockout', 'league'].includes(tournament?.stage_format) && bracketData?.stage !== 'knockout' && bracketData?.stage !== 'complete' && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <i className={tournament?.stage_format === 'league' ? 'ri-trophy-line' : 'ri-layout-grid-line'} style={{ color: '#f59e0b', fontSize: 16 }} />
                <span className={styles.cardTitle}>{tournament?.stage_format === 'league' ? 'League Table' : t('tournaments.groupStage')}</span>
                {saving && <span className={styles.cardSaving}><i className="ri-loader-4-line" /> {t('common.saving')}</span>}
              </div>
              {bracketData?.groups ? (
                <>
                  <div className={styles.statRow}>
                    {(tournament?.stage_format === 'league' ? [
                      { val: (tournament?.group_count || 2) >= 2 ? 'Home & Away' : 'Single Round', label: 'Legs', color: '#f59e0b' },
                      { val: bracketData.groups.reduce((n, g) => n + g.fixtures.filter(f => f.status === 'played').length, 0) + '/' + bracketData.groups.reduce((n, g) => n + g.fixtures.length, 0), label: t('tournaments.playedLabel'), color: '#6366f1' },
                      { val: `Top ${bracketData.advancePerGroup ?? tournament?.advance_per_group ?? 3}`, label: 'Winners', color: '#22c55e' },
                    ] : [
                      { val: bracketData.groups.length, label: t('tournaments.groupsTab'), color: '#f59e0b' },
                      { val: bracketData.groups.reduce((n, g) => n + g.fixtures.filter(f => f.status === 'played').length, 0) + '/' + bracketData.groups.reduce((n, g) => n + g.fixtures.length, 0), label: t('tournaments.playedLabel'), color: '#6366f1' },
                      { val: bracketData.advancePerGroup ?? tournament?.advance_per_group ?? 2, label: t('tournaments.advanceEach'), color: '#22c55e' },
                    ]).map(s => (
                      <div key={s.label} className={styles.statBox}>
                        <span className={styles.statBoxVal} style={{ color: s.color }}>{s.val}</span>
                        <span className={styles.statBoxLabel}>{s.label}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                    borderRadius: 10, marginBottom: 4, fontSize: 11.5, fontWeight: 700,
                    background: isGroupStageComplete(bracketData.groups) ? 'rgba(34,197,94,0.08)' : 'rgba(99,102,241,0.08)',
                    color: isGroupStageComplete(bracketData.groups) ? 'var(--accent)' : '#6366f1',
                  }}>
                    <i className={isGroupStageComplete(bracketData.groups) ? 'ri-checkbox-circle-fill' : 'ri-information-line'} />
                    {isGroupStageComplete(bracketData.groups)
                      ? t('tournaments.allFixturesPlayed')
                      : (tournament?.stage_format === 'league' ? 'Standings lock in automatically once every fixture is played.' : t('tournaments.knockoutBuildsAuto'))}
                  </div>
                  <div className={styles.btnRow}>
                    <button className={styles.btnDanger} onClick={resetGroups}>
                      <i className="ri-restart-line" /> {tournament?.stage_format === 'league' ? 'Reset Fixtures' : t('tournaments.resetGroups')}
                    </button>
                  </div>

                  {/* Match schedule — randomly assigns each individual fixture its own
                      start/end slot inside a play window; visible to players, locks
                      self-submission once THAT match's own window closes. */}
                  <div style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                      <i className="ri-shuffle-line" style={{ color: '#6366f1', fontSize: 16 }} />
                      <span style={{ fontSize: 13, fontWeight: 800 }}>Match Schedule</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>Each fixture gets its own random time</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', flex: '1 1 120px' }}>
                        Date
                        <input type="date" value={fxScheduleForm.date} onChange={e => setFxScheduleForm(f => ({ ...f, date: e.target.value }))}
                          style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, background: 'var(--bg)', color: 'var(--text)' }} />
                      </label>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', flex: '1 1 80px' }}>
                        From (hr)
                        <input type="number" min={0} max={23} value={fxScheduleForm.startHour} onChange={e => setFxScheduleForm(f => ({ ...f, startHour: e.target.value }))}
                          style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, background: 'var(--bg)', color: 'var(--text)' }} />
                      </label>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', flex: '1 1 80px' }}>
                        To (hr)
                        <input type="number" min={0} max={23} value={fxScheduleForm.endHour} onChange={e => setFxScheduleForm(f => ({ ...f, endHour: e.target.value }))}
                          style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, background: 'var(--bg)', color: 'var(--text)' }} />
                      </label>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', flex: '1 1 100px' }}>
                        Duration (min)
                        <input type="number" min={5} value={fxScheduleForm.duration} onChange={e => setFxScheduleForm(f => ({ ...f, duration: e.target.value }))}
                          style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, background: 'var(--bg)', color: 'var(--text)' }} />
                      </label>
                    </div>
                    <button onClick={randomizeFixtureSchedule} style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <i className="ri-dice-line" /> Randomly Schedule All Fixtures
                    </button>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6 }}>
                      Every unplayed fixture gets its own random slot between {fxScheduleForm.startHour}:00 and {fxScheduleForm.endHour}:00 — players see a personal countdown and can't submit once their match's window closes.
                    </div>
                  </div>

                  {/* Per-group standings + fixture score entry */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
                    {expiredFxCount > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: '#ef444412', border: '1.5px solid #ef444440' }}>
                        <i className="ri-alarm-warning-fill" style={{ color: '#ef4444', fontSize: 18, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 800, color: '#ef4444' }}>{expiredFxCount} fixture{expiredFxCount !== 1 ? 's' : ''} past their scheduled time</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Dock -3 for a clean no-show, or review flagged fixtures below — scores can no longer be typed in blind once time's up.</div>
                        </div>
                      </div>
                    )}
                    {bracketData.groups.map(group => {
                      const standings = computeStandings(group)
                      return (
                        <div key={group.id} style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                          <div style={{ padding: '9px 12px', background: 'var(--bg-2)', fontSize: 12, fontWeight: 800 }}>{group.name}</div>

                          {/* Standings — real football-style table: P W D L GF GA GD Pts */}
                          <div style={{ padding: '8px 12px', overflowX: 'auto' }}>
                            <div style={{ display: 'flex', gap: 6, padding: '4px 0 6px', fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 320 }}>
                              <span style={{ width: 14 }}>#</span>
                              <span style={{ flex: 1 }}>{t('tournaments.teamLabel')}</span>
                              {['P', 'W', 'D', 'L', 'GF', 'GA', 'GD'].map(h => (
                                <span key={h} style={{ width: 22, textAlign: 'center' }}>{h}</span>
                              ))}
                              <span style={{ width: 30, textAlign: 'center' }}>{t('tournaments.ptsAbbrev')}</span>
                            </div>
                            {standings.map(row => {
                              const advances = row.position <= (bracketData.advancePerGroup ?? tournament?.advance_per_group ?? 2)
                              const member = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === row.id)
                              const sKey = `${group.id}:${row.id}`
                              const editingStandings = standingsEditorKey === sKey
                              return (
                                <div key={row.id} style={{ display: 'flex', flexDirection: 'column', minWidth: 320 }}>
                                <div style={{
                                  display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', fontSize: 11.5,
                                  borderLeft: advances ? '2px solid var(--accent)' : '2px solid transparent', paddingLeft: 4,
                                }}>
                                  <span style={{ width: 14, color: 'var(--text-muted)', fontWeight: 700 }}>{row.position}</span>
                                  <span style={{ flex: 1, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                                  <span style={{ width: 22, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{row.played}</span>
                                  <span style={{ width: 22, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{row.won}</span>
                                  <span style={{ width: 22, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{row.drawn}</span>
                                  <span style={{ width: 22, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{row.lost}</span>
                                  <span style={{ width: 22, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{row.goalsFor}</span>
                                  <span style={{ width: 22, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{row.goalsAgainst}</span>
                                  <span style={{ width: 22, textAlign: 'center', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: row.goalDiff > 0 ? 'var(--accent)' : row.goalDiff < 0 ? '#ef4444' : 'var(--text-muted)' }}>
                                    {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
                                  </span>
                                  <button
                                    onClick={() => { setStandingsEditorKey(editingStandings ? null : sKey); setStandingsDraft(String(row.points)) }}
                                    title="Edit points"
                                    style={{
                                      width: 30, textAlign: 'center', fontWeight: 800, fontFamily: 'ui-monospace, monospace', color: 'var(--accent)',
                                      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                                      textDecoration: row.adjustment ? 'underline dotted' : 'none',
                                    }}
                                  >
                                    {row.points}
                                  </button>
                                </div>
                                {editingStandings && (
                                  <div style={{
                                    display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0 8px', padding: '7px 9px',
                                    borderRadius: 9, background: 'var(--bg)', border: '1px solid var(--border)',
                                  }}>
                                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, flexShrink: 0 }}>Set Pts to</span>
                                    <input
                                      type="number" value={standingsDraft} autoFocus
                                      onChange={e => setStandingsDraft(e.target.value)}
                                      style={{ flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: 7, border: '1px solid var(--border-dark)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}
                                    />
                                    <button
                                      onClick={async () => {
                                        if (standingsDraft === '') return
                                        const target = Number(standingsDraft)
                                        const delta = target - row.points
                                        if (delta) await applyGroupPenalty(group.id, member, delta)
                                        setStandingsEditorKey(null); setStandingsDraft('')
                                      }}
                                      disabled={standingsDraft === ''}
                                      style={{ padding: '6px 12px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}
                                    >
                                      Apply
                                    </button>
                                    <button onClick={() => setStandingsEditorKey(null)} style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                                      Cancel
                                    </button>
                                  </div>
                                )}
                                </div>
                              )
                            })}
                          </div>

                          {/* Fixtures */}
                          <div style={{ borderTop: '1px solid var(--border)' }}>
                            {group.fixtures.map(fx => {
                              const home = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.homeId)
                              const away = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.awayId)
                              const draft = groupScoreDraft[fx.id] ?? { home: fx.scoreHome ?? '', away: fx.scoreAway ?? '' }
                              const fk = fixtureKey(fx.id)
                              const st = getTimeStatus(bracketData.match_schedule, fk, nowTick)
                              // Once a fixture's play window has closed with no admin decision yet,
                              // stop inviting the admin to type in a fresh score out of thin air —
                              // the only defined outcomes past the deadline are: dock -3 from both
                              // sides if NEITHER submitted anything (below), or leave it for the
                              // admin to decide by hand if one side DID submit (no automatic action).
                              // Editing an already-played fixture's score is still allowed — that's
                              // a correction to a real result, not fabricating one from nothing.
                              const expiredUnplayed = fx.status !== 'played' && st?.phase === 'over'
                              const neitherSubmitted = !fx.submissions?.home && !fx.submissions?.away
                              const canEnterScore = fx.status === 'played' || !expiredUnplayed
                              return (
                                <div key={fx.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                  {canEnterScore ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', fontSize: 11.5 }}>
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
                                  ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', fontSize: 11.5 }}>
                                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}>{home?.name || '?'}</span>
                                      <span style={{ fontSize: 9.5, color: 'var(--text-muted)', fontWeight: 700 }}>vs</span>
                                      <span style={{ flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}>{away?.name || '?'}</span>
                                    </div>
                                  )}
                                  {fx.status !== 'played' && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px 7px' }}>
                                      {st ? (
                                        <span style={{
                                          fontSize: 9.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
                                          color: st.phase === 'over' ? '#ef4444' : st.phase === 'live' ? '#22c55e' : '#f59e0b',
                                          background: st.phase === 'over' ? '#ef444415' : st.phase === 'live' ? '#22c55e15' : '#f59e0b15',
                                        }}>
                                          <i className="ri-time-line" /> {st.phase === 'over' ? "Time's up" : st.phase === 'live' ? `Ends in ${formatDuration(st.ms)}` : st.phase === 'upcoming' ? `Plays at ${formatTimeOfDay(st.start)}` : 'Live'}
                                        </span>
                                      ) : (
                                        <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>No time assigned yet</span>
                                      )}
                                      <button onClick={() => shuffleOneMatch(fk, fxScheduleForm)} title="Re-roll this match's time" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>
                                        <i className="ri-shuffle-line" />
                                      </button>
                                      {st && (
                                        <button onClick={() => clearOneMatchSchedule(fk)} title="Clear this match's time" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>
                                          <i className="ri-close-circle-line" />
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  {/* ── No-show penalty: neither side submitted anything and the match
                                      window has closed. Lets the organiser dock points from either or
                                      both sides directly, instead of leaving the fixture unscored. ── */}
                                  {expiredUnplayed && neitherSubmitted && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px 9px', flexWrap: 'wrap' }}>
                                      <span style={{ fontSize: 9.5, fontWeight: 800, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 3 }}>
                                        <i className="ri-user-unfollow-line" /> No-show — neither side submitted
                                      </span>
                                      <button
                                        onClick={() => applyGroupPenalty(group.id, home, -3)}
                                        disabled={!home}
                                        style={{ padding: '4px 9px', borderRadius: 6, border: '1px solid #ef444440', background: '#ef444412', color: '#ef4444', fontSize: 10, fontWeight: 800, cursor: home ? 'pointer' : 'not-allowed' }}
                                      >
                                        −3 {home?.name || 'Home'}
                                      </button>
                                      <button
                                        onClick={() => applyGroupPenalty(group.id, away, -3)}
                                        disabled={!away}
                                        style={{ padding: '4px 9px', borderRadius: 6, border: '1px solid #ef444440', background: '#ef444412', color: '#ef4444', fontSize: 10, fontWeight: 800, cursor: away ? 'pointer' : 'not-allowed' }}
                                      >
                                        −3 {away?.name || 'Away'}
                                      </button>
                                    </div>
                                  )}
                                  {/* ── Partial submission: one side submitted, the other didn't, and time
                                      is up. No automatic action — just flag it so the organiser can look
                                      at the submission and decide by hand (adjust points, chase the other
                                      player, etc). ── */}
                                  {expiredUnplayed && !neitherSubmitted && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px 9px', flexWrap: 'wrap' }}>
                                      <span style={{ fontSize: 9.5, fontWeight: 800, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 3 }}>
                                        <i className="ri-error-warning-line" /> Only {fx.submissions?.home && !fx.submissions?.away ? (home?.name || 'Home') : (away?.name || 'Away')} submitted — needs your review
                                      </span>
                                    </div>
                                  )}
                                  {/* ── What was actually submitted — the admin previously had no way to
                                      see the numbers/proof a player sent in, only a boolean "submitted or
                                      not". Show both sides' claimed scores (and proof screenshot, if any)
                                      any time a submission exists and the fixture isn't finalized yet. ── */}
                                  {fx.status !== 'played' && (fx.submissions?.home || fx.submissions?.away) && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 12px 9px' }}>
                                      {fx.disputed && (
                                        <span style={{ fontSize: 9.5, fontWeight: 800, color: '#ef4444' }}>
                                          <i className="ri-error-warning-line" /> Scores don't match
                                        </span>
                                      )}
                                      {['home', 'away'].map(side => {
                                        const sub = fx.submissions?.[side]
                                        if (!sub) return null
                                        const submitter = side === 'home' ? home : away
                                        return (
                                          <div key={side} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--text-dim)' }}>
                                            <i className="ri-file-list-3-line" style={{ color: 'var(--text-muted)' }} />
                                            <span style={{ fontWeight: 700 }}>{submitter?.name || side}</span> submitted
                                            <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800 }}>{sub.home}–{sub.away}</span>
                                            {sub.at && <span style={{ color: 'var(--text-muted)' }}>· {new Date(sub.at).toLocaleString()}</span>}
                                            {sub.proofUrl && (
                                              <a href={sub.proofUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 700 }}>
                                                <i className="ri-image-line" /> proof
                                              </a>
                                            )}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}
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
                    <i className="ri-play-fill" /> {t('tournaments.generateGroups')}
                    {realCount < 2 && <span style={{ fontSize: 10, opacity: 0.6 }}> {t('tournaments.twoPlusNeeded')}</span>}
                  </button>
                </div>
              )}
            </div>
          )}

          {tournament?.stage_format === 'league' && bracketData?.stage === 'complete' && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <i className="ri-trophy-fill" style={{ color: '#f59e0b', fontSize: 16 }} />
                <span className={styles.cardTitle}>Champions</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(bracketData.winners || []).map((w, i) => (
                  <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: 'var(--bg-2)' }}>
                    <span style={{ fontSize: 16 }}>{['🥇', '🥈', '🥉'][i] || '🏅'}</span>
                    <span style={{ flex: 1, fontWeight: 800, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{w.points} pts</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick-action bracket card — hidden for group→knockout tournaments while
              groups are still running, since the bracket there is built automatically. */}
          {(tournament?.stage_format !== 'league') && (tournament?.stage_format !== 'groups_knockout' || bracketData?.stage === 'knockout') && (
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <i className="ri-node-tree" style={{ color: '#6366f1', fontSize: 16 }} />
              <span className={styles.cardTitle}>{t('tournaments.bracket')}</span>
              {saving && <span className={styles.cardSaving}><i className="ri-loader-4-line" /> {t('common.saving')}</span>}
            </div>
            {bracketData?.teamSizeMismatch && (
              <div className={styles.mismatchBanner}>
                <i className="ri-error-warning-line" style={{ color: '#f59e0b', fontSize: 18, flexShrink: 0 }} />
                <div>
                  <div className={styles.mismatchTitle}>{t('tournaments.matchTypeChangedTo')} {bracketData.currentTeamSize}v{bracketData.currentTeamSize}</div>
                  <div className={styles.mismatchSub}>{t('tournaments.resetRegenerateApply')}</div>
                </div>
              </div>
            )}
            <div className={styles.statRow}>
              {[
                { val: bracketRounds, label: t('tournaments.roundsLabel'), color: '#6366f1' },
                { val: bracketData?.bracketSize ?? 0, label: t('tournaments.slotsLabel'), color: '#22c55e' },
                { val: bracketData?.isTeamBattle ? `${bracketData.teamSize}v${bracketData.teamSize}` : '1v1', label: t('tournaments.format'), color: bracketData?.isTeamBattle ? '#a78bfa' : 'var(--text-muted)' },
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
                    <i className="ri-play-fill" /> {t('tournaments.generateBracket')}
                    {realCount < 2 && <span style={{ fontSize: 10, opacity: 0.6 }}> {t('tournaments.twoPlusNeeded')}</span>}
                  </button>
                : <button className={styles.btnDanger} onClick={resetBracket}>
                    <i className="ri-restart-line" /> {t('tournaments.resetBracketBtn')}
                  </button>
              }
              <button className={styles.btnGhost} onClick={() => setActiveTab('bracket')}>
                <i className="ri-edit-line" /> {t('common.edit')}
              </button>
              <button className={styles.btnGhost} onClick={() => router.push(`/tournaments/${tournament.slug || tournament.id}#matches`, { scroll: false })}>
                <i className="ri-eye-line" />
              </button>
            </div>
          </div>
          )}

          {/* Sync count */}
          <button className={styles.btnFull} onClick={syncCount}>
            <i className="ri-refresh-line" /> {t('tournaments.syncPlayerCount')}
          </button>

          {/* Top scores */}
          {leaderboard.length > 0 && (
            <div className={styles.card}>
              <div className={styles.sectionLabel}>{t('tournaments.topScores')}</div>
              {leaderboard.slice(0, 5).map((e, i) => (
                <div key={e.user_id} className={styles.scoreRow}>
                  <span className={styles.scoreRank}>{i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`}</span>
                  <span className={styles.scoreName}>{e.profiles?.username || '—'}</span>
                  <span className={styles.scorePts}>{e.points ?? 0} <span className={styles.scorePtsSub}>{t('tournaments.ptsAbbrev')}</span></span>
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
                <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b' }}>{pendingPayments.length} {pendingPayments.length !== 1 ? t('tournaments.paymentsAwaitingApproval') : t('tournaments.paymentAwaitingApproval')}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{t('tournaments.tapApproveEachPlayer')}</div>
              </div>
            </div>
          )}

          {participants.length === 0
            ? <p className={styles.empty}>{t('tournaments.noPlayersYet')}</p>
            : participants.map(p => {
                const bStatus = getPlayerBracketStatus(p.user_id, bracketData)
                const dotColor = bStatus==='champion'?'#f59e0b':bStatus==='out'?'#dc2626':'#22c55e'
                const payStatus = p.payment_status
                return (
                  <div key={p.id} className={styles.playerRow} style={{ flexWrap: 'wrap' }}>
                    <div className={styles.playerAvatar}>
                      <Avatar src={p.profiles?.avatar_url} name={p.profiles?.username} size={36} radius={10} />
                      <span className={styles.playerDot} style={{ background: dotColor }} />
                    </div>
                    <div className={styles.playerInfo}>
                      <span className={styles.playerName}>{p.profiles?.username || t('tournaments.unknownPlayer')}</span>
                      <span className={styles.playerMeta}>Lv.{p.profiles?.level ?? 1}
                        {payStatus && (
                          <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 800,
                            background: payStatus === 'approved' ? '#22c55e20' : '#f59e0b20',
                            color: payStatus === 'approved' ? '#22c55e' : '#f59e0b',
                          }}>
                            {payStatus === 'approved' ? t('tournaments.paidLabel') : t('tournaments.pendingLabel')}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className={styles.playerBadges}>
                      {bStatus === 'champion' && <span>🏆</span>}
                      {bStatus === 'out'      && <span className={styles.badgeOut}>{t('tournaments.outAbbrev')}</span>}
                      {payStatus === 'payment_submitted' && (
                        <button className={styles.btnAmber} onClick={() => approvePayment(p.user_id)}>{t('tournaments.approveBtn')}</button>
                      )}
                      <button
                        onClick={() => { setPointsEditorId(pointsEditorId === p.user_id ? null : p.user_id); setPointsDraft(''); setPointsEditMode('delta') }}
                        title="Adjust points"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 7,
                          border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--accent)',
                          fontSize: 10.5, fontWeight: 800, fontFamily: 'ui-monospace, monospace', cursor: 'pointer',
                        }}
                      >
                        <i className="ri-coins-line" style={{ fontSize: 11 }} />
                        {leaderboard.find(e => e.user_id === p.user_id)?.points ?? 0}
                      </button>
                      <button className={styles.btnRemove} onClick={() => removeParticipant(p.user_id, p.profiles?.username)}>
                        <i className="ri-user-unfollow-line" />
                      </button>
                    </div>
                    {pointsEditorId === p.user_id && (
                      <div style={{
                        width: '100%', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8,
                        padding: '8px 10px', borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--border)',
                      }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            onClick={() => { setPointsEditMode('delta'); setPointsDraft('') }}
                            style={{
                              flex: 1, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer',
                              background: pointsEditMode === 'delta' ? 'var(--accent)' : 'transparent',
                              color: pointsEditMode === 'delta' ? '#fff' : 'var(--text-muted)', fontSize: 9.5, fontWeight: 800,
                            }}
                          >
                            Adjust by
                          </button>
                          <button
                            onClick={() => { setPointsEditMode('set'); setPointsDraft('') }}
                            style={{
                              flex: 1, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer',
                              background: pointsEditMode === 'set' ? 'var(--accent)' : 'transparent',
                              color: pointsEditMode === 'set' ? '#fff' : 'var(--text-muted)', fontSize: 9.5, fontWeight: 800,
                            }}
                          >
                            Set exact points
                          </button>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="number"
                            value={pointsDraft}
                            placeholder={pointsEditMode === 'delta' ? 'e.g. -5 or 10' : 'e.g. 12'}
                            autoFocus
                            onChange={e => setPointsDraft(e.target.value)}
                            style={{ flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: 7, border: '1px solid var(--border-dark)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}
                          />
                          <button
                            onClick={async () => {
                              if (pointsDraft === '') return
                              if (pointsEditMode === 'set') {
                                await setPointsExactly(p.user_id, p.profiles?.username, Number(pointsDraft))
                              } else {
                                const delta = Number(pointsDraft)
                                if (!delta) return
                                await adjustPointsManually(p.user_id, p.profiles?.username, delta)
                              }
                              setPointsEditorId(null); setPointsDraft('')
                            }}
                            disabled={pointsDraft === '' || (pointsEditMode === 'delta' && Number(pointsDraft) === 0)}
                            style={{ padding: '6px 12px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}
                          >
                            Apply
                          </button>
                          <button onClick={() => setPointsEditorId(null)} style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
          }
        </>}

        {/* ════ BRACKET ════ */}
        {activeTab === 'bracket' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tournament?.stage_format === 'groups_knockout' && bracketData?.stage !== 'knockout' ? (
              <div className={styles.card} style={{ padding: '18px 16px', textAlign: 'center' }}>
                <i className="ri-node-tree" style={{ fontSize: 22, color: 'var(--text-muted)' }} />
                <p style={{ margin: '8px 0 4px', fontWeight: 700 }}>{t('tournaments.noBracketYet')}</p>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('tournaments.groupStageFirstDesc')}
                </span>
              </div>
            ) : (
              <>
                {bracketData?.teamSizeMismatch && (
                  <div className={styles.mismatchBanner}>
                    <i className="ri-error-warning-line" style={{ color: '#f59e0b', fontSize: 18, flexShrink: 0 }} />
                    <div>
                      <div className={styles.mismatchTitle}>{t('tournaments.matchTypeChangedTo')} {bracketData.currentTeamSize}v{bracketData.currentTeamSize}</div>
                      <div className={styles.mismatchSub}>{t('tournaments.resetBracketToApply')}</div>
                    </div>
                  </div>
                )}
                {expiredKoCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: '#ef444412', border: '1.5px solid #ef444440' }}>
                    <i className="ri-alarm-warning-fill" style={{ color: '#ef4444', fontSize: 18, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: '#ef4444' }}>{expiredKoCount} match{expiredKoCount !== 1 ? 'es' : ''} past their scheduled time</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Open the bracket and tap the matches to decide the winner.</div>
                    </div>
                    <button onClick={() => router.push(`/tournaments/${tournament.slug || tournament.id}#matches`, { scroll: false })}
                      style={{ flexShrink: 0, padding: '7px 12px', borderRadius: 8, background: '#ef4444', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                      Decide
                    </button>
                  </div>
                )}
                {bracketData?.rounds && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                      <i className="ri-shuffle-line" style={{ color: '#6366f1', fontSize: 16 }} />
                      <span style={{ fontSize: 13, fontWeight: 800 }}>Match Schedule</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>Each match gets its own random time</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', flex: '1 1 120px' }}>
                        Date
                        <input type="date" value={koScheduleForm.date} onChange={e => setKoScheduleForm(f => ({ ...f, date: e.target.value }))}
                          style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, background: 'var(--bg)', color: 'var(--text)' }} />
                      </label>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', flex: '1 1 80px' }}>
                        From (hr)
                        <input type="number" min={0} max={23} value={koScheduleForm.startHour} onChange={e => setKoScheduleForm(f => ({ ...f, startHour: e.target.value }))}
                          style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, background: 'var(--bg)', color: 'var(--text)' }} />
                      </label>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', flex: '1 1 80px' }}>
                        To (hr)
                        <input type="number" min={0} max={23} value={koScheduleForm.endHour} onChange={e => setKoScheduleForm(f => ({ ...f, endHour: e.target.value }))}
                          style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, background: 'var(--bg)', color: 'var(--text)' }} />
                      </label>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', flex: '1 1 100px' }}>
                        Duration (min)
                        <input type="number" min={5} value={koScheduleForm.duration} onChange={e => setKoScheduleForm(f => ({ ...f, duration: e.target.value }))}
                          style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, background: 'var(--bg)', color: 'var(--text)' }} />
                      </label>
                    </div>
                    <button onClick={randomizeKnockoutSchedule} style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <i className="ri-dice-line" /> Randomly Schedule Live Matches
                    </button>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6 }}>
                      Only applies to matches with two real, undecided players. Each one gets its own random slot between {koScheduleForm.startHour}:00 and {koScheduleForm.endHour}:00.
                    </div>

                    {/* Live matches with their assigned time */}
                    {(() => {
                      const rows = []
                      bracketData.rounds.forEach((pairs, rIdx) => pairs.forEach((pair, pIdx) => {
                        const [a, b] = pair || []
                        if (!a || !b) return
                        if (['bye', 'open', 'pending'].includes(a.status) || ['bye', 'open', 'pending'].includes(b.status)) return
                        if (!(a.userId || a.teamId) || !(b.userId || b.teamId)) return
                        rows.push({ rIdx, pIdx, a, b, decided: a.status === 'winner' || b.status === 'winner' })
                      }))
                      if (!rows.length) return null
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                          {rows.map(({ rIdx, pIdx, a, b, decided }) => {
                            const kk = knockoutKey(rIdx, pIdx)
                            const st = getTimeStatus(bracketData.match_schedule, kk, nowTick)
                            const koSlotUserIds = slot => slot?.members?.length ? slot.members.map(m => m.userId).filter(Boolean) : (slot?.userId ? [slot.userId] : [])
                            const noShow = !decided && st?.phase === 'over' && !a?.pendingSubmission && !b?.pendingSubmission
                            return (
                              <div key={kk} style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 8, border: '1px solid var(--border)', opacity: decided ? 0.55 : 1, overflow: 'hidden' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', fontSize: 11 }}>
                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}>
                                  {(a.name || a.teamName || 'TBD')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>vs</span> {(b.name || b.teamName || 'TBD')}
                                </span>
                                {st ? (
                                  <span style={{
                                    fontSize: 9.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5, flexShrink: 0,
                                    color: st.phase === 'over' ? '#ef4444' : st.phase === 'live' ? '#22c55e' : '#f59e0b',
                                    background: st.phase === 'over' ? '#ef444415' : st.phase === 'live' ? '#22c55e15' : '#f59e0b15',
                                  }}>
                                    {st.phase === 'over' ? "Time's up" : st.phase === 'live' ? `Ends in ${formatDuration(st.ms)}` : st.phase === 'upcoming' ? `Plays at ${formatTimeOfDay(st.start)}` : 'Live'}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: 9.5, color: 'var(--text-muted)', flexShrink: 0 }}>No time assigned</span>
                                )}
                                {!decided && (
                                  <>
                                    <button onClick={() => shuffleOneMatch(kk, koScheduleForm)} title="Re-roll this match's time" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>
                                      <i className="ri-shuffle-line" />
                                    </button>
                                    {st && (
                                      <button onClick={() => clearOneMatchSchedule(kk)} title="Clear this match's time" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>
                                        <i className="ri-close-circle-line" />
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                              {noShow && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 8px', flexWrap: 'wrap', background: '#ef444408' }}>
                                  <span style={{ fontSize: 9.5, fontWeight: 800, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 3 }}>
                                    <i className="ri-user-unfollow-line" /> No-show — neither side submitted
                                  </span>
                                  <button
                                    onClick={() => koSlotUserIds(a).forEach(uid => adjustPointsManually(uid, a.name || a.teamName, -3))}
                                    style={{ padding: '4px 9px', borderRadius: 6, border: '1px solid #ef444440', background: '#ef444412', color: '#ef4444', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}
                                  >
                                    −3 {a.name || a.teamName || 'P1'}
                                  </button>
                                  <button
                                    onClick={() => koSlotUserIds(b).forEach(uid => adjustPointsManually(uid, b.name || b.teamName, -3))}
                                    style={{ padding: '4px 9px', borderRadius: 6, border: '1px solid #ef444440', background: '#ef444412', color: '#ef4444', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}
                                  >
                                    −3 {b.name || b.teamName || 'P2'}
                                  </button>
                                </div>
                              )}
                              {/* ── What was actually submitted — same visibility fix as group
                                  fixtures: show each side's claimed score + proof, not just whether
                                  they submitted. ── */}
                              {!decided && (a?.pendingSubmission || b?.pendingSubmission) && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 8px 8px' }}>
                                  {a?.disputed && (
                                    <span style={{ fontSize: 9.5, fontWeight: 800, color: '#ef4444' }}>
                                      <i className="ri-error-warning-line" /> Scores don't match
                                    </span>
                                  )}
                                  {[['a', a], ['b', b]].map(([slotKey, slot]) => {
                                    const sub = slot?.pendingSubmission
                                    if (!sub) return null
                                    return (
                                      <div key={slotKey} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--text-dim)' }}>
                                        <i className="ri-file-list-3-line" style={{ color: 'var(--text-muted)' }} />
                                        <span style={{ fontWeight: 700 }}>{slot.name || slot.teamName || slotKey}</span> submitted
                                        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800 }}>{sub.a}–{sub.b}</span>
                                        {sub.at && <span style={{ color: 'var(--text-muted)' }}>· {new Date(sub.at).toLocaleString()}</span>}
                                        {sub.proofUrl && (
                                          <a href={sub.proofUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 700 }}>
                                            <i className="ri-image-line" /> proof
                                          </a>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </div>
                )}
                <div className={styles.btnRow}>
                  {!hasBracket
                    ? <button className={styles.btnPrimary} onClick={initBracket} disabled={realCount < 2}>
                        <i className="ri-play-fill" /> {t('tournaments.generateFromPlayers')}
                        {realCount < 2 && <span style={{ fontSize: 10, opacity: 0.6 }}> {t('tournaments.twoPlusNeeded')}</span>}
                      </button>
                    : <button className={styles.btnDanger} onClick={resetBracket}>
                        <i className="ri-restart-line" /> {t('tournaments.resetBracketBtn')}
                      </button>
                  }
                  <button className={styles.btnGhost} onClick={() => router.push(`/tournaments/${tournament.slug || tournament.id}#matches`, { scroll: false })}>
                    <i className="ri-eye-line" /> {t('common.view')}
                  </button>
                </div>
                {bracketData?.rounds ? (
                  <div className={styles.card} style={{ padding: '14px 16px' }}>
                    <div className={styles.cardHead}>
                      <i className="ri-node-tree" style={{ color: '#6366f1', fontSize: 16 }} />
                      <span className={styles.cardTitle}>{t('tournaments.bracketEditor')}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        {t('tournaments.dragToSwapTapToRename')}
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
                ) : (
                  <div className={styles.card} style={{ padding: '18px 16px', textAlign: 'center' }}>
                    <i className="ri-node-tree" style={{ fontSize: 22, color: 'var(--text-muted)' }} />
                    <p style={{ margin: '8px 0 4px', fontWeight: 700 }}>{t('tournaments.noBracketYet')}</p>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('tournaments.generateFromButtonAbove')}</span>
                  </div>
                )}
                {unplaced.length > 0 && (
                  <div className={styles.unplacedCard}>
                    <div className={styles.unplacedHead}>{unplaced.length} {unplaced.length !== 1 ? t('tournaments.unplacedPlayers') : t('tournaments.unplacedPlayer')}</div>
                    {unplaced.map(p => (
                      <div key={p.user_id} className={styles.unplacedRow}>
                        <div className={styles.unplacedAvatar}>
                          <Avatar src={p.profiles?.avatar_url} name={p.profiles?.username} size={28} radius={7} />
                        </div>
                        <span className={styles.unplacedName}>{p.profiles?.username || t('tournaments.playerLabel')}</span>
                        <button className={styles.btnAdd} onClick={() => addToBracket(p)}>{t('tournaments.addToBracket')}</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ════ SETTINGS ════ */}
        {activeTab === 'settings' && editForm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Section toggle */}
            <div style={{ display: 'flex', background: 'var(--surface)', borderRadius: 12, padding: 4, gap: 4, border: '1px solid var(--border)' }}>
              {[
                { key: 'edit', label: t('tournaments.editDetails'), icon: 'ri-edit-line' },
                { key: 'danger', label: t('tournaments.advancedLabel'), icon: 'ri-error-warning-line' },
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
                  <span className={styles.cardTitle}>{t('tournaments.tournamentDetails')}</span>
                  <button onClick={saveEdit} disabled={editSaving} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 8, background: editSaved ? '#22c55e' : '#6366f1', color: '#fff', border: 'none', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                    {editSaving ? <><i className="ri-loader-4-line" /> {t('common.saving')}</> : editSaved ? <><i className="ri-check-line" /> {t('tournaments.savedLabel')}</> : <><i className="ri-save-line" /> {t('common.save')}</>}
                  </button>
                </div>

                {editError && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#ef444415', color: '#ef4444', fontSize: 12, fontWeight: 600, marginBottom: 12 }}><i className="ri-error-warning-line" /> {editError}</div>}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className={styles.field}>
                    <label>{t('tournaments.tournamentName')}</label>
                    <input value={editForm.name} onChange={e => setEF('name', e.target.value)} placeholder={t('tournaments.tournamentNameLower')} className={styles.input} />
                  </div>

                  <div className={styles.field}>
                    <label>{t('tournaments.descriptionLabel')}</label>
                    <textarea rows={3} value={editForm.description} onChange={e => setEF('description', e.target.value)} placeholder={t('tournaments.optionalRulesInfo')} className={styles.textarea} />
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <div className={styles.field} style={{ flex: 1 }}>
                      <label>{t('tournaments.gameLabel')}</label>
                      <select value={editForm.game_slug} onChange={e => setEF('game_slug', e.target.value)} className={styles.select}>
                        {GAME_SLUGS_MANAGE.map(s => <option key={s} value={s}>{GAME_NAMES_MANAGE[s]}</option>)}
                      </select>
                    </div>
                    <div className={styles.field} style={{ flex: 1 }}>
                      <label>{t('tournaments.format')}</label>
                      <select value={editForm.format} onChange={e => setEF('format', e.target.value)} className={styles.select}>
                        {FORMATS_MANAGE.map(f => <option key={f}>{f}</option>)}
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <div className={styles.field} style={{ flex: 1 }}>
                      <label>{t('tournaments.statusLabel')}</label>
                      <select value={editForm.status} onChange={e => setEF('status', e.target.value)} className={styles.select}>
                        {STATUSES_MANAGE.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className={styles.field} style={{ flex: 1 }}>
                      <label>{t('tournaments.dateLabel')}</label>
                      <input value={editForm.date} onChange={e => setEF('date', e.target.value)} placeholder={t('tournaments.egJun28')} className={styles.input} />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <div className={styles.field} style={{ flex: 1 }}>
                      <label>{t('tournaments.prizePoolTZS')}</label>
                      <input value={editForm.prize} onChange={e => setEF('prize', e.target.value)} placeholder={t('tournaments.eg500000')} className={styles.input} />
                    </div>
                    <div className={styles.field} style={{ flex: 1 }}>
                      <label>{t('tournaments.entryFeeTZS')}</label>
                      <input value={editForm.entrance_fee} onChange={e => setEF('entrance_fee', e.target.value)} placeholder={t('tournaments.leaveBlankFree')} className={styles.input} />
                    </div>
                  </div>

                  <div className={styles.field}>
                    <label>{t('tournaments.matchTypeLabel')}</label>
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
                        {t('tournaments.matchTypeChangedResetBracket')}
                      </p>
                    )}
                  </div>

                  <div className={styles.field}>
                    <label>{t('tournaments.slotsLabel')}</label>
                    <input type="number" value={editForm.slots} onChange={e => setEF('slots', e.target.value)} placeholder={t('tournaments.eg32')} className={styles.input} />
                  </div>

                  {/* Pro Only toggle */}
                  <button type="button" onClick={() => setEF('pro_only', !editForm.pro_only)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${editForm.pro_only ? '#a855f740' : 'var(--border)'}`, background: editForm.pro_only ? '#a855f710' : 'var(--surface)', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                    <i className={editForm.pro_only ? 'ri-vip-crown-fill' : 'ri-vip-crown-line'} style={{ color: editForm.pro_only ? '#a855f7' : 'var(--text-muted)', fontSize: 18 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: editForm.pro_only ? '#a855f7' : 'var(--text)' }}>{t('tournaments.proEliteOnly')}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{editForm.pro_only ? t('tournaments.onlyProEliteCanJoin') : t('tournaments.openToAllPlayers')}</div>
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
                    <i className="ri-swap-line" style={{ fontSize: 18 }} /> {t('tournaments.transferPlayers')}
                  </div>
                  <p className={styles.dangerSub}>
                    {t('tournaments.transferSubPrefix')} {participants.length} {t('tournaments.transferSubMiddle')} ({tournament?.team_size === 1 ? t('tournaments.soloMatchType') : t('tournaments.teamMatchType').replace('{size}', tournament?.team_size).replace('{size2}', tournament?.team_size)}).
                  </p>
                  {!showTransfer ? (
                    <button className={styles.btnPrimary} onClick={loadTransferTargets} disabled={participants.length === 0} style={{ opacity: participants.length === 0 ? 0.5 : 1 }}>
                      <i className="ri-swap-line" /> {t('tournaments.chooseDestination')}
                    </button>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {transferLoading && !transferTargets.length && (
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                          <i className="ri-loader-4-line" /> {t('tournaments.loadingTournaments')}
                        </div>
                      )}
                      {!transferLoading && !transferDone && transferTargets.length === 0 && (
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                          {t('tournaments.noMatchingTournaments')}
                        </div>
                      )}
                      {transferDone ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: '#22c55e15', border: '1px solid #22c55e30' }}>
                          <i className="ri-checkbox-circle-fill" style={{ color: '#22c55e', fontSize: 18 }} />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>{t('tournaments.transferComplete')}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                              {t('tournaments.playersMovedTo')} "{transferTargets.find(tt => tt.id === transferTarget)?.name}". {t('tournaments.theyWereNotified')}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          {transferTargets.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {transferTargets.map(target => {
                                const isFull = (target.registered_count || 0) >= (target.slots || 0)
                                const isSelected = transferTarget === target.id
                                return (
                                  <button key={target.id} onClick={() => setTransferTarget(isSelected ? null : target.id)} disabled={isFull}
                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${isSelected ? '#6366f1' : 'var(--border)'}`, background: isSelected ? '#6366f112' : 'var(--surface)', cursor: isFull ? 'not-allowed' : 'pointer', opacity: isFull ? 0.5 : 1, textAlign: 'left', width: '100%' }}>
                                    <i className="ri-tournament-line" style={{ color: isSelected ? '#6366f1' : 'var(--text-muted)', fontSize: 16, flexShrink: 0 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{target.name}</div>
                                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{target.registered_count || 0}/{target.slots} {t('players.players').toLowerCase()} · {target.status}{isFull && ` · ${t('tournaments.full').toUpperCase()}`}</div>
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
                              {transferLoading ? <><i className="ri-loader-4-line" /> {t('tournaments.transferringLabel')}</> : <><i className="ri-swap-line" /> {t('tournaments.transferNPlayers').replace('{count}', participants.length)}</>}
                            </button>
                            <button onClick={() => { setShowTransfer(false); setTransferTarget(null); setTransferDone(false) }}
                              style={{ padding: '10px 14px', borderRadius: 9, background: 'var(--surface)', border: '1.5px solid var(--border)', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', cursor: 'pointer' }}>
                              {t('common.cancel')}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Delete Tournament */}
                <div className={styles.dangerCard}>
                  <div className={styles.dangerHead}>
                    <i className="ri-error-warning-fill" style={{ fontSize: 18 }} /> {t('tournaments.dangerZone')}
                  </div>
                  <p className={styles.dangerSub}>
                    {t('tournaments.deleteTournamentWarning')}
                  </p>
                  <button className={styles.btnDangerFull} onClick={deleteTournament}>
                    <i className="ri-delete-bin-fill" style={{ fontSize: 18 }} /> {t('tournaments.deleteTournamentBtn')}
                  </button>
                </div>
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  )
}
