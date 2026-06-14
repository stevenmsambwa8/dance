'use client'
import { useEffect, useState, useRef } from 'react'
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
      const ids = new Set()
      Object.values(state).forEach(presences => {
        presences.forEach(p => { if (p.userId) ids.add(p.userId) })
      })
      onlineIds = ids
      notify()
    })
    .on('presence', { event: 'join' }, ({ newPresences }) => {
      newPresences?.forEach(p => { if (p.userId) onlineIds.add(p.userId) })
      notify()
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      leftPresences?.forEach(p => { if (p.userId) onlineIds.delete(p.userId) })
      notify()
    })

  subscribePromise = new Promise(resolve => {
    channel.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        channelReady = true
        if (trackedUserId) {
          await channel.track({ userId: trackedUserId, online_at: new Date().toISOString() })
        }
        resolve()
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        channelReady = false
        resolve()
      }
    })
  })
}

// ── usePresence — call once in AuthProvider ──────────────────────
export function usePresence(userId) {
  useEffect(() => {
    if (!userId) return

    trackedUserId = userId
    initChannel()

    async function trackSelf() {
      if (!channelReady) await subscribePromise
      if (channel && channelReady) {
        await channel.track({ userId, online_at: new Date().toISOString() })
      }
    }
    trackSelf()

    // Heartbeat: keep last_seen fresh in DB every 60s
    async function heartbeat() {
      await supabase
        .from('profiles')
        .update({ online_status: 'online', last_seen: new Date().toISOString() })
        .eq('id', userId)
    }
    heartbeat()
    const hbInterval = setInterval(heartbeat, 60_000)

    // Visibility: untrack when tab hidden, re-track when visible
    async function handleVisibility() {
      if (document.hidden) {
        channel?.untrack()
        supabase.from('profiles').update({ online_status: 'offline' }).eq('id', userId)
      } else {
        // Re-init channel if it died while hidden
        initChannel()
        await trackSelf()
        heartbeat()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    function handleUnload() {
      supabase.from('profiles').update({ online_status: 'offline' }).eq('id', userId)
      channel?.untrack()
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      clearInterval(hbInterval)
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
