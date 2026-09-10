// Shared cooldown logic for identity-sensitive profile fields
// (username, profile picture, country flag). Mirrors the window enforced
// server-side by the trigger in lib/profile-lock-schema.sql — keep both in sync.

export const PROFILE_LOCK_DAYS = 60

// Returns whole days left until a field unlocks, or 0 if it's unlocked
// (including when changedAt is null/undefined, i.e. never changed).
export function daysRemaining(changedAt) {
  if (!changedAt) return 0
  const changed = new Date(changedAt).getTime()
  if (Number.isNaN(changed)) return 0
  const unlockAt = changed + PROFILE_LOCK_DAYS * 24 * 60 * 60 * 1000
  const msLeft = unlockAt - Date.now()
  return msLeft > 0 ? Math.ceil(msLeft / (24 * 60 * 60 * 1000)) : 0
}

export function isLocked(changedAt) {
  return daysRemaining(changedAt) > 0
}

export function lockMessage(label, changedAt) {
  const days = daysRemaining(changedAt)
  return `${label} is locked for ${days} more day${days === 1 ? '' : 's'}. It can only be changed once every ${PROFILE_LOCK_DAYS} days.`
}
