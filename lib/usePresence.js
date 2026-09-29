'use client'
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// ── Singleton state ──────────────────────────────────────────────
let channel = null
let trackedUserId = null
let onlineIds = new Set()
let listeners = new Set()
let channelReady = false
let subscribePromise = null

function notify() {
  const snap = new Set(onlineIds)
  listeners.forEach(fn => fn(snap))
}

function destroyChannel() {
  if (channel) {
    supabase.removeChannel(channel)
    channel = null
    channelReady = false
    subscribePromise = null
  }
}

function applyPresenceState(state) {
  const ids = new Set()
  Object.values(state).forEach(presences => {
    presences.forEach(p => {
      if (p.userId) {
        ids.add(p.userId)
      }
    })
  })
  onlineIds = ids
}

function initChannel() {
  // If channel exists and is healthy, reuse it
  if (channel && channelReady) return

  // If broken/closed channel exists, remove it first
  if (channel) destroyChannel()

  channel = supabase.channel('online-users', {
    config: { presence: { key: '__global__' } },
  })

  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      applyPresenceState(state)
      notify()
    })
    .on('presence', { event: 'join' }, ({ newPresences }) => {
      newPresences?.forEach(p => {
        if (p.userId) {
          onlineIds.add(p.userId)
        }
      })
      notify()
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      leftPresences?.forEach(p => {
        if (p.userId) {
          onlineIds.delete(p.userId)
        }
      })
      notify()
    })

  subscribePromise = new Promise(resolve => {
    channel.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        channelReady = true
        if (trackedUserId) {
          await channel.track({
            userId: trackedUserId,
            online_at: new Date().toISOString(),
          })
        }
        resolve()
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        channelReady = false
        resolve()
      }
    })
  })
}

async function trackSelf() {
  if (!channelReady) await subscribePromise
  if (channel && channelReady && trackedUserId) {
    await channel.track({
      userId: trackedUserId,
      online_at: new Date().toISOString(),
    })
  }
}

// ── usePresence — call once in AuthProvider ──────────────────────
// "Online now" is driven entirely by Realtime Presence (in-memory, no
// disk IO). We only touch the `profiles` table on real state changes —
// going online, going offline, coming back — never on a timer. This is
// the difference between ~1 write per session-transition vs. 1 write
// per user per minute forever.
export function usePresence(userId) {
  useEffect(() => {
    if (!userId) return

    trackedUserId = userId
    initChannel()
    trackSelf()

    // One write when we actually come online (mount / tab refocus),
    // so last_seen has a reasonable value for offline users elsewhere
    // in the UI. No repeating interval.
    async function markOnline() {
      await supabase
        .from('profiles')
        .update({ online_status: 'online', last_seen: new Date().toISOString() })
        .eq('id', userId)
    }
    markOnline()

    // Visibility: untrack when tab hidden, re-track when visible.
    // Each branch fires at most once per transition, not on a timer.
    async function handleVisibility() {
      if (document.hidden) {
        channel?.untrack()
        supabase
          .from('profiles')
          .update({ online_status: 'offline', last_seen: new Date().toISOString() })
          .eq('id', userId)
      } else {
        // Re-init channel if it died while hidden
        initChannel()
        await trackSelf()
        markOnline()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    function handleUnload() {
      supabase
        .from('profiles')
        .update({ online_status: 'offline', last_seen: new Date().toISOString() })
        .eq('id', userId)
      channel?.untrack()
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('beforeunload', handleUnload)
      channel?.untrack()
      trackedUserId = null
    }
  }, [userId])
}

// ── useOnlineUsers — use anywhere to get live Set<userId> ────────
export function useOnlineUsers() {
  const [ids, setIds] = useState(() => new Set(onlineIds))

  useEffect(() => {
    listeners.add(setIds)
    initChannel()
    // Push current state immediately if available
    if (onlineIds.size > 0) setIds(new Set(onlineIds))
    return () => { listeners.delete(setIds) }
  }, [])

  return ids
}

// ── useIsOnline — single user ────────────────────────────────────
export function useIsOnline(userId) {
  const ids = useOnlineUsers()
  return userId ? ids.has(userId) : false
}
