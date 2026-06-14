'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import { useAuth } from '../../../components/AuthProvider'
import { useAuthGate } from '../../../components/AuthGateModal'
import { supabase } from '../../../lib/supabase'
import { GAME_META } from '../../../lib/constants'
import styles from './page.module.css'
import DotsMenu from '../DotsMenu'
import FifaTutorial from '../FifaTutorial'

const ADMIN_EMAILS = ['stevenmsambwa8@gmail.com', 'nabogamingss1@gmail.com']
const FIFA_GAMES   = ['efootball', 'dls', 'ufl']
const GROUPS       = ['A','B','C','D','E','F','G','H','I','J','K','L']

const WC_TEAMS = [
  { id:'MEX', name:'Mexico',          flag:'mx', group:'A' },
  { id:'RSA', name:'South Africa',    flag:'za', group:'A' },
  { id:'KOR', name:'South Korea',     flag:'kr', group:'A' },
  { id:'CZE', name:'Czechia',         flag:'cz', group:'A' },
  { id:'CAN', name:'Canada',          flag:'ca', group:'B' },
  { id:'BIH', name:'Bosnia & Herz.',  flag:'ba', group:'B' },
  { id:'QAT', name:'Qatar',           flag:'qa', group:'B' },
  { id:'SUI', name:'Switzerland',     flag:'ch', group:'B' },
  { id:'ESP', name:'Spain',           flag:'es', group:'C' },
  { id:'CRO', name:'Croatia',         flag:'hr', group:'C' },
  { id:'MAR', name:'Morocco',         flag:'ma', group:'C' },
  { id:'BEL', name:'Belgium',         flag:'be', group:'C' },
  { id:'USA', name:'USA',             flag:'us', group:'D' },
  { id:'PAR', name:'Paraguay',        flag:'py', group:'D' },
  { id:'AUS', name:'Australia',       flag:'au', group:'D' },
  { id:'TUR', name:'Türkiye',         flag:'tr', group:'D' },
  { id:'GER', name:'Germany',         flag:'de', group:'E' },
  { id:'POR', name:'Portugal',        flag:'pt', group:'E' },
  { id:'COL', name:'Colombia',        flag:'co', group:'E' },
  { id:'ARG', name:'Argentina',       flag:'ar', group:'E' },
  { id:'BRA', name:'Brazil',          flag:'br', group:'F' },
  { id:'ECU', name:'Ecuador',         flag:'ec', group:'F' },
  { id:'NGA', name:'Nigeria',         flag:'ng', group:'F' },
  { id:'SWE', name:'Sweden',          flag:'se', group:'F' },
  { id:'FRA', name:'France',          flag:'fr', group:'G' },
  { id:'URU', name:'Uruguay',         flag:'uy', group:'G' },
  { id:'ALG', name:'Algeria',         flag:'dz', group:'G' },
  { id:'CHI', name:'Chile',           flag:'cl', group:'G' },
  { id:'NED', name:'Netherlands',     flag:'nl', group:'H' },
  { id:'SEN', name:'Senegal',         flag:'sn', group:'H' },
  { id:'IRN', name:'IR Iran',         flag:'ir', group:'H' },
  { id:'JPN', name:'Japan',           flag:'jp', group:'H' },
  { id:'ITA', name:'Italy',           flag:'it', group:'I' },
  { id:'VEN', name:'Venezuela',       flag:'ve', group:'I' },
  { id:'CIV', name:"Côte d'Ivoire",   flag:'ci', group:'I' },
  { id:'IRQ', name:'Iraq',            flag:'iq', group:'I' },
  { id:'ENG', name:'England',         flag:'gb-eng', group:'J' },
  { id:'EGY', name:'Egypt',           flag:'eg', group:'J' },
  { id:'UZB', name:'Uzbekistan',      flag:'uz', group:'J' },
  { id:'CDR', name:'DR Congo',        flag:'cd', group:'J' },
  { id:'GHA', name:'Ghana',           flag:'gh', group:'K' },
  { id:'SKA', name:'Slovakia',        flag:'sk', group:'K' },
  { id:'CPV', name:'Cape Verde',      flag:'cv', group:'K' },
  { id:'CUR', name:'Curaçao',         flag:'cw', group:'K' },
  { id:'SRB', name:'Serbia',          flag:'rs', group:'L' },
  { id:'SAU', name:'Saudi Arabia',    flag:'sa', group:'L' },
  { id:'DEN', name:'Denmark',         flag:'dk', group:'L' },
  { id:'GRE', name:'Greece',          flag:'gr', group:'L' },
]

// Group stage — 72 matches
const GROUP_FIXTURES = [
  { id:'A1', group:'A', md:1, date:'2026-06-11', time:'15:00', home:'MEX', away:'RSA', venue:'Estadio Azteca, Mexico City' },
  { id:'A2', group:'A', md:1, date:'2026-06-11', time:'22:00', home:'KOR', away:'CZE', venue:'Estadio Akron, Guadalajara' },
  { id:'A3', group:'A', md:2, date:'2026-06-15', time:'21:00', home:'MEX', away:'KOR', venue:'Estadio Azteca, Mexico City' },
  { id:'A4', group:'A', md:2, date:'2026-06-16', time:'00:00', home:'RSA', away:'CZE', venue:'Estadio Akron, Guadalajara' },
  { id:'A5', group:'A', md:3, date:'2026-06-19', time:'21:00', home:'MEX', away:'CZE', venue:'Estadio Azteca, Mexico City' },
  { id:'A6', group:'A', md:3, date:'2026-06-19', time:'21:00', home:'RSA', away:'KOR', venue:'Estadio Akron, Guadalajara' },
  { id:'B1', group:'B', md:1, date:'2026-06-12', time:'15:00', home:'CAN', away:'BIH', venue:'BMO Field, Toronto' },
  { id:'B2', group:'B', md:1, date:'2026-06-13', time:'15:00', home:'QAT', away:'SUI', venue:'Estadio BBVA, Monterrey' },
  { id:'B3', group:'B', md:2, date:'2026-06-17', time:'18:00', home:'CAN', away:'QAT', venue:'BC Place, Vancouver' },
  { id:'B4', group:'B', md:2, date:'2026-06-17', time:'21:00', home:'BIH', away:'SUI', venue:'Estadio BBVA, Monterrey' },
  { id:'B5', group:'B', md:3, date:'2026-06-21', time:'21:00', home:'CAN', away:'SUI', venue:'BMO Field, Toronto' },
  { id:'B6', group:'B', md:3, date:'2026-06-21', time:'21:00', home:'BIH', away:'QAT', venue:'Estadio BBVA, Monterrey' },
  { id:'C1', group:'C', md:1, date:'2026-06-13', time:'18:00', home:'ESP', away:'CRO', venue:'Hard Rock Stadium, Miami' },
  { id:'C2', group:'C', md:1, date:'2026-06-13', time:'21:00', home:'MAR', away:'BEL', venue:'Lincoln Financial, Philadelphia' },
  { id:'C3', group:'C', md:2, date:'2026-06-17', time:'15:00', home:'ESP', away:'MAR', venue:'MetLife Stadium, New York' },
  { id:'C4', group:'C', md:2, date:'2026-06-18', time:'00:00', home:'CRO', away:'BEL', venue:'AT&T Stadium, Dallas' },
  { id:'C5', group:'C', md:3, date:'2026-06-22', time:'21:00', home:'ESP', away:'BEL', venue:'Hard Rock Stadium, Miami' },
  { id:'C6', group:'C', md:3, date:'2026-06-22', time:'21:00', home:'CRO', away:'MAR', venue:'Lincoln Financial, Philadelphia' },
  { id:'D1', group:'D', md:1, date:'2026-06-12', time:'21:00', home:'USA', away:'PAR', venue:'SoFi Stadium, Los Angeles' },
  { id:'D2', group:'D', md:1, date:'2026-06-13', time:'21:00', home:'AUS', away:'TUR', venue:'Lumen Field, Seattle' },
  { id:'D3', group:'D', md:2, date:'2026-06-19', time:'18:00', home:'USA', away:'AUS', venue:'Lumen Field, Seattle' },
  { id:'D4', group:'D', md:2, date:'2026-06-19', time:'18:00', home:'PAR', away:'TUR', venue:'SoFi Stadium, Los Angeles' },
  { id:'D5', group:'D', md:3, date:'2026-06-25', time:'21:00', home:'USA', away:'TUR', venue:'SoFi Stadium, Los Angeles' },
  { id:'D6', group:'D', md:3, date:'2026-06-25', time:'21:00', home:'PAR', away:'AUS', venue:'Lumen Field, Seattle' },
  { id:'E1', group:'E', md:1, date:'2026-06-14', time:'15:00', home:'GER', away:'COL', venue:'Gillette Stadium, Boston' },
  { id:'E2', group:'E', md:1, date:'2026-06-14', time:'21:00', home:'POR', away:'ARG', venue:'NRG Stadium, Houston' },
  { id:'E3', group:'E', md:2, date:'2026-06-18', time:'18:00', home:'GER', away:'POR', venue:"Levi's Stadium, San Francisco" },
  { id:'E4', group:'E', md:2, date:'2026-06-18', time:'21:00', home:'COL', away:'ARG', venue:'AT&T Stadium, Dallas' },
  { id:'E5', group:'E', md:3, date:'2026-06-23', time:'21:00', home:'GER', away:'ARG', venue:'Gillette Stadium, Boston' },
  { id:'E6', group:'E', md:3, date:'2026-06-23', time:'21:00', home:'POR', away:'COL', venue:'NRG Stadium, Houston' },
  { id:'F1', group:'F', md:1, date:'2026-06-14', time:'18:00', home:'BRA', away:'ECU', venue:'Rose Bowl, Los Angeles' },
  { id:'F2', group:'F', md:1, date:'2026-06-15', time:'00:00', home:'NGA', away:'SWE', venue:'Arrowhead Stadium, Kansas City' },
  { id:'F3', group:'F', md:2, date:'2026-06-18', time:'15:00', home:'BRA', away:'NGA', venue:'Rose Bowl, Los Angeles' },
  { id:'F4', group:'F', md:2, date:'2026-06-19', time:'00:00', home:'ECU', away:'SWE', venue:'Arrowhead Stadium, Kansas City' },
  { id:'F5', group:'F', md:3, date:'2026-06-23', time:'18:00', home:'BRA', away:'SWE', venue:'Rose Bowl, Los Angeles' },
  { id:'F6', group:'F', md:3, date:'2026-06-23', time:'18:00', home:'ECU', away:'NGA', venue:'Arrowhead Stadium, Kansas City' },
  { id:'G1', group:'G', md:1, date:'2026-06-15', time:'15:00', home:'FRA', away:'ALG', venue:'Mercedes-Benz Stadium, Atlanta' },
  { id:'G2', group:'G', md:1, date:'2026-06-15', time:'21:00', home:'URU', away:'CHI', venue:'SoFi Stadium, Los Angeles' },
  { id:'G3', group:'G', md:2, date:'2026-06-20', time:'18:00', home:'FRA', away:'URU', venue:'MetLife Stadium, New York' },
  { id:'G4', group:'G', md:2, date:'2026-06-20', time:'21:00', home:'ALG', away:'CHI', venue:'NRG Stadium, Houston' },
  { id:'G5', group:'G', md:3, date:'2026-06-24', time:'21:00', home:'FRA', away:'CHI', venue:'Mercedes-Benz Stadium, Atlanta' },
  { id:'G6', group:'G', md:3, date:'2026-06-24', time:'21:00', home:'ALG', away:'URU', venue:'SoFi Stadium, Los Angeles' },
  { id:'H1', group:'H', md:1, date:'2026-06-15', time:'18:00', home:'NED', away:'IRN', venue:'Lumen Field, Seattle' },
  { id:'H2', group:'H', md:1, date:'2026-06-16', time:'00:00', home:'SEN', away:'JPN', venue:"Levi's Stadium, San Francisco" },
  { id:'H3', group:'H', md:2, date:'2026-06-20', time:'15:00', home:'NED', away:'SEN', venue:'AT&T Stadium, Dallas' },
  { id:'H4', group:'H', md:2, date:'2026-06-21', time:'00:00', home:'IRN', away:'JPN', venue:'Lumen Field, Seattle' },
  { id:'H5', group:'H', md:3, date:'2026-06-25', time:'18:00', home:'NED', away:'JPN', venue:"Levi's Stadium, San Francisco" },
  { id:'H6', group:'H', md:3, date:'2026-06-25', time:'18:00', home:'IRN', away:'SEN', venue:'AT&T Stadium, Dallas' },
  { id:'I1', group:'I', md:1, date:'2026-06-16', time:'18:00', home:'ITA', away:'CIV', venue:'Hard Rock Stadium, Miami' },
  { id:'I2', group:'I', md:1, date:'2026-06-16', time:'21:00', home:'VEN', away:'IRQ', venue:'Gillette Stadium, Boston' },
  { id:'I3', group:'I', md:2, date:'2026-06-21', time:'15:00', home:'ITA', away:'VEN', venue:'Hard Rock Stadium, Miami' },
  { id:'I4', group:'I', md:2, date:'2026-06-21', time:'18:00', home:'CIV', away:'IRQ', venue:'Gillette Stadium, Boston' },
  { id:'I5', group:'I', md:3, date:'2026-06-26', time:'21:00', home:'ITA', away:'IRQ', venue:'Hard Rock Stadium, Miami' },
  { id:'I6', group:'I', md:3, date:'2026-06-26', time:'21:00', home:'CIV', away:'VEN', venue:'Gillette Stadium, Boston' },
  { id:'J1', group:'J', md:1, date:'2026-06-16', time:'15:00', home:'ENG', away:'EGY', venue:'Lincoln Financial, Philadelphia' },
  { id:'J2', group:'J', md:1, date:'2026-06-17', time:'00:00', home:'UZB', away:'CDR', venue:'Mercedes-Benz Stadium, Atlanta' },
  { id:'J3', group:'J', md:2, date:'2026-06-21', time:'21:00', home:'ENG', away:'UZB', venue:'Lincoln Financial, Philadelphia' },
  { id:'J4', group:'J', md:2, date:'2026-06-22', time:'00:00', home:'EGY', away:'CDR', venue:'Mercedes-Benz Stadium, Atlanta' },
  { id:'J5', group:'J', md:3, date:'2026-06-26', time:'18:00', home:'ENG', away:'CDR', venue:'Lincoln Financial, Philadelphia' },
  { id:'J6', group:'J', md:3, date:'2026-06-26', time:'18:00', home:'EGY', away:'UZB', venue:'Mercedes-Benz Stadium, Atlanta' },
  { id:'K1', group:'K', md:1, date:'2026-06-17', time:'18:00', home:'GHA', away:'SKA', venue:'AT&T Stadium, Dallas' },
  { id:'K2', group:'K', md:1, date:'2026-06-17', time:'21:00', home:'CPV', away:'CUR', venue:'Arrowhead Stadium, Kansas City' },
  { id:'K3', group:'K', md:2, date:'2026-06-22', time:'15:00', home:'GHA', away:'CPV', venue:'AT&T Stadium, Dallas' },
  { id:'K4', group:'K', md:2, date:'2026-06-22', time:'18:00', home:'SKA', away:'CUR', venue:'Arrowhead Stadium, Kansas City' },
  { id:'K5', group:'K', md:3, date:'2026-06-27', time:'21:00', home:'GHA', away:'CUR', venue:'AT&T Stadium, Dallas' },
  { id:'K6', group:'K', md:3, date:'2026-06-27', time:'21:00', home:'SKA', away:'CPV', venue:'Arrowhead Stadium, Kansas City' },
  { id:'L1', group:'L', md:1, date:'2026-06-18', time:'18:00', home:'SRB', away:'SAU', venue:'Rose Bowl, Los Angeles' },
  { id:'L2', group:'L', md:1, date:'2026-06-18', time:'21:00', home:'DEN', away:'GRE', venue:'BC Place, Vancouver' },
  { id:'L3', group:'L', md:2, date:'2026-06-23', time:'15:00', home:'SRB', away:'DEN', venue:'Rose Bowl, Los Angeles' },
  { id:'L4', group:'L', md:2, date:'2026-06-23', time:'15:00', home:'SAU', away:'GRE', venue:'BC Place, Vancouver' },
  { id:'L5', group:'L', md:3, date:'2026-06-27', time:'18:00', home:'SRB', away:'GRE', venue:'Rose Bowl, Los Angeles' },
  { id:'L6', group:'L', md:3, date:'2026-06-27', time:'18:00', home:'SAU', away:'DEN', venue:'BC Place, Vancouver' },
]

// Knockout rounds — 32 slots (TBD until admin fills from standings)
// IDs prefixed 'R32_', 'R16_', 'QF_', 'SF_', 'F_'
const KNOCKOUT_STAGES = [
  { stage: 'R32', label: 'Round of 32', slots: 16 },
  { stage: 'R16', label: 'Round of 16', slots: 8 },
  { stage: 'QF',  label: 'Quarter-finals', slots: 4 },
  { stage: 'SF',  label: 'Semi-finals', slots: 2 },
  { stage: 'F',   label: 'Final', slots: 1 },
]

const teamById = Object.fromEntries(WC_TEAMS.map(t => [t.id, t]))

function fmtDate(str) {
  const d = new Date(str + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
}

function Flag({ code, name, size = 28 }) {
  const [err, setErr] = useState(false)
  if (!code || err) return (
    <div style={{ width:size, height:Math.round(size*0.7), borderRadius:3, background:'var(--bg-2)', border:'1px solid var(--border)', flexShrink:0 }} />
  )
  return (
    <img src={`https://flagcdn.com/w40/${code}.png`} alt={name} width={size} height={Math.round(size*0.7)}
      style={{ width:size, height:Math.round(size*0.7), objectFit:'cover', borderRadius:3, flexShrink:0 }}
      onError={() => setErr(true)}
    />
  )
}

function Avatar({ src, name, size = 28 }) {
  if (src) return (
    <img src={src} alt={name} width={size} height={size}
      style={{ width:size, height:size, borderRadius:'50%', objectFit:'cover', flexShrink:0 }}
      onError={e => e.target.style.display='none'}
    />
  )
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:'var(--accent)', color:'#fff',
      fontSize:size*0.4, fontWeight:800, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center'
    }}>{name?.[0]?.toUpperCase()||'?'}</div>
  )
}

// Compute standings for a group from posted scores
function computeStandings(group, scores) {
  const rows = Object.fromEntries(
    WC_TEAMS.filter(t => t.group === group)
      .map(t => [t.id, { ...t, mp:0, w:0, d:0, l:0, gf:0, ga:0, gd:0, pts:0 }])
  )
  GROUP_FIXTURES.filter(f => f.group === group).forEach(f => {
    const s = scores[f.id]
    if (s == null || s.home == null || s.away == null) return
    const h = s.home, a = s.away
    rows[f.home].mp++; rows[f.away].mp++
    rows[f.home].gf += h; rows[f.home].ga += a
    rows[f.away].gf += a; rows[f.away].ga += h
    if (h > a)      { rows[f.home].w++; rows[f.home].pts += 3; rows[f.away].l++ }
    else if (h < a) { rows[f.away].w++; rows[f.away].pts += 3; rows[f.home].l++ }
    else            { rows[f.home].d++; rows[f.home].pts++; rows[f.away].d++; rows[f.away].pts++ }
  })
  Object.values(rows).forEach(r => { r.gd = r.gf - r.ga })
  return Object.values(rows).sort((a,b) => b.pts-a.pts || b.gd-a.gd || b.gf-a.gf)
}

export default function FIFA26GamePage() {
  const params   = useParams()
  const router   = useRouter()
  const { user, isAdmin } = useAuth()
  const { openAuthGate } = useAuthGate()
  const gameSlug = params?.game

  if (!FIFA_GAMES.includes(gameSlug)) return notFound()

  const meta        = GAME_META[gameSlug]
  const userIsAdmin = isAdmin || ADMIN_EMAILS.includes(user?.email)

  const [tab, setTab]                       = useState('fixtures')
  const [fixtureGroup, setFixtureGroup]     = useState('all')
  const [fixtureMd, setFixtureMd]           = useState('all')
  const [fixtureStage, setFixtureStage]     = useState('group') // 'group' | knockout stage id
  const [standingsGroup, setStandingsGroup] = useState('A')

  // Picks
  const [myPick, setMyPick]     = useState(null)
  const [allPicks, setAllPicks] = useState({})
  const [pickMsg, setPickMsg]   = useState('')
  const [teamDetail, setTeamDetail]   = useState(null)
  const [dropConfirm, setDropConfirm] = useState(false)
  const [dropping, setDropping]       = useState(false)

  // Scores — { [fixture_id]: { home, away } }
  const [scores, setScores]         = useState({})
  const [scoreModal, setScoreModal] = useState(null) // fixture being edited
  const [scoreInput, setScoreInput] = useState({ home:'', away:'' })
  const [scoreSaving, setScoreSaving]   = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null) // fixture to delete

  // Knockout fixtures — stored in DB, keyed by game_slug + stage
  const [knockoutFixtures, setKnockoutFixtures] = useState([]) // [{id, stage, matchNum, home, away}]
  const [knockoutScores, setKnockoutScores]     = useState({}) // {[id]: {home, away}}

  // ── Load picks ─────────────────────────────────────────────────────────────
  const loadPicks = useCallback(async () => {
    // Step 1: get all picks for this game
    const { data: picks, error } = await supabase
      .from('fifa26_picks')
      .select('team_id, user_id')
      .eq('game_slug', gameSlug)

    if (error) {
      console.error('loadPicks error:', error)
      return
    }
    if (!picks || picks.length === 0) {
      setAllPicks({})
      return
    }

    // Step 2: get profiles for all those user_ids
    const userIds = picks.map(p => p.user_id)
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .in('id', userIds)

    const profileMap = {}
    ;(profiles || []).forEach(p => { profileMap[p.id] = p })

    // Step 3: build allPicks map keyed by team_id
    const map = {}
    picks.forEach(p => {
      const prof = profileMap[p.user_id]
      map[p.team_id] = {
        username: prof?.username || 'Player',
        avatar_url: prof?.avatar_url || null,
        user_id: p.user_id,
      }
    })
    setAllPicks(map)

    // Set myPick
    if (user) {
      const mine = picks.find(p => p.user_id === user.id)
      if (mine) setMyPick(mine.team_id)
    }
  }, [gameSlug, user])

  // ── Load group stage scores ────────────────────────────────────────────────
  const loadScores = useCallback(async () => {
    const { data } = await supabase
      .from('fifa26_scores')
      .select('fixture_id, home_score, away_score')
      .eq('game_slug', gameSlug)
    if (!data) return
    const map = {}
    data.forEach(s => { map[s.fixture_id] = { home: s.home_score, away: s.away_score } })
    setScores(map)
  }, [gameSlug])

  // ── Load knockout fixtures + scores ───────────────────────────────────────
  const loadKnockout = useCallback(async () => {
    const { data } = await supabase
      .from('fifa26_knockout')
      .select('*')
      .eq('game_slug', gameSlug)
      .order('stage_order', { ascending: true })
    if (!data) return
    setKnockoutFixtures(data)
    const map = {}
    data.forEach(f => {
      if (f.home_score != null && f.away_score != null)
        map[f.id] = { home: f.home_score, away: f.away_score }
    })
    setKnockoutScores(map)
  }, [gameSlug])

  // Load picks + subscribe to realtime changes so all users see picks instantly
  useEffect(() => {
    loadPicks()

    // Realtime subscription — fires whenever any row in fifa26_picks changes for this game
    const channel = supabase
      .channel(`fifa26_picks_${gameSlug}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fifa26_picks', filter: `game_slug=eq.${gameSlug}` },
        async (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const { team_id, user_id } = payload.new
            const { data: prof } = await supabase
              .from('profiles')
              .select('username, avatar_url')
              .eq('id', user_id)
              .maybeSingle()
            setAllPicks(prev => ({
              ...prev,
              [team_id]: {
                username: prof?.username || 'Player',
                avatar_url: prof?.avatar_url || null,
                user_id,
              }
            }))
          } else if (payload.eventType === 'DELETE') {
            const { team_id } = payload.old
            setAllPicks(prev => { const n = { ...prev }; delete n[team_id]; return n })
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [gameSlug, loadPicks])

  // Re-fetch myPick specifically when user session becomes available after refresh
  useEffect(() => {
    if (!user) return
    supabase
      .from('fifa26_picks')
      .select('team_id')
      .eq('user_id', user.id)
      .eq('game_slug', gameSlug)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.team_id) setMyPick(data.team_id)
      })
  }, [user?.id, gameSlug])

  useEffect(() => { loadScores() }, [loadScores])
  useEffect(() => { loadKnockout() }, [loadKnockout])

  // ── Pick team ──────────────────────────────────────────────────────────────
  async function pickTeam(teamId) {
    if (!user) { openAuthGate(); return }
    if (myPick) return
    // First delete any existing pick for this user+game (clean slate)
    await supabase.from('fifa26_picks')
      .delete()
      .eq('user_id', user.id)
      .eq('game_slug', gameSlug)

    const { error } = await supabase.from('fifa26_picks').insert({
      user_id: user.id,
      team_id: teamId,
      game_slug: gameSlug,
    })

    if (error) {
      console.error('pickTeam error:', error)
      setPickMsg(`Error: ${error.message} (${error.code})`)
      setTimeout(() => setPickMsg(''), 6000)
      setPickSaving(false)
      return
    }

    setMyPick(teamId)
    const { data: prof } = await supabase
      .from('profiles')
      .select('username, avatar_url')
      .eq('id', user.id)
      .maybeSingle()
    setAllPicks(prev => ({
      ...prev,
      [teamId]: { username: prof?.username || 'You', avatar_url: prof?.avatar_url || null }
    }))
    setPickMsg(`Backing ${teamById[teamId]?.name}!`)
    setTimeout(() => setPickMsg(''), 3000)
  }

  // ── Drop pick ──────────────────────────────────────────────────────────────
  async function dropPick() {
    if (!user || !myPick) return
    setDropping(true)
    const { error } = await supabase.from('fifa26_picks')
      .delete().eq('user_id', user.id).eq('game_slug', gameSlug)
    if (!error) {
      setAllPicks(prev => { const n = { ...prev }; delete n[myPick]; return n })
      setMyPick(null)
      setPickMsg('Pick dropped.')
      setTimeout(() => setPickMsg(''), 3000)
    }
    setDropping(false)
    setDropConfirm(false)
  }

  // ── Save score ─────────────────────────────────────────────────────────────
  async function saveScore() {
    if (!scoreModal) return
    setScoreSaving(true)
    const h = Number(scoreInput.home)
    const a = Number(scoreInput.away)

    if (scoreModal._knockout) {
      // Knockout fixture
      const { error } = await supabase.from('fifa26_knockout')
        .update({ home_score: h, away_score: a })
        .eq('id', scoreModal.id)
      if (!error) {
        setKnockoutScores(prev => ({ ...prev, [scoreModal.id]: { home: h, away: a } }))
        // Auto-advance winner to next round
        await advanceKnockoutWinner(scoreModal, h, a)
        await loadKnockout()
      }
    } else {
      // Group stage fixture
      const { error } = await supabase.from('fifa26_scores').upsert(
        { fixture_id: scoreModal.id, game_slug: gameSlug, home_score: h, away_score: a },
        { onConflict: 'fixture_id,game_slug' }
      )
      if (!error) setScores(prev => ({ ...prev, [scoreModal.id]: { home: h, away: a } }))
    }
    setScoreModal(null)
    setScoreSaving(false)
  }

  // ── Delete / reset score ───────────────────────────────────────────────────
  async function deleteScore(fixture) {
    if (fixture._knockout) {
      await supabase.from('fifa26_knockout')
        .update({ home_score: null, away_score: null })
        .eq('id', fixture.id)
      setKnockoutScores(prev => { const n = { ...prev }; delete n[fixture.id]; return n })
      await loadKnockout()
    } else {
      await supabase.from('fifa26_scores')
        .delete()
        .eq('fixture_id', fixture.id)
        .eq('game_slug', gameSlug)
      setScores(prev => { const n = { ...prev }; delete n[fixture.id]; return n })
    }
    setDeleteConfirm(null)
  }

  // ── Advance knockout winner ────────────────────────────────────────────────
  async function advanceKnockoutWinner(fixture, h, a) {
    if (h === a) return // draw — admin must post again with a winner (penalty shootout etc.)
    const winner = h > a ? fixture.home : fixture.away
    if (!winner || winner === 'TBD') return

    // Find next round fixture this winner should go to
    const stageOrder = KNOCKOUT_STAGES.map(s => s.stage)
    const curIdx = stageOrder.indexOf(fixture.stage)
    if (curIdx === -1 || curIdx >= stageOrder.length - 1) return
    const nextStage = stageOrder[curIdx + 1]

    // Slot in next round: match_num determines position
    const nextMatchNum = Math.ceil(fixture.match_num / 2)
    const slot = fixture.match_num % 2 === 1 ? 'home' : 'away'

    const { data: nextMatch } = await supabase
      .from('fifa26_knockout')
      .select('*')
      .eq('game_slug', gameSlug)
      .eq('stage', nextStage)
      .eq('match_num', nextMatchNum)
      .maybeSingle()

    if (nextMatch) {
      await supabase.from('fifa26_knockout')
        .update({ [slot]: winner })
        .eq('id', nextMatch.id)
    }
  }

  // ── Generate Round of 32 from standings ───────────────────────────────────
  async function generateR32() {
    // Each group: top 2 qualify. 24 qualifiers + 8 best 3rd-place teams = 32.
    // For simplicity: top 2 from each group = 24, then admin manually seeds remaining 8.
    // We generate the 16 R32 matches with top2 from each group in standard WC pairing.
    const qualifiers = {}
    GROUPS.forEach(g => {
      const st = computeStandings(g, scores)
      qualifiers[g] = [st[0]?.id, st[1]?.id, st[2]?.id] // top 3 (3rd place for best-3rd)
    })

    // Standard FIFA 2026 R32 pairings (group winners vs runners-up from other groups)
    // Simplified pairing: A1 vs B2, B1 vs A2, C1 vs D2, D1 vs C2, etc.
    const pairs = [
      [qualifiers.A?.[0], qualifiers.B?.[1]],
      [qualifiers.B?.[0], qualifiers.A?.[1]],
      [qualifiers.C?.[0], qualifiers.D?.[1]],
      [qualifiers.D?.[0], qualifiers.C?.[1]],
      [qualifiers.E?.[0], qualifiers.F?.[1]],
      [qualifiers.F?.[0], qualifiers.E?.[1]],
      [qualifiers.G?.[0], qualifiers.H?.[1]],
      [qualifiers.H?.[0], qualifiers.G?.[1]],
      [qualifiers.I?.[0], qualifiers.J?.[1]],
      [qualifiers.J?.[0], qualifiers.I?.[1]],
      [qualifiers.K?.[0], qualifiers.L?.[1]],
      [qualifiers.L?.[0], qualifiers.K?.[1]],
      // Last 4 use best 3rd-place teams — seeded by admin
      ['TBD', 'TBD'],
      ['TBD', 'TBD'],
      ['TBD', 'TBD'],
      ['TBD', 'TBD'],
    ]

    // Delete existing knockout data for this game
    await supabase.from('fifa26_knockout').delete().eq('game_slug', gameSlug)

    // Insert R32 matches
    const r32Rows = pairs.map(([home, away], i) => ({
      game_slug: gameSlug,
      stage: 'R32',
      stage_order: 1,
      match_num: i + 1,
      home: home || 'TBD',
      away: away || 'TBD',
      home_score: null,
      away_score: null,
    }))

    // Insert stub rows for later rounds
    const laterRows = []
    const stages = [
      { stage:'R16', stage_order:2, count:8 },
      { stage:'QF',  stage_order:3, count:4 },
      { stage:'SF',  stage_order:4, count:2 },
      { stage:'F',   stage_order:5, count:1 },
    ]
    stages.forEach(({ stage, stage_order, count }) => {
      for (let i = 1; i <= count; i++) {
        laterRows.push({ game_slug: gameSlug, stage, stage_order, match_num: i, home: 'TBD', away: 'TBD', home_score: null, away_score: null })
      }
    })

    await supabase.from('fifa26_knockout').insert([...r32Rows, ...laterRows])
    await loadKnockout()
  }

  // ── Computed data ──────────────────────────────────────────────────────────
  const myTeam = teamById[myPick]
  const groupedTeams = GROUPS.reduce((acc, g) => {
    acc[g] = WC_TEAMS.filter(t => t.group === g); return acc
  }, {})

  // Group stage fixture filtering
  const filteredGroupFixtures = GROUP_FIXTURES.filter(f =>
    (fixtureGroup === 'all' || f.group === fixtureGroup) &&
    (fixtureMd    === 'all' || f.md === Number(fixtureMd))
  )
  const byDate = filteredGroupFixtures.reduce((acc, f) => {
    if (!acc[f.date]) acc[f.date] = []
    acc[f.date].push(f)
    return acc
  }, {})
  const sortedDates = Object.keys(byDate).sort()

  // Knockout fixtures by stage
  const knockoutByStage = knockoutFixtures.reduce((acc, f) => {
    if (!acc[f.stage]) acc[f.stage] = []
    acc[f.stage].push(f)
    return acc
  }, {})

  const groupStageComplete = GROUPS.every(g =>
    GROUP_FIXTURES.filter(f => f.group === g && f.md === 3)
      .every(f => scores[f.id] != null)
  )

  return (
    <div className={styles.page}>

      {/* Header */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.push('/fifa26')}>Back</button>
        <div className={styles.headerCenter}>
          <Image src={meta.image} alt={meta.name} width={34} height={34}
            style={{ objectFit:'contain', borderRadius:8, flexShrink:0 }} />
          <div>
            <div className={styles.headerName}>{meta.name}</div>
            <div className={styles.headerSub}>World Cup 2026</div>
          </div>
        </div>
        {myTeam && (
          <div className={styles.myPickChip}>
            <Flag code={myTeam.flag} name={myTeam.name} size={18} />
            <span>{myTeam.name}</span>
          </div>
        )}
        <DotsMenu gameSlug={gameSlug} gameName={meta.name} />
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {[
          { key:'fixtures', label:'Fixtures' },
          { key:'table',    label:'Table' },
          { key:'teams',    label:'Pick Team' },
        ].map(({ key, label }) => (
          <button key={key}
            className={`${styles.tab} ${tab===key?styles.tabActive:''}`}
            onClick={() => setTab(key)}
          >{label}</button>
        ))}
      </div>

      {pickMsg && <div className={styles.pickMsg}>{pickMsg}</div>}

      {/* ── FIXTURES ── */}
      {tab === 'fixtures' && (
        <div className={styles.section}>

          {/* Stage selector */}
          <div className={styles.stageRow}>
            <button
              className={`${styles.stageBtn} ${fixtureStage==='group'?styles.stageBtnActive:''}`}
              onClick={() => setFixtureStage('group')}
            >Group Stage</button>
            {KNOCKOUT_STAGES.map(s => (
              <button key={s.stage}
                className={`${styles.stageBtn} ${fixtureStage===s.stage?styles.stageBtnActive:''}`}
                onClick={() => setFixtureStage(s.stage)}
              >{s.label}</button>
            ))}
          </div>

          {/* GROUP STAGE */}
          {fixtureStage === 'group' && (
            <>
              <div className={styles.pills}>
                {['all',...GROUPS].map(g => (
                  <button key={g}
                    className={`${styles.pill} ${fixtureGroup===g?styles.pillActive:''}`}
                    onClick={() => setFixtureGroup(g)}
                  >{g==='all'?'All':`Grp ${g}`}</button>
                ))}
              </div>
              <div className={styles.mdFilter}>
                {['all','1','2','3'].map(m => (
                  <button key={m}
                    className={`${styles.mdBtn} ${fixtureMd===m?styles.mdBtnActive:''}`}
                    onClick={() => setFixtureMd(m)}
                  >{m==='all'?'All days':`Matchday ${m}`}</button>
                ))}
              </div>

              {sortedDates.length === 0 && (
                <div className={styles.empty}>
                  <div className={styles.emptyIcon} />
                  <p>No fixtures found.</p>
                </div>
              )}

              {sortedDates.map(date => (
                <div key={date} className={styles.dayBlock}>
                  <div className={styles.dayLabel}>{fmtDate(date)}</div>
                  {byDate[date].map(f => {
                    const hTeam    = teamById[f.home]
                    const aTeam    = teamById[f.away]
                    const s        = scores[f.id]
                    const hasScore = s != null && s.home != null && s.away != null
                    const isMyHome = myPick === f.home
                    const isMyAway = myPick === f.away
                    const hPick    = allPicks[f.home]
                    const aPick    = allPicks[f.away]
                    return (
                      <div key={f.id} className={`${styles.matchCard} ${hasScore?styles.matchCardDone:''} ${isMyHome||isMyAway?styles.matchCardMine:''}`}>
                        <span className={styles.matchGroup}>Group {f.group} · MD{f.md}</span>
                        <div className={styles.matchRow}>
                          <div className={styles.matchTeam}>
                            <Flag code={hTeam?.flag} name={hTeam?.name} size={28} />
                            <span className={styles.matchName}>{hTeam?.name||f.home}</span>
                            {isMyHome && <span className={styles.myPickDot} />}
                          </div>
                          <div className={styles.matchMid}>
                            {hasScore
                              ? <span className={styles.scoreResult}>{s.home} – {s.away}</span>
                              : <span className={styles.matchKO}>{f.time}</span>
                            }
                            {hasScore && <span className={styles.ftBadge}>FT</span>}
                          </div>
                          <div className={`${styles.matchTeam} ${styles.matchTeamR}`}>
                            <Flag code={aTeam?.flag} name={aTeam?.name} size={28} />
                            <span className={styles.matchName}>{aTeam?.name||f.away}</span>
                            {isMyAway && <span className={styles.myPickDot} />}
                          </div>
                        </div>
                        <div className={styles.matchVenue}>{f.venue}</div>
                        {userIsAdmin && (
                          <div className={styles.adminRow}>
                            <button className={styles.postScoreBtn}
                              onClick={() => { setScoreModal(f); setScoreInput({ home: s?.home??'', away: s?.away??'' }) }}
                            >{hasScore?'Edit score':'Post score'}</button>
                            {hasScore && (
                              <button className={styles.deleteScoreBtn}
                                onClick={() => setDeleteConfirm(f)}
                              >Reset</button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </>
          )}

          {/* KNOCKOUT STAGES */}
          {fixtureStage !== 'group' && (
            <>
              {userIsAdmin && fixtureStage === 'R32' && (
                <div className={styles.adminBar}>
                  <span className={styles.adminLabel}>Admin</span>
                  <button className={styles.generateBtn} onClick={generateR32}
                    disabled={!groupStageComplete}
                    title={!groupStageComplete ? 'Post all group stage scores first' : ''}
                  >
                    {knockoutFixtures.length ? 'Regenerate R32' : 'Generate Round of 32'}
                  </button>
                  {!groupStageComplete && (
                    <span className={styles.adminHint}>Complete group stage first</span>
                  )}
                </div>
              )}

              {(knockoutByStage[fixtureStage] || []).length === 0 ? (
                <div className={styles.empty}>
                  <div className={styles.emptyIcon} />
                  <p>
                    {fixtureStage === 'R32'
                      ? groupStageComplete
                        ? 'Generate the Round of 32 above.'
                        : 'Group stage must be completed first.'
                      : 'Fixtures will appear once the previous round is complete.'}
                  </p>
                </div>
              ) : (
                <div className={styles.knockoutList}>
                  {(knockoutByStage[fixtureStage] || []).map(f => {
                    const hTeam    = teamById[f.home]
                    const aTeam    = teamById[f.away]
                    const s        = knockoutScores[f.id]
                    const hasScore = s != null && s.home != null && s.away != null
                    const hPick    = allPicks[f.home]
                    const aPick    = allPicks[f.away]
                    const isTbd    = f.home === 'TBD' || f.away === 'TBD'
                    return (
                      <div key={f.id} className={`${styles.matchCard} ${hasScore?styles.matchCardDone:''} ${isTbd?styles.matchCardTbd:''}`}>
                        <span className={styles.matchGroup}>Match {f.match_num}</span>
                        <div className={styles.matchRow}>
                          <div className={styles.matchTeam}>
                            {hTeam && <Flag code={hTeam.flag} name={hTeam.name} size={28} />}
                            <span className={styles.matchName}>{hTeam?.name||f.home}</span>
                            {hPick && <span className={styles.pickerDot} title={hPick.username} />}
                          </div>
                          <div className={styles.matchMid}>
                            {hasScore
                              ? <span className={styles.scoreResult}>{s.home} – {s.away}</span>
                              : <span className={styles.matchKO}>{isTbd?'TBD':'–'}</span>
                            }
                            {hasScore && <span className={styles.ftBadge}>FT</span>}
                          </div>
                          <div className={`${styles.matchTeam} ${styles.matchTeamR}`}>
                            {aTeam && <Flag code={aTeam.flag} name={aTeam.name} size={28} />}
                            <span className={styles.matchName}>{aTeam?.name||f.away}</span>
                            {aPick && <span className={styles.pickerDot} title={aPick.username} />}
                          </div>
                        </div>
                        {userIsAdmin && !isTbd && (
                          <div className={styles.adminRow}>
                            <button className={styles.postScoreBtn}
                              onClick={() => { setScoreModal({...f, _knockout:true}); setScoreInput({ home: s?.home??'', away: s?.away??'' }) }}
                            >{hasScore?'Edit score':'Post score'}</button>
                            {hasScore && (
                              <button className={styles.deleteScoreBtn}
                                onClick={() => setDeleteConfirm({...f, _knockout:true})}
                              >Reset</button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── TABLE ── */}
      {tab === 'table' && (
        <div className={styles.section}>
          <div className={styles.pills} style={{ marginBottom:14 }}>
            {GROUPS.map(g => (
              <button key={g}
                className={`${styles.pill} ${standingsGroup===g?styles.pillActive:''}`}
                onClick={() => setStandingsGroup(g)}
              >Group {g}</button>
            ))}
          </div>
          <div className={styles.tableWrap}>
            <div className={styles.tableGroupLabel}>Group {standingsGroup}</div>
            <div className={styles.tableGrid}>
              <div className={styles.tableRowHdr}>
                <span className={styles.tPos}>#</span>
                <span className={styles.tTeam}>Team</span>
                <span className={styles.tStat}>MP</span>
                <span className={styles.tStat}>W</span>
                <span className={styles.tStat}>D</span>
                <span className={styles.tStat}>L</span>
                <span className={styles.tStat}>GF</span>
                <span className={styles.tStat}>GA</span>
                <span className={styles.tGD}>GD</span>
                <span className={styles.tPts}>PTS</span>
              </div>
              {computeStandings(standingsGroup, scores).map((row, idx) => {
                const qualifies = idx < 2
                const isMe      = myPick === row.id
                return (
                  <div key={row.id}
                    className={`${styles.tableRow} ${qualifies?styles.tableRowQ:''} ${isMe?styles.tableRowMe:''}`}
                  >
                    <span className={`${styles.tPos} ${qualifies?styles.tPosQ:''}`}>{idx+1}</span>
                    <span className={styles.tTeam}>
                      <Flag code={row.flag} name={row.name} size={20} />
                      <span className={styles.tName}>{row.name}</span>
                      {isMe && <span className={styles.tStar}>*</span>}
                    </span>
                    <span className={styles.tStat}>{row.mp}</span>
                    <span className={styles.tStat}>{row.w}</span>
                    <span className={styles.tStat}>{row.d}</span>
                    <span className={styles.tStat}>{row.l}</span>
                    <span className={styles.tStat}>{row.gf}</span>
                    <span className={styles.tStat}>{row.ga}</span>
                    <span className={`${styles.tGD} ${row.gd>0?styles.gdPos:row.gd<0?styles.gdNeg:''}`}>
                      {row.gd>0?`+${row.gd}`:row.gd}
                    </span>
                    <span className={styles.tPts}>{row.pts}</span>
                  </div>
                )
              })}
            </div>
            <div className={styles.tableLegend}>
              <span className={styles.legendDot} /> Top 2 qualify · Standings based on posted scores
            </div>
          </div>
        </div>
      )}

      {/* ── TEAMS / PICK ── */}
      {tab === 'teams' && (
        <div className={styles.section}>
          {myTeam ? (
            <div className={styles.myPickBanner}>
              <Flag code={myTeam.flag} name={myTeam.name} size={36} />
              <div className={styles.myPickBannerText}>
                <div className={styles.myPickBannerName}>{myTeam.name}</div>
                <div className={styles.myPickBannerSub}>Your pick in {meta.name}</div>
              </div>
              <button className={styles.dropBtn} onClick={() => setDropConfirm(true)}>Drop</button>
            </div>
          ) : (
            <p className={styles.pickHint}>
              {!user ? 'Login to pick a team.' : `Pick a team to back in ${meta.name}.`}
            </p>
          )}

          {GROUPS.map(g => (
            <div key={g} className={styles.group}>
              <div className={styles.groupLabel}>Group {g}</div>
              <div className={styles.groupGrid}>
                {groupedTeams[g].map(team => {
                  const picker = allPicks[team.id]
                  const isMe   = myPick === team.id
                  const taken  = !!picker && !isMe
                  return (
                    <button key={team.id}
                      className={`${styles.teamCard} ${isMe?styles.teamCardMe:''} ${myPick&&!isMe?styles.teamCardDim:''}`}
                      onClick={() => {
                        if (isMe)    { setDropConfirm(true); return }
                        if (taken)   { setTeamDetail(team); return }
                        if (myPick)  { setTeamDetail(team); return }
                        pickTeam(team.id)
                      }}
                      disabled={taken}
                    >
                      {isMe  && <span className={styles.meLabel}>MY PICK</span>}
                      {taken && <span className={styles.takenLabel}>TAKEN</span>}
                      <Flag code={team.flag} name={team.name} size={32} />
                      <span className={styles.teamName}>{team.name}</span>
                      {picker && (
                        <div className={styles.pickerInfo}>
                          <Avatar src={picker.avatar_url} name={picker.username} size={20} />
                          <span className={styles.pickerName}>{isMe ? 'You' : picker.username}</span>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <FifaTutorial gameSlug={gameSlug} />

      {/* Score modal */}
      {scoreModal && (
        <div className={styles.backdrop} onClick={() => setScoreModal(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setScoreModal(null)}>x</button>
            <div className={styles.modalTitle}>Post Score</div>
            <div className={styles.modalMatch}>
              {scoreModal._knockout ? (
                <>
                  <span>{teamById[scoreModal.home]?.name || scoreModal.home}</span>
                  <span className={styles.modalVs}>vs</span>
                  <span>{teamById[scoreModal.away]?.name || scoreModal.away}</span>
                </>
              ) : (
                <>
                  <span><Flag code={teamById[scoreModal.home]?.flag} name={teamById[scoreModal.home]?.name} size={22} /> {teamById[scoreModal.home]?.name}</span>
                  <span className={styles.modalVs}>vs</span>
                  <span><Flag code={teamById[scoreModal.away]?.flag} name={teamById[scoreModal.away]?.name} size={22} /> {teamById[scoreModal.away]?.name}</span>
                </>
              )}
            </div>
            <div className={styles.scoreInputs}>
              <input type="number" min="0" max="30" value={scoreInput.home}
                onChange={e => setScoreInput(p => ({ ...p, home:e.target.value }))}
                className={styles.scoreInput} placeholder="0"
              />
              <span className={styles.scoreDash}>–</span>
              <input type="number" min="0" max="30" value={scoreInput.away}
                onChange={e => setScoreInput(p => ({ ...p, away:e.target.value }))}
                className={styles.scoreInput} placeholder="0"
              />
            </div>
            {scoreModal._knockout && (
              <p className={styles.modalHint}>In knockout rounds, a draw stays as drawn. Post actual score — if penalties decide it, post the score after 90 mins then use Reset to re-enter if needed.</p>
            )}
            <button className={styles.saveBtn} onClick={saveScore} disabled={scoreSaving}>
              {scoreSaving?'Saving…':'Save Score'}
            </button>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div className={styles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setDeleteConfirm(null)}>x</button>
            <div className={styles.modalTitle}>Reset Score?</div>
            <p className={styles.modalSub}>
              This will remove the result for{' '}
              <strong>{teamById[deleteConfirm.home]?.name || deleteConfirm.home}</strong>
              {' '}vs{' '}
              <strong>{teamById[deleteConfirm.away]?.name || deleteConfirm.away}</strong>
              . Points from this match will no longer count in the standings.
            </p>
            <button className={styles.deleteConfirmBtn} onClick={() => deleteScore(deleteConfirm)}>
              Yes, reset result
            </button>
            <button className={styles.modalCancel} onClick={() => setDeleteConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Drop confirm */}
      {dropConfirm && (
        <div className={styles.backdrop} onClick={() => setDropConfirm(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setDropConfirm(false)}>x</button>
            <div className={styles.detailFlag}><Flag code={myTeam?.flag} name={myTeam?.name} size={52} /></div>
            <div className={styles.modalTitle}>Drop {myTeam?.name}?</div>
            <p className={styles.modalSub}>You can pick another team after dropping.</p>
            <button className={styles.dropConfirmBtn} onClick={dropPick} disabled={dropping}>
              {dropping?'Dropping…':'Yes, drop my pick'}
            </button>
            <button className={styles.modalCancel} onClick={() => setDropConfirm(false)}>Keep my pick</button>
          </div>
        </div>
      )}

      {/* Team detail */}
      {teamDetail && (
        <div className={styles.backdrop} onClick={() => setTeamDetail(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setTeamDetail(null)}>x</button>
            <div className={styles.detailFlag}><Flag code={teamDetail.flag} name={teamDetail.name} size={56} /></div>
            <div className={styles.detailName}>{teamDetail.name}</div>
            <div className={styles.detailGroup}>Group {teamDetail.group}</div>
            {allPicks[teamDetail.id] ? (
              <div className={styles.detailPicker}>
                <Avatar src={allPicks[teamDetail.id].avatar_url} name={allPicks[teamDetail.id].username} size={44} />
                <div>
                  <div className={styles.detailPickerName}>{allPicks[teamDetail.id].username}</div>
                  <div className={styles.detailPickerSub}>backing this team</div>
                </div>
              </div>
            ) : (
              <div className={styles.detailEmpty}>
                <p>No one has picked this team yet.</p>
                {!myPick && user && (
                  <button className={styles.detailPickBtn}
                    onClick={() => { setTeamDetail(null); pickTeam(teamDetail.id) }}
                  >Back {teamDetail.name}</button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
