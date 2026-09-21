'use client'
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { GAME_SLUGS } from '../lib/constants'

/**
 * GameSettingsProvider — site-wide view of which games are live.
 *
 * Statuses come from the game_settings table (managed in the admin Games tab):
 *   active   → normal
 *   hidden   → removed from every list/picker/page
 *   disabled → still listed, but unavailable until `until` (auto re-enables)
 *   deleted  → gone for good
 *
 * If the table doesn't exist yet (SQL not run) everything simply stays active.
 */

const defaultValue = {
  loaded: true,
  visibleSlugs: GAME_SLUGS,
  enabledSlugs: GAME_SLUGS,
  getGameStatus: () => ({ state: 'active' }),
  isGameVisible: () => true,
  isGameEnabled: () => true,
  refresh: async () => {},
}

const GameSettingsContext = createContext(defaultValue)
export const useGames = () => useContext(GameSettingsContext)

function resolveStatus(row, now) {
  if (!row) return { state: 'active' }
  if (row.status === 'deleted') return { state: 'deleted' }
  if (row.status === 'hidden')  return { state: 'hidden' }
  if (row.status === 'disabled') {
    const until = row.disabled_until ? new Date(row.disabled_until).getTime() : null
    if (until && until <= now) return { state: 'active' } // period is over → back on automatically
    return { state: 'disabled', until: row.disabled_until, note: row.note || '' }
  }
  return { state: 'active' }
}

export default function GameSettingsProvider({ children }) {
  const [rows, setRows]     = useState({})
  const [loaded, setLoaded] = useState(false)
  const [now, setNow]       = useState(() => Date.now())

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.from('game_settings').select('slug,status,disabled_until,note')
    if (!error && data) {
      const map = {}
      data.forEach(r => { map[r.slug] = r })
      setRows(map)
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    refresh()
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    const poll = setInterval(refresh, 5 * 60 * 1000)
    return () => { window.removeEventListener('focus', onFocus); clearInterval(poll) }
  }, [refresh])

  // Tick so a "disabled until" period ends by itself without a reload
  // (only runs while at least one timed disable exists).
  const hasTimed = Object.values(rows).some(r => r.status === 'disabled' && r.disabled_until)
  useEffect(() => {
    if (!hasTimed) return
    const id = setInterval(() => setNow(Date.now()), 30 * 1000)
    return () => clearInterval(id)
  }, [hasTimed])

  const value = useMemo(() => {
    const getGameStatus = (slug) => resolveStatus(rows[slug], now)
    const isGameVisible = (slug) => {
      const s = getGameStatus(slug).state
      return s !== 'hidden' && s !== 'deleted'
    }
    const isGameEnabled = (slug) => getGameStatus(slug).state === 'active'
    return {
      loaded,
      visibleSlugs: GAME_SLUGS.filter(isGameVisible),
      enabledSlugs: GAME_SLUGS.filter(isGameEnabled),
      getGameStatus,
      isGameVisible,
      isGameEnabled,
      refresh,
    }
  }, [rows, now, loaded, refresh])

  return <GameSettingsContext.Provider value={value}>{children}</GameSettingsContext.Provider>
}
