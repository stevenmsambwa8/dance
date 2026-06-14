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

// ── Read session synchronously from localStorage before first render ──────────
function readCachedSession() {
  if (typeof window === 'undefined') return { user: null, profile: null }
  try {
    const raw = localStorage.getItem('nabogaming-auth')
    if (!raw) return { user: null, profile: null }
    const parsed = JSON.parse(raw)
    const session = parsed?.currentSession ?? parsed
    const u = session?.user ?? null
    return { user: u, profile: null }
  } catch {
    return { user: null, profile: null }
  }
}

function readCachedProfile() {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('nabogaming-profile')
    if (!raw) return null
    const p = JSON.parse(raw)
    if (!p?._cachedAt || Date.now() - p._cachedAt > 5 * 60 * 1000) return null
    return p
  } catch { return null }
}

// ── OneSignal: link this device to the logged-in Supabase user ────────────────
// Called after profile is fetched. Silently skips if user hasn't granted
// push permission yet — the PushNotificationToggle handles the explicit opt-in.
async function linkOneSignalToUser() {
  try {
    if (typeof window === 'undefined' || !window.OneSignalDeferred) return
    window.OneSignalDeferred.push(async (OneSignal) => {
      const permission = await OneSignal.Notifications.permission
      if (!permission) return // User hasn't opted in yet — skip silently

      const playerId = await OneSignal.User.PushSubscription.id
      if (!playerId) return

      const { error } = await supabase.rpc('set_onesignal_player_id', {
        p_player_id: playerId,
      })
      if (error) console.warn('[OneSignal] link failed:', error.message)
    })
  } catch (err) {
    console.warn('[OneSignal] linkOneSignalToUser error:', err)
  }
}

export default function AuthProvider({ children }) {
  const cached = readCachedSession()
  const [user, setUser]       = useState(cached.user)
  const [profile, setProfile] = useState(readCachedProfile())
  const [loading, setLoading] = useState(!cached.user)

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
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

  usePresence(user?.id)

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

    if (!data && error?.code === 'PGRST301') {
      await new Promise(r => setTimeout(r, 800))
      const retry = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
      data = retry.data
    }

    if (!data) {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      const currentSeason = getCurrentSeason()
      const email = authUser?.email ?? ''
      const rawName = authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || ''
      const fromName = rawName.trim().split(' ')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 10).toLowerCase()
      const fromEmail = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 10).toLowerCase()
      const base = fromName || fromEmail || 'player'
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
      if (!data) {
        const fallback = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
        data = fallback.data
      }
    }

    if (data) {
      const currentSeason = getCurrentSeason()
      if (!data.current_season) {
        await supabase.from('profiles').update({ current_season: currentSeason }).eq('id', userId)
        data.current_season = currentSeason
      } else if (data.current_season < currentSeason) {
        const newTier = computeSeasonResetTier(data.tier || 'Gold', data.season_losses || 0)
        await supabase.from('season_history').upsert({
          user_id: userId,
          season_number: data.current_season,
          tier: data.tier,
          wins: data.season_wins || 0,
          losses: data.season_losses || 0,
          points: data.points || 0,
        }, { onConflict: 'user_id,season_number' })
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
      data.season_wins   = data.season_wins   ?? 0
      data.season_losses = data.season_losses ?? 0
      data.wins          = data.wins          ?? 0
      data.losses        = data.losses        ?? 0
      data.level         = data.level         ?? 1
    }

    setProfile(data)
    try { localStorage.setItem('nabogaming-profile', JSON.stringify({ ...data, _cachedAt: Date.now() })) } catch {}
    setLoading(false)

    // ── Link OneSignal device to this user (no-op if not yet subscribed) ──
    linkOneSignalToUser()
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
    // Save current page so auth/confirm can return user here after Google OAuth
    const returnTo = window.location.pathname + window.location.search
    try { localStorage.setItem('auth_return_to', returnTo) } catch {}
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) throw error
  }

  async function signOut() {
    try { localStorage.removeItem('nabogaming-profile') } catch {}
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
