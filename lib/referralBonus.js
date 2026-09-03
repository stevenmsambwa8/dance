// ── Invite & Earn (referrals) ────────────────────────────────────────────
// Every member gets a personal invite link. When someone signs up through
// it AND verifies their phone number (via PhoneGate), the referrer is paid
// a flat TZS bonus — routed through the same `log_earning` RPC used
// everywhere else in the wallet, so it lands as a normal earnings_log row.
//
// Anti-spam, by design:
//  1. The bonus does NOT pay at signup. It only pays once the referred
//     account verifies a phone number — a throwaway account costs nothing
//     to create, so gating on phone verification is the real checkpoint.
//  2. Phone numbers are unique per account at the DB level
//     (profiles_phone_unique_idx in lib/referral-schema.sql), so the same
//     phone can't be reused to "verify" a farm of accounts referred by
//     yourself.
//  3. Payouts are capped at WEEKLY_REFERRAL_CAP per referrer per rolling
//     7 days. Referrals beyond the cap still register (the friend still
//     joins fine) but are marked `capped` instead of `paid`.
//
// Requires the SQL in lib/referral-schema.sql to have been run once.

export const REFERRAL_BONUS_TZS = 300
export const WEEKLY_REFERRAL_CAP = 10

const PENDING_CODE_KEY = 'nabogaming_pending_ref'

// ── Capture ?ref=CODE from the URL as soon as the app loads, so it survives
// navigation to /login and (for Google) the OAuth round-trip. Call once,
// high up in the tree (AuthProvider mount). Harmless no-op if absent. ──────
export function captureReferralFromURL() {
  if (typeof window === 'undefined') return
  try {
    const code = new URLSearchParams(window.location.search).get('ref')
    if (code && code.trim()) {
      localStorage.setItem(PENDING_CODE_KEY, code.trim().toUpperCase())
    }
  } catch {}
}

function takePendingReferralCode() {
  if (typeof window === 'undefined') return null
  try {
    const code = localStorage.getItem(PENDING_CODE_KEY)
    return code || null
  } catch { return null }
}

function clearPendingReferralCode() {
  try { localStorage.removeItem(PENDING_CODE_KEY) } catch {}
}

// ── Get-or-create a profile's own shareable code. Short, readable,
// collision-safe via retry-on-unique-violation. ────────────────────────────
export async function ensureReferralCode(supabase, userId, username) {
  let existing
  try {
    const res = await supabase
      .from('profiles').select('referral_code').eq('id', userId).maybeSingle()
    existing = res.data
  } catch (e) {
    console.error('ensureReferralCode lookup failed:', e)
    return null
  }
  if (existing?.referral_code) return existing.referral_code

  const base = (username || 'player').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase() || 'PLAYER'

  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.floor(1000 + Math.random() * 9000)
    const candidate = `${base}${suffix}`
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({ referral_code: candidate })
        .eq('id', userId)
        .select('referral_code')
        .maybeSingle()
      if (!error && data?.referral_code) return data.referral_code
      // 23505 = unique_violation → someone already holds that code, retry
    } catch (e) {
      console.error('ensureReferralCode update failed:', e)
    }
  }
  return null
}

// ── Called right after a new profile is inserted (both the email/password
// signUp() path and the Google OAuth fallback-insert path). Links the new
// account to whoever's code brought them here. Never throws — a referral
// hiccup should never block someone from actually signing up. ─────────────
export async function linkReferralOnSignup(supabase, newUserId) {
  try {
    const code = takePendingReferralCode()
    if (!code) return
    clearPendingReferralCode() // one-time use regardless of outcome below

    const { data: referrer } = await supabase
      .from('profiles').select('id').eq('referral_code', code).maybeSingle()
    if (!referrer || referrer.id === newUserId) return

    await supabase.from('profiles').update({ referred_by: referrer.id }).eq('id', newUserId)
    await supabase.from('referrals').insert({
      referrer_id: referrer.id,
      referred_id: newUserId,
      status: 'pending',
    })
  } catch (e) {
    console.error('linkReferralOnSignup failed:', e)
  }
}

// ── Called after a user's phone number is successfully saved (PhoneGate).
// If they were referred, this attempts the payout — atomically claiming the
// referral row first so a double-fire (re-render, retry) can't double-pay,
// then checking the referrer's trailing-7-day cap before awarding. ────────
export async function tryPayReferralBonus(supabase, referredUserId) {
  try {
    const { data: referral } = await supabase
      .from('referrals').select('*')
      .eq('referred_id', referredUserId)
      .eq('status', 'pending')
      .maybeSingle()
    if (!referral) return

    // Atomically claim it — only the caller that flips pending → processing
    // is allowed to decide the outcome.
    const { data: claimed } = await supabase
      .from('referrals')
      .update({ status: 'processing' })
      .eq('id', referral.id)
      .eq('status', 'pending')
      .select('id')
    if (!claimed?.length) return

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_id', referral.referrer_id)
      .eq('status', 'paid')
      .gte('paid_at', weekAgo)

    if ((count || 0) >= WEEKLY_REFERRAL_CAP) {
      await supabase.from('referrals').update({ status: 'capped' }).eq('id', referral.id)
      return
    }

    await supabase.rpc('log_earning', {
      p_user_id: referral.referrer_id,
      p_type: 'referral_bonus',
      p_points: REFERRAL_BONUS_TZS,
      p_description: 'Invite bonus — friend verified',
      p_ref_id: referral.id,
    })
    await supabase.from('referrals').update({
      status: 'paid',
      paid_at: new Date().toISOString(),
    }).eq('id', referral.id)
  } catch (e) {
    console.error('tryPayReferralBonus failed:', e)
  }
}
