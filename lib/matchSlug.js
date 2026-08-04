// matchSlug.js — turns two player/team names into a readable URL segment
// like "abi-vs-seti", and resolves one of those segments back to whichever
// match it refers to. Order-agnostic on resolution, since two different
// viewers of the same match will naturally generate "me-vs-them" in
// opposite orders.

export function slugifyName(name) {
  return String(name || 'player')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'player'
}

export function buildMatchupSlug(nameA, nameB) {
  return `${slugifyName(nameA)}-vs-${slugifyName(nameB)}`
}

// Given a "name-a-vs-name-b" URL segment, returns the two halves as a Set
// of slugs so callers can match against it regardless of which side is
// which. Returns null if the segment doesn't look like a matchup slug.
export function parseMatchupSlug(segment) {
  if (!segment) return null
  const idx = segment.indexOf('-vs-')
  if (idx === -1) return null
  const left = segment.slice(0, idx)
  const right = segment.slice(idx + 4)
  if (!left || !right) return null
  return new Set([left, right])
}

export function matchupSlugMatches(segment, nameA, nameB) {
  const wanted = parseMatchupSlug(segment)
  if (!wanted) return false
  const have = new Set([slugifyName(nameA), slugifyName(nameB)])
  if (wanted.size !== have.size) return false
  for (const s of wanted) if (!have.has(s)) return false
  return true
}
