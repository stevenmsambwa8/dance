'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { notFound } from 'next/navigation'
import { useAuth } from '../../../components/AuthProvider'
import { useAuthGate } from '../../../components/AuthGateModal'
import { supabase } from '../../../lib/supabase'
import { GAME_META } from '../../../lib/constants'
import usePageLoading from '../../../components/usePageLoading'
import { getTierTheme } from '../../../lib/tierTheme'

export function getTierColor(tier) {
  return getTierTheme(tier)?.primary || '#f59e0b'
}

function weekLabel(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const end = new Date(d); end.setDate(d.getDate() + 6)
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
}

function formatMasterDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function fmtFee(n) { return Number(n).toLocaleString() }

// Shared data + handlers used by every per-game layout. Keeping this in one
// hook means each game's page can look completely different while the
// underlying tournament / subscription / weekly-master logic stays identical
// and only has to be tested once.
export default function useGameData() {
  const { slug } = useParams()
  const router   = useRouter()
  const { user, isAdmin } = useAuth()
  const { openAuthGate } = useAuthGate()
  const game = GAME_META[slug]
  if (!game) notFound()

  const [tournaments, setTournaments] = useState([])
  const [loading,     setLoading]     = useState(true)
  usePageLoading(loading)
  const [subscribed,  setSubscribed]  = useState(false)
  const [subCount,    setSubCount]    = useState(0)
  const [selected,    setSelected]    = useState(null)
  const [registered,  setRegistered]  = useState({})
  const [paymentMap,  setPaymentMap]  = useState({})
  const [payModal,    setPayModal]    = useState(null)
  const [master,      setMaster]      = useState(null)
  const [masterLoading, setMasterLoading] = useState(true)
  const [pastMasters, setPastMasters] = useState([])

  useEffect(() => { loadData() }, [slug, user])
  useEffect(() => { loadMaster() }, [slug])

  async function loadMaster() {
    setMasterLoading(true)

    const getMonday = () => {
      const d = new Date()
      const day = d.getDay()
      const diff = day === 0 ? -6 : 1 - day
      d.setDate(d.getDate() + diff)
      d.setHours(0, 0, 0, 0)
      return d.toISOString().split('T')[0]
    }
    const monday = getMonday()

    const { data: rpcData } = await supabase.rpc('get_current_game_master', { p_game_slug: slug })
    let currentMaster = rpcData?.[0] || null

    if (!currentMaster) {
      const weekEnd = new Date(monday)
      weekEnd.setDate(weekEnd.getDate() + 7)
      const { data: fallback } = await supabase
        .from('game_masters')
        .select('*, profiles(username, avatar_url, tier, country_flag)')
        .eq('game_slug', slug)
        .gte('week_start', monday)
        .lt('week_start', weekEnd.toISOString().split('T')[0])
        .order('crowned_at', { ascending: false })
        .limit(1)
      if (fallback?.[0]) {
        const r = fallback[0]
        currentMaster = {
          user_id: r.user_id,
          username: r.profiles?.username,
          avatar_url: r.profiles?.avatar_url,
          tier: r.profiles?.tier,
          country_flag: r.profiles?.country_flag,
          total_wins: r.total_wins,
          total_points: r.total_points,
          tournaments_played: r.tournaments_played,
          crowned_at: r.crowned_at,
          week_start: r.week_start,
        }
      }
    }

    setMaster(currentMaster)

    const { data: past } = await supabase
      .from('game_masters')
      .select('*, profiles(username, avatar_url, tier, country_flag)')
      .eq('game_slug', slug)
      .lt('week_start', monday)
      .order('week_start', { ascending: false })
      .limit(4)
    setPastMasters(past || [])
    setMasterLoading(false)
  }

  async function loadData() {
    setLoading(true)
    const [{ data: tourns }, { count: subs }] = await Promise.all([
      supabase.from('tournaments')
        .select('id, name, slug, game_slug, status, slots, registered_count, date, prize, format, entrance_fee, is_test, created_by')
        .eq('game_slug', slug)
        .in('status', ['active', 'ongoing'])
        .order('created_at', { ascending: false }),
      supabase.from('game_subscriptions').select('*', { count: 'exact', head: true }).eq('game_slug', slug),
    ])

    const visible = (tourns || []).filter(t => {
      if (!t.is_test) return true
      if (!user) return false
      return isAdmin || t.created_by === user.id
    })
    setTournaments(visible)
    setSubCount(subs || 0)

    if (user) {
      const [{ data: sub }, { data: regs }] = await Promise.all([
        supabase.from('game_subscriptions').select('user_id').eq('user_id', user.id).eq('game_slug', slug).maybeSingle(),
        supabase.from('tournament_participants').select('tournament_id').eq('user_id', user.id),
      ])
      setSubscribed(!!sub)
      if (regs) {
        const map = {}
        regs.forEach(r => { map[r.tournament_id] = true })
        setRegistered(map)
      }
      const paidIds = visible.filter(t => (t.entrance_fee || 0) > 0).map(t => t.id)
      if (paidIds.length) {
        const { data: pmts } = await supabase.from('tournament_payments')
          .select('tournament_id, status').eq('user_id', user.id).in('tournament_id', paidIds)
        if (pmts) {
          const pmap = {}
          pmts.forEach(p => { pmap[p.tournament_id] = p.status })
          setPaymentMap(pmap)
        }
      }
    }
    setLoading(false)
  }

  async function toggleSubscribe() {
    if (!user) { openAuthGate(); return }
    if (subscribed) {
      await supabase.from('game_subscriptions').delete().eq('user_id', user.id).eq('game_slug', slug)
      setSubCount(c => Math.max(0, c - 1))
    } else {
      await supabase.from('game_subscriptions').insert({ user_id: user.id, game_slug: slug })
      setSubCount(c => c + 1)
    }
    setSubscribed(s => !s)
  }

  async function registerTournament(t) {
    if (!user) { openAuthGate(); return }
    if (!t) return
    const { error } = await supabase.from('tournament_participants').insert({ tournament_id: t.id, user_id: user.id })
    if (error) return
    const { count } = await supabase.from('tournament_participants')
      .select('*', { count: 'exact', head: true }).eq('tournament_id', t.id)
    if (count !== null) await supabase.from('tournaments').update({ registered_count: count }).eq('id', t.id)
    const newCount = count ?? (t.registered_count || 0) + 1
    setRegistered(r => ({ ...r, [t.id]: true }))
    setTournaments(ts => ts.map(x => x.id === t.id ? { ...x, registered_count: newCount } : x))
    const { data: tData } = await supabase.from('tournaments').select('bracket_data').eq('id', t.id).single()
    if (tData?.bracket_data) {
      try {
        const bd = typeof tData.bracket_data === 'string' ? JSON.parse(tData.bracket_data) : tData.bracket_data
        if (bd?.rounds) {
          const { data: profile } = await supabase.from('profiles').select('username, avatar_url').eq('id', user.id).maybeSingle()
          const playerSlot = { userId: user.id, name: profile?.username || 'Player', avatar: profile?.avatar_url || null, status: 'active' }
          let pick = null
          bd.rounds[0]?.forEach((pair, pi) => {
            pair.forEach((s, si) => { if (!pick && !s?.userId && (s?.status === 'open' || s?.status === 'bye')) pick = { pi, si } })
          })
          if (pick) {
            const newRounds = bd.rounds.map((r, ri) => ri !== 0 ? r : r.map((pair, pi) => {
              if (pi !== pick.pi) return pair
              return pair.map((s, si) => si === pick.si ? playerSlot : s)
            }))
            await supabase.from('tournaments').update({ bracket_data: { ...bd, rounds: newRounds, isEmpty: false } }).eq('id', t.id)
          }
        }
      } catch {}
    }
    setSelected(null)
  }

  function onPaymentSubmitted(tournamentId) {
    setPayModal(null); setSelected(null)
    setPaymentMap(m => ({ ...m, [tournamentId]: 'payment_submitted' }))
  }

  const isJoined         = selected ? !!registered[selected.id] : false
  const isFull            = selected ? ((selected.registered_count || 0) >= selected.slots && !isJoined) : false
  const selectedHasFee   = (selected?.entrance_fee || 0) > 0
  const selectedPending  = paymentMap[selected?.id] === 'payment_submitted'

  return {
    slug, router, user, isAdmin, game,
    tournaments, loading, subscribed, subCount, selected, setSelected,
    registered, paymentMap, payModal, setPayModal,
    master, masterLoading, pastMasters,
    toggleSubscribe, registerTournament, onPaymentSubmitted,
    isJoined, isFull, selectedHasFee, selectedPending,
    weekLabel, formatMasterDate, fmtFee,
  }
}
