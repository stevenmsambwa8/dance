'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { usePresence } from '../lib/usePresence'
import {
  getCurrentSeason,
  computeTierAfterWin,
  computeSeasonResetTier,
  computeLevelAfterWin,
  computeLevelOnSeasonReset,
  getLevelWinThreshold,
  TIER_ORDER,
  LOSS_DROP_THRESHOLD,
} from '../lib/seasons'

const AuthContext = createContext({})
export const useAuth = () => useContext(AuthContext)

export const ADMIN_EMAILS = ['stevenmsambwa8@gmail.com', 'nabogamingss1@gmail.com']
export const ADMIN_EMAIL = ADMIN_EMAILS[0] // backward compat
export const HELPDESK_EMAILS = ['nabogamingss1@gmail.com']
export const isHelpdeskEmail = (email) => HELPDESK_EMAILS.includes(email)

export default function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    // 1. Restore session from storage first — this is synchronous on the client
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    // 2. Listen for future auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      // TOKEN_REFRESHED fires silently — just update user, don't flicker
      if (event === 'TOKEN_REFRESHED') {
        setUser(session?.user ?? null)
        return
      }
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  /* ── Online presence (Realtime Presence — no stale DB writes) ── */
  usePresence(user?.id)

  /* ── Realtime profile sync — keeps points & stats live everywhere ── */
  useEffect(() => {
    if (!user?.id) return
    const ch = supabase
      .channel(`profile-sync-${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${user.id}`,
      }, payload => {
        setProfile(prev => prev ? { ...prev, ...payload.new } : payload.new)
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [user?.id])

  async function fetchProfile(userId) {
    let { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()

    // If RLS blocked the read (OAuth race condition — session not fully set yet), retry once
    if (!data && error?.code === 'PGRST301') {
      await new Promise(r => setTimeout(r, 800))
      const retry = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
      data = retry.data
    }

    // Google OAuth users have no profile row yet — create one now
    if (!data) {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      const currentSeason = getCurrentSeason()
      const email = authUser?.email ?? ''
      // Use Google display name if available, else email prefix — short and clean
      const rawName = authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || ''
      const fromName = rawName.trim().split(' ')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 10).toLowerCase()
      const fromEmail = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 10).toLowerCase()
      const base = fromName || fromEmail || 'player'
      // Only add suffix if username is taken
      const { data: existing } = await supabase.from('profiles').select('id').eq('username', base).maybeSingle()
      const username = existing
        ? `${base.slice(0, 9)}_${Math.floor(Math.random() * 900) + 100}`
        : base
      const avatar_url = authUser?.user_metadata?.avatar_url ?? null

      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          username,
          email,
          avatar_url,
          tier: 'Gold',
          rank: 99,
          wins: 0,
          losses: 0,
          points: 0,
          bio: '',
          play_style: 'Aggressive',
          current_season: currentSeason,
          season_wins: 0,
          season_losses: 0,
          country_flag: null,
          is_season_winner: false,
          level: 1,
        })
        .select()
        .maybeSingle()

      if (!insertError && newProfile) data = newProfile
      // If insert blocked by RLS, try a plain select as fallback
      if (!data) {
        const fallback = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
        data = fallback.data
      }
    }
    if (data) {
      // Check if user is behind on season — if new season started, reset season stats
      const currentSeason = getCurrentSeason()
      if (!data.current_season) {
        // First time in season tracking — stamp current season, keep existing wins
        await supabase.from('profiles').update({ current_season: currentSeason }).eq('id', userId)
        data.current_season = currentSeason
      } else if (data.current_season < currentSeason) {
        // New season started — apply tier drop if losses threshold met, then reset counters
        const newTier = computeSeasonResetTier(data.tier || 'Gold', data.season_losses || 0)
        // Archive the completed season
        await supabase.from('season_history').upsert({
          user_id: userId,
          season_number: data.current_season,
          tier: data.tier,
          wins: data.season_wins || 0,
          losses: data.season_losses || 0,
          points: data.points || 0,
        }, { onConflict: 'user_id,season_number' })
        // Reset for new season
        const newLevel = computeLevelOnSeasonReset(data.level || 1, data.season_wins || 0)
        await supabase.from('profiles').update({
          current_season: currentSeason,
          season_wins: 0,
          season_losses: 0,
          tier: newTier,
          level: newLevel,
        }).eq('id', userId)
        data.current_season = currentSeason
        data.season_wins = 0
        data.season_losses = 0
        data.tier = newTier
        data.level = newLevel
      }
    }
    if (data) {
      // Normalize nullable season counters so downstream code always gets numbers
      data.season_wins   = data.season_wins   ?? 0
      data.season_losses = data.season_losses ?? 0
      data.wins          = data.wins          ?? 0
      data.losses        = data.losses        ?? 0
      data.level         = data.level         ?? 1
    }
    setProfile(data)
    setLoading(false)
  }

  async function signUp(email, password, username, countryFlag = null) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    if (data.user) {
      const currentSeason = getCurrentSeason()
      await supabase.from('profiles').insert({
        id: data.user.id,
        username,
        email,
        tier: 'Gold',
        rank: 99,
        wins: 0,
        losses: 0,
        points: 0,
        bio: '',
        play_style: 'Aggressive',
        current_season: currentSeason,
        season_wins: 0,
        season_losses: 0,
        country_flag: countryFlag,
        is_season_winner: false,
        level: 1,
      })
    }
    return data
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function updateProfile(updates) {
    if (!user) return
    const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)
    if (error) throw error
    setProfile(prev => ({ ...prev, ...updates }))
  }

  async function uploadAvatar(file) {
    if (!user) return null
    const ext = file.name.split('.').pop()
    const path = `${user.id}/avatar.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true })
    if (uploadError) throw uploadError
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    const publicUrl = `${data.publicUrl}?t=${Date.now()}`
    await updateProfile({ avatar_url: publicUrl })
    return publicUrl
  }

  /**
   * Call after a match win is confirmed. Updates season_wins, total wins,
   * and advances tier if threshold is reached.
   */
  async function recordWin(userId, currentProfile) {
    const newSeasonWins = (currentProfile.season_wins ?? 0) + 1
    const newWins = (currentProfile.wins ?? 0) + 1
    const newTier = computeTierAfterWin(currentProfile.tier || 'Gold', newSeasonWins)
    const currentSeason = getCurrentSeason()
    await supabase.from('profiles').update({
      wins: newWins,
      season_wins: newSeasonWins,
      tier: newTier,
      current_season: currentSeason,
    }).eq('id', userId)
    setProfile(p => ({ ...p, wins: newWins, season_wins: newSeasonWins, tier: newTier, current_season: currentSeason }))
  }

  /**
   * Call after a match loss is confirmed. Updates season_losses and total losses.
   */
  async function recordLoss(userId, currentProfile) {
    const newSeasonLosses = (currentProfile.season_losses ?? 0) + 1
    const newLosses = (currentProfile.losses ?? 0) + 1
    const currentSeason = getCurrentSeason()
    await supabase.from('profiles').update({
      losses: newLosses,
      season_losses: newSeasonLosses,
      current_season: currentSeason,
    }).eq('id', userId)
    setProfile(p => ({ ...p, losses: newLosses, season_losses: newSeasonLosses, current_season: currentSeason }))
  }

  const isAdmin    = ADMIN_EMAILS.includes(user?.email)
  const isVerified = isAdmin
  const isHelpdesk = HELPDESK_EMAILS.includes(user?.email)

  return (
    <AuthContext.Provider value={{
      user, profile, loading, isAdmin, isVerified, isHelpdesk,
      signUp, signIn, signInWithGoogle, signOut, updateProfile, uploadAvatar, recordWin, recordLoss,
      refreshProfile: () => user && fetchProfile(user.id),
    }}>
      {children}
    </AuthContext.Provider>
  )
}