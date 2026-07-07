// ── Tournament join bonuses ──────────────────────────────────────────────
// Every player gets a small TZS bonus the moment they join a tournament,
// and once every slot fills up, everyone registered gets an extra bonus
// on top. Both ride on the same `log_earning` RPC already used for prize
// payouts elsewhere, so they land in the wallet as real TZS earnings
// (profiles.points + an earnings_log row) with zero new backend plumbing.
//
// Requires one new column, added once via SQL:
//   alter table tournaments add column if not exists full_bonus_awarded boolean not null default false;

export const JOIN_BONUS_TZS = 100
export const FULL_SLOTS_BONUS_TZS = 250

/**
 * Pays the flat per-join bonus to one player. Never throws — a bonus
 * hiccup should never block someone from actually registering.
 */
export async function awardJoinBonus(supabase, userId, tournamentId, tournamentName) {
  if (!userId || !tournamentId) return
  try {
    await supabase.rpc('log_earning', {
      p_user_id: userId,
      p_type: 'join_bonus',
      p_points: JOIN_BONUS_TZS,
      p_description: `Join bonus — ${tournamentName || 'tournament'}`,
      p_ref_id: tournamentId,
    })
  } catch (e) {
    console.error('awardJoinBonus failed:', e)
  }
}

/**
 * Call once after any successful join. Checks whether the tournament has
 * just reached capacity and, if so, pays every registered participant a
 * one-time bonus. Guarded by the `full_bonus_awarded` flag on `tournaments`
 * so a burst of near-simultaneous joins can't pay it out twice.
 *
 * `sendNotification` is optional — pass the page's local helper
 * (userId, title, body, type, meta) => Promise if you want players pinged.
 */
export async function maybeAwardFullSlotsBonus(supabase, tournamentId, tournamentName, capacity, sendNotification) {
  if (!tournamentId || !capacity) return
  try {
    const { count } = await supabase
      .from('tournament_participants')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
    if ((count || 0) < capacity) return

    // Atomically claim the flag — only the request that actually flips it
    // false → true is allowed to pay everyone out.
    const { data: claimed } = await supabase
      .from('tournaments')
      .update({ full_bonus_awarded: true })
      .eq('id', tournamentId)
      .eq('full_bonus_awarded', false)
      .select('id')
    if (!claimed?.length) return

    const { data: participants } = await supabase
      .from('tournament_participants')
      .select('user_id')
      .eq('tournament_id', tournamentId)

    await Promise.all((participants || []).map(async p => {
      await supabase.rpc('log_earning', {
        p_user_id: p.user_id,
        p_type: 'full_bonus',
        p_points: FULL_SLOTS_BONUS_TZS,
        p_description: `Full slots bonus — ${tournamentName || 'tournament'}`,
        p_ref_id: tournamentId,
      })
      if (sendNotification) {
        await sendNotification(
          p.user_id,
          `Slots full — ${tournamentName || 'tournament'}`,
          `All slots filled! You've been awarded a TZS ${FULL_SLOTS_BONUS_TZS} bonus.`,
          'tournament',
          { tournament_id: tournamentId }
        )
      }
    }))
  } catch (e) {
    console.error('maybeAwardFullSlotsBonus failed:', e)
  }
}
