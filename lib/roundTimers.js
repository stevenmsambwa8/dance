/**
 * roundTimers.js — generic status/formatting helpers for a start/end time
 * pair, keyed however the caller wants. Used for per-match scheduling
 * (see lib/matchScheduler.js for the key conventions: knockoutKey/fixtureKey,
 * stored in bracket_data.match_schedule) as well as any other simple
 * "does this window have a start/end, and where are we relative to it" check.
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

// Formats an ISO timestamp as a 24-hour clock time, e.g. "16:08". Used for
// the "plays at" label shown before a match's window opens — a fixed point
// in time rather than a ticking countdown.
export function formatTimeOfDay(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

// Returns null (no timer set) or { phase: 'upcoming'|'live'|'live-noend'|'over', ms, start, end }
// `start`/`end` are the raw ISO strings so callers can show the exact
// scheduled time for 'upcoming' matches instead of a countdown — the
// countdown only kicks in once the match's window has actually opened.
export function getTimeStatus(times, key, now = Date.now()) {
  const rt = times?.[key]
  if (!rt || (!rt.start && !rt.end)) return null
  const startMs = rt.start ? new Date(rt.start).getTime() : null
  const endMs   = rt.end   ? new Date(rt.end).getTime()   : null
  if (startMs && now < startMs) return { phase: 'upcoming', ms: startMs - now, start: rt.start, end: rt.end }
  if (endMs && now < endMs)     return { phase: 'live', ms: endMs - now, start: rt.start, end: rt.end }
  if (endMs && now >= endMs)    return { phase: 'over', ms: 0, start: rt.start, end: rt.end }
  if (startMs && now >= startMs && !endMs) return { phase: 'live-noend', ms: null, start: rt.start, end: rt.end }
  return null
}

// True only when a deadline is actually set AND has passed. No timer set → never blocks.
export function isTimeUp(times, key, now = Date.now()) {
  return getTimeStatus(times, key, now)?.phase === 'over'
}
