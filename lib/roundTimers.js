/**
 * roundTimers.js — shared helpers for per-round / per-matchday start & end
 * timers used across knockout brackets, group stages, and league fixtures.
 *
 * Storage shape (lives inside bracket_data, no schema change needed):
 *   round_times: { [roundIndex]: { start: isoString|null, end: isoString|null } }   // knockout bracket rounds
 *   match_times: { [matchdayNumber]: { start: isoString|null, end: isoString|null } } // group/league fixture rounds (fx.round)
 */

// Convert an ISO string to the "YYYY-MM-DDTHH:mm" format <input type="datetime-local"> expects.
export function toLocalInputValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  const local = new Date(d.getTime() - off * 60000)
  return local.toISOString().slice(0, 16)
}

export function formatDuration(ms) {
  if (ms == null) return ''
  if (ms < 0) ms = 0
  const totalSec = Math.floor(ms / 1000)
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  const pad = n => String(n).padStart(2, '0')
  return days > 0 ? `${days}d ${pad(hours)}:${pad(mins)}:${pad(secs)}` : `${pad(hours)}:${pad(mins)}:${pad(secs)}`
}

// Returns null (no timer set) or { phase: 'upcoming'|'live'|'live-noend'|'over', ms }
export function getTimeStatus(times, key, now = Date.now()) {
  const rt = times?.[key]
  if (!rt || (!rt.start && !rt.end)) return null
  const startMs = rt.start ? new Date(rt.start).getTime() : null
  const endMs   = rt.end   ? new Date(rt.end).getTime()   : null
  if (startMs && now < startMs) return { phase: 'upcoming', ms: startMs - now }
  if (endMs && now < endMs)     return { phase: 'live', ms: endMs - now }
  if (endMs && now >= endMs)    return { phase: 'over', ms: 0 }
  if (startMs && now >= startMs && !endMs) return { phase: 'live-noend', ms: null }
  return null
}

// True only when a deadline is actually set AND has passed. No timer set → never blocks.
export function isTimeUp(times, key, now = Date.now()) {
  return getTimeStatus(times, key, now)?.phase === 'over'
}
