// Shared per-tournament-row status math, used by every layout so the
// open/full/pending/ongoing logic only has to be correct in one place.
export function tournamentStatus(t, data) {
  const isJoined  = !!data.registered[t.id]
  const hasFee    = (t.entrance_fee || 0) > 0
  const pmtStatus = data.paymentMap[t.id]
  const isPending = pmtStatus === 'payment_submitted'
  const isFull    = (t.registered_count || 0) >= t.slots && !isJoined
  const fillPct   = Math.min(100, ((t.registered_count || 0) / (t.slots || 1)) * 100)
  const isOngoing = t.status === 'ongoing'
  return { isJoined, hasFee, isPending, isFull, fillPct, isOngoing }
}

export function onRowClick(t, data, status) {
  if (status.isOngoing) data.router.push(`/tournaments/${t.slug || t.id}`)
  else data.setSelected(t)
}

export function fmtFee(n) { return Number(n).toLocaleString() }
