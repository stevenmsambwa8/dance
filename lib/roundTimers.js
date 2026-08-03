/**
 * roundTimers.js — shared helpers for per-match countdown timers used
 * across knockout brackets, group stages, and league fixtures.
 *
 * Storage shape (lives inside bracket_data, no schema change needed):
 *   match_deadlines: { [matchKey]: { start: isoString, end: isoString } }
 *     - group/league fixture key = fx.id
 *     - knockout match key       = `${roundIndex}-${pairIndex}`
 *
 * Each match gets its OWN randomly assigned kickoff time — not a single
 * timer shared by an entire matchday/round. Players are expected to play
 * between MATCH_WINDOW_START_HOUR and MATCH_WINDOW_END_HOUR local time;
 * assignRandomMatchTimes() picks a random slot in that window per match,
 * and result submission for that match locks once its `end` passes.
 *
 * Legacy fields `round_times` / `match_times` (one shared timer per round/
 * matchday) may still exist in older bracket_data but are no longer read.
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

// ── Per-user match scheduling window ─────────────────────────────────────
// Players are expected to play their individually-assigned match sometime
// between these two hours (local time), each on their own random schedule.
export const MATCH_WINDOW_START_HOUR = 14 // 14:00
export const MATCH_WINDOW_END_HOUR   = 23 // 23:00
export const DEFAULT_MATCH_DURATION_MIN = 30 // window a player has, after kickoff, to submit their result

// Picks one random kickoff time inside the window on the given calendar day
// (dateStr: "YYYY-MM-DD", local time), and returns { start, end } isoStrings.
// `end` is kickoff + durationMinutes and is always clamped to land on/before
// MATCH_WINDOW_END_HOUR so the whole match — including the submission
// window — stays inside the 14:00–23:00 range.
export function randomMatchTime(dateStr, durationMinutes = DEFAULT_MATCH_DURATION_MIN, startHour = MATCH_WINDOW_START_HOUR, endHour = MATCH_WINDOW_END_HOUR) {
  const base = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date()
  base.setHours(0, 0, 0, 0)
  const windowStartMin = startHour * 60
  const windowEndMin = Math.max(endHour * 60 - durationMinutes, windowStartMin)
  const span = windowEndMin - windowStartMin
  const offsetMin = windowStartMin + Math.floor(Math.random() * (span + 1))
  const start = new Date(base.getTime() + offsetMin * 60000)
  const end = new Date(start.getTime() + durationMinutes * 60000)
  return { start: start.toISOString(), end: end.toISOString() }
}

// Assigns a fresh random kickoff time to every key in `keys`, on the given
// day, merging into (and overwriting only those keys of) `existing`.
export function assignRandomMatchTimes(existing, keys, dateStr, durationMinutes = DEFAULT_MATCH_DURATION_MIN) {
  const next = { ...(existing || {}) }
  for (const key of keys) next[key] = randomMatchTime(dateStr, durationMinutes)
  return next
}

// Removes a set of keys from a deadlines map (e.g. clearing a matchday/round).
export function clearMatchTimes(existing, keys) {
  const next = { ...(existing || {}) }
  for (const key of keys) delete next[key]
  return next
}

// "14:32" style local clock display for a kickoff time.
export function formatClockTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Today as "YYYY-MM-DD" in local time, for defaulting a date picker.
export function todayLocalDate() {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}
