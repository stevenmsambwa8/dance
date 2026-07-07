'use client'
import { useEffect, useState, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from './supabase'
import { getZoneIdForPath } from './siteZones'

// ── Singleton state ──────────────────────────────────────────────
let channel = null
let trackedUserId = null
let trackedZone = null
let onlineIds = new Set()
let onlineZones = new Map() // userId -> zoneId
let listeners = new Set()
let zoneListeners = new Set()
let channelReady = false
let subscribePromise = null

function notify() {
  const snap = new Set(onlineIds)
  listeners.forEach(fn => fn(snap))
}

function notifyZones() {
  const snap = new Map(onlineZones)
  zoneListeners.forEach(fn => fn(snap))
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
  const zones = new Map()
  Object.values(state).forEach(presences => {
    presences.forEach(p => {
      if (p.userId) {
        ids.add(p.userId)
        if (p.zone) zones.set(p.userId, p.zone)
      }
    })
  })
  onlineIds = ids
  onlineZones = zones
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
      notifyZones()
    })
    .on('presence', { event: 'join' }, ({ newPresences }) => {
      newPresences?.forEach(p => {
        if (p.userId) {
          onlineIds.add(p.userId)
          if (p.zone) onlineZones.set(p.userId, p.zone)
        }
      })
      notify()
      notifyZones()
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      leftPresences?.forEach(p => {
        if (p.userId) {
          onlineIds.delete(p.userId)
          onlineZones.delete(p.userId)
        }
      })
      notify()
      notifyZones()
    })

  subscribePromise = new Promise(resolve => {
    channel.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        channelReady = true
        if (trackedUserId) {
          await channel.track({
            userId: trackedUserId,
            zone: trackedZone,
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
      zone: trackedZone,
      online_at: new Date().toISOString(),
    })
  }
}

// ── usePresence — call once in AuthProvider ──────────────────────
export function usePresence(userId) {
  useEffect(() => {
    if (!userId) return

    trackedUserId = userId
    initChannel()
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
      trackedZone = null
    }
  }, [userId])
}

// ── useZoneTracker — call once in AuthProvider (or layout) ───────
// Watches the current route, updates the live presence payload with the
// user's current "zone" (for online users), and persists last_zone to
// the profiles table (throttled) so offline users still show a last-known
// pin on the Lobby Map.
export function useZoneTracker(userId) {
  const pathname = usePathname()
  const lastWrittenZone = useRef(null)

  useEffect(() => {
    if (!userId) return
    const zoneId = getZoneIdForPath(pathname)
    trackedZone = zoneId

    // Update live presence payload immediately (cheap, no DB write)
    trackSelf()

    // Reflect in the local zone map right away for our own client
    onlineZones.set(userId, zoneId)
    notifyZones()

    // Persist last_zone to DB, but only when it actually changes,
    // so we're not writing on every render.
    if (lastWrittenZone.current !== zoneId) {
      lastWrittenZone.current = zoneId
      supabase.from('profiles').update({ last_zone: zoneId }).eq('id', userId)
    }
  }, [pathname, userId])
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

// ── useOnlineZones — live Map<userId, zoneId> for the Lobby Map ──
export function useOnlineZones() {
  const [zones, setZones] = useState(() => new Map(onlineZones))

  useEffect(() => {
    zoneListeners.add(setZones)
    initChannel()
    if (onlineZones.size > 0) setZones(new Map(onlineZones))
    return () => { zoneListeners.delete(setZones) }
  }, [])

  return zones
}
