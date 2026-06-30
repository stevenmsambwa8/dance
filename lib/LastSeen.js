

export function formatLastSeen(ts) {
  if (!ts) return 'Offline'
  const diffMs = Date.now() - new Date(ts).getTime()
  const s = Math.floor(diffMs / 1000)

  if (s < 30)     return 'Active now'
  if (s < 60)     return `Active ${s}s ago`
  if (s < 3600)   return `Active ${Math.floor(s / 60)}m ago`
  if (s < 86400)  return `Active ${Math.floor(s / 3600)}h ago`
  if (s < 172800) return 'Active yesterday'
  if (s < 604800) return `Active ${Math.floor(s / 86400)}d ago`

  return `Last seen ${new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}

/**
 * presenceLabel — single source of truth for status text + color.
 * isOnline should come from the live presence channel (useIsOnline),
 * NOT the profiles.online_status column.
 */
export function presenceLabel(isOnline, lastSeenTs) {
  if (isOnline) {
    return { text: 'Active now', color: '#22c55e', dotColor: '#22c55e' }
  }
  return {
    text: formatLastSeen(lastSeenTs),
    color: 'var(--text-muted)',
    dotColor: 'var(--border-dark)',
  }
}
