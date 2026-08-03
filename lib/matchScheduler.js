/**
 * matchScheduler.js — assigns each individual match (not each round/matchday)
 * its own random start/end time inside an organiser-defined daily play
 * window, e.g. "matches happen sometime between 14:00 and 23:00 today".
 *
 * Every match gets an independent slot, so two different pairings can be
 * scheduled at completely different times — that's the point: players
 * aren't all forced to play in the same window, each one finds out when
 * THEIR match is.
 */

// Build match keys consistently so every part of the app (manage page,
// public page, pending-submissions feed) agrees on how to look a match up
// inside bracket_data.match_schedule.
export function knockoutKey(rIdx, pIdx) { return `ko:${rIdx}-${pIdx}` }
export function fixtureKey(fixtureId)   { return `fx:${fixtureId}` }

/**
 * @param {string[]} keys - match keys to schedule (knockoutKey/fixtureKey)
 * @param {object} opts
 *   date              - 'YYYY-MM-DD' local date the matches are played on
 *   windowStartHour   - hour of day (0-23) the play window opens
 *   windowEndHour     - hour of day (0-23) the play window closes
 *   durationMinutes   - how long each individual match gets once it starts
 * @returns {{ [key]: { start: string, end: string } }}
 */
export function randomizeMatchSchedule(keys, { date, windowStartHour, windowEndHour, durationMinutes = 30 }) {
  const schedule = {}
  if (!date || !keys?.length) return schedule

  const [y, m, d] = date.split('-').map(Number)
  const windowStart = new Date(y, (m || 1) - 1, d || 1, windowStartHour, 0, 0, 0)
  const windowEnd   = new Date(y, (m || 1) - 1, d || 1, windowEndHour, 0, 0, 0)
  const windowMs = windowEnd.getTime() - windowStart.getTime()
  const durMs = Math.max(1, durationMinutes) * 60000
  const latestStartOffset = Math.max(0, windowMs - durMs)

  keys.forEach(key => {
    const offset = Math.random() * latestStartOffset
    const start = new Date(windowStart.getTime() + offset)
    const end = new Date(start.getTime() + durMs)
    schedule[key] = { start: start.toISOString(), end: end.toISOString() }
  })

  return schedule
}
