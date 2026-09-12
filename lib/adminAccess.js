// Central definition of "who is an admin" for Nabogaming.
//
// Two ways in:
//  1. Permanent admin — email is in ADMIN_EMAILS (hard-coded, same as before).
//  2. Temporary admin — profiles.temp_admin_until is set to a future time.
//     Granted/revoked from the admin dashboard (edit-user page). Expires on
//     its own, and an admin can clear it ("disconnect") at any moment.
//
// Keep this file as the single source of truth — anywhere that used to
// re-declare its own ADMIN_EMAILS array/check should import from here
// instead so temp-admin grants actually take effect everywhere.

export const ADMIN_EMAILS = ['stevenmsambwa8@gmail.com', 'nabogamingss1@gmail.com']
export const ADMIN_EMAIL = ADMIN_EMAILS[0] // backward compat

export function hasActiveTempAdmin(profile) {
  if (!profile?.temp_admin_until) return false
  const until = new Date(profile.temp_admin_until).getTime()
  return Number.isFinite(until) && until > Date.now()
}

// True if this email/profile counts as an admin right now.
export function isAdminUser(email, profile) {
  return ADMIN_EMAILS.includes(email) || hasActiveTempAdmin(profile)
}

// True only for the temp-admin path (permanent admins don't need this).
export function isTempAdminOnly(email, profile) {
  return !ADMIN_EMAILS.includes(email) && hasActiveTempAdmin(profile)
}
