// ── Season System ─────────────────────────────────────────────────────────────
const SEASON_START = new Date('2026-04-01T00:00:00Z')
const SEASON_DURATION_MONTHS = 2

export function getCurrentSeason() {
  const now = new Date()
  const yearDiff = now.getUTCFullYear() - SEASON_START.getUTCFullYear()
  const monthDiff = now.getUTCMonth() - SEASON_START.getUTCMonth()
  const totalMonths = yearDiff * 12 + monthDiff
  return Math.max(1, Math.floor(totalMonths / SEASON_DURATION_MONTHS) + 1)
}

export function getSeasonDateRange(seasonNumber) {
  const startMonthOffset = (seasonNumber - 1) * SEASON_DURATION_MONTHS
  const start = new Date(SEASON_START)
  start.setUTCMonth(start.getUTCMonth() + startMonthOffset)
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + SEASON_DURATION_MONTHS)
  end.setUTCDate(end.getUTCDate() - 1)
  return { start, end }
}

export function getSeasonLabel(seasonNumber) {
  const { start, end } = getSeasonDateRange(seasonNumber)
  const startStr = start.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  const endStr   = end.toLocaleDateString('en-US',   { month: 'short', timeZone: 'UTC' })
  return `Season ${seasonNumber} · ${endStr}–${startStr}`
}

export function getDaysRemaining() {
  const current = getCurrentSeason()
  const { end } = getSeasonDateRange(current)
  const diff = end - new Date()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

// ── Level System (1–100) ──────────────────────────────────────────────────────
// Rules:
//   Level 1–2:   10 season wins to advance
//   Level 3–24:  25 season wins to advance
//   Level 25–99: 100 season wins to advance
//   Level 100:   max, no advancement
//   Season end:  if wins < threshold → drop 2 levels (min 1)

export const MAX_LEVEL = 100

/**
 * Returns the number of season wins required to advance FROM a given level.
 */
export function getLevelWinThreshold(level) {
  if (level >= 100) return Infinity
  if (level <= 2)   return 10
  if (level <= 24)  return 25
  return 100 // level 25–99
}

/**
 * Compute new level after recording wins this season.
 * Only advances when season_wins >= threshold for current level.
 * @param {number} currentLevel
 * @param {number} seasonWins - total wins this season so far (including this win)
 * @returns {number} new level (capped at MAX_LEVEL)
 */
export function computeLevelAfterWin(currentLevel, seasonWins) {
  const level = Math.max(1, currentLevel || 1)
  if (level >= MAX_LEVEL) return MAX_LEVEL
  const threshold = getLevelWinThreshold(level)
  if (seasonWins >= threshold) {
    return Math.min(MAX_LEVEL, level + 1)
  }
  return level
}

/**
 * Compute level at start of a new season.
 * If player did NOT reach the threshold last season → drop 2 levels (min 1).
 * @param {number} currentLevel
 * @param {number} seasonWins - wins from the season that just ended
 * @returns {number} new level for the fresh season
 */
export function computeLevelOnSeasonReset(currentLevel, seasonWins) {
  const level = Math.max(1, currentLevel || 1)
  const threshold = getLevelWinThreshold(level)
  if (seasonWins < threshold) {
    return Math.max(1, level - 2)
  }
  return level
}

// ── Tier Progression (visual badge, separate from level) ──────────────────────
export const TIER_ORDER = ['Gold', 'Platinum', 'Diamond', 'Ace', 'Conquer', 'Partner']

export const TIER_WIN_THRESHOLD = {
  Gold:     50,
  Platinum: 50,
  Diamond:  50,
  Ace:      100,
  Conquer:  100,
  Partner:  100,
}

export const LOSS_DROP_THRESHOLD = 30

export function computeSeasonResetTier(currentTier, seasonLosses) {
  const idx = TIER_ORDER.indexOf(currentTier)
  if (idx <= 0) return TIER_ORDER[0]
  if (seasonLosses >= LOSS_DROP_THRESHOLD) return TIER_ORDER[idx - 1]
  return currentTier
}

export function computeTierAfterWin(currentTier, seasonWins) {
  const idx = TIER_ORDER.indexOf(currentTier)
  if (idx === TIER_ORDER.length - 1) return currentTier
  const threshold = TIER_WIN_THRESHOLD[currentTier]
  if (seasonWins >= threshold) return TIER_ORDER[idx + 1]
  return currentTier
}
