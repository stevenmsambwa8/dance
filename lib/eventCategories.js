// ── Nabogaming Event Categories ──
// Shared across app/events/* so the listing, create form, view, and manage
// pages all render the same tag colors/icons/labels.

export const EVENT_CATEGORIES = ['tournament', 'giveaway', 'community', 'news', 'other']

export const EVENT_CATEGORY_META = {
  tournament: { label: 'Tournament', icon: 'ri-trophy-line',      color: '#f59e0b' },
  giveaway:   { label: 'Giveaway',   icon: 'ri-gift-line',        color: '#a855f7' },
  community:  { label: 'Community',  icon: 'ri-group-line',       color: '#22c55e' },
  news:       { label: 'News',       icon: 'ri-megaphone-line',   color: '#3b82f6' },
  other:      { label: 'Other',      icon: 'ri-calendar-event-line', color: '#8e8e93' },
}

// Status is mostly derived from start_at/end_at, but 'cancelled' is a manual
// admin override (kept in the DB) that always wins over the derived value.
export function deriveEventStatus(ev) {
  if (ev.status === 'cancelled') return 'cancelled'
  const now = Date.now()
  const start = ev.start_at ? new Date(ev.start_at).getTime() : null
  const end = ev.end_at ? new Date(ev.end_at).getTime() : start
  if (start && now < start) return 'upcoming'
  if (end && now > end) return 'ended'
  if (start) return 'live'
  return 'upcoming'
}

export const EVENT_STATUS_META = {
  upcoming:  { label: 'Upcoming',  color: '#3b82f6' },
  live:      { label: 'Live Now',  color: '#22c55e' },
  ended:     { label: 'Ended',     color: '#8e8e93' },
  cancelled: { label: 'Cancelled', color: '#ef4444' },
}

export function slugifyEvent(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

export function formatEventDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}
