/**
 * clanColors.js — deterministic identity color per squad/clan,
 * derived from its name so the same squad always renders the
 * same accent color across every page, with no DB column needed.
 */

const PALETTE = [
  '#f2b339', // amber
  '#38bdf8', // cyan
  '#ef4444', // crimson
  '#22c55e', // emerald
  '#a855f7', // violet
  '#fb923c', // orange
  '#ec4899', // pink
  '#14b8a6', // teal
]

export function identityColor(seed) {
  if (!seed) return PALETTE[0]
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}
