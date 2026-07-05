import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCurrentSeason } from '../../../../lib/seasons'

const SUPABASE_URL = 'https://whnsrbxeqorolkjfcniy.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/**
 * GET /api/admin/seed-test-bots?secret=YOUR_SECRET&count=16
 *
 * One-time (or run-whenever-you-need-more) helper to create bot accounts for
 * Test Run tournaments.
 *
 * IMPORTANT: profiles.id is a foreign key into auth.users.id (see how
 * signUp() in components/AuthProvider.js creates profiles — it always uses
 * a real data.user.id from supabase.auth.signUp). That means a bot profile
 * can't just be a raw INSERT into `profiles` with a made-up UUID; it needs
 * a real auth.users row behind it, created here via the admin API.
 *
 * Safe to re-run: it only creates as many *new* bots as needed to reach
 * `count` total, skipping ones that already exist.
 */
export async function GET(request) {
  try {
    if (!SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const secret = searchParams.get('secret')
    if (!process.env.ADMIN_SEED_SECRET || secret !== process.env.ADMIN_SEED_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const targetCount = Math.min(Number(searchParams.get('count')) || 16, 50)

    const { data: existingBots } = await supabaseAdmin
      .from('profiles')
      .select('id, username')
      .eq('is_bot', true)

    const existingCount = existingBots?.length || 0
    const toCreate = Math.max(0, targetCount - existingCount)

    const created = []
    const errors = []
    const currentSeason = getCurrentSeason()

    for (let i = existingCount + 1; i <= existingCount + toCreate; i++) {
      const email = `bot${i}@bots.nabogaming.internal`
      const password = `Bot${i}-${Math.random().toString(36).slice(2)}!`

      const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (authErr || !authUser?.user) {
        errors.push({ i, step: 'auth', message: authErr?.message })
        continue
      }

      const { error: profileErr } = await supabaseAdmin.from('profiles').insert({
        id: authUser.user.id,
        username: `Test Player ${i}`,
        email,
        tier: 'Gold',
        rank: 99,
        wins: 0,
        losses: 0,
        points: 0,
        bio: 'Test account — used to fill Test Run tournaments.',
        play_style: 'Aggressive',
        current_season: currentSeason,
        season_wins: 0,
        season_losses: 0,
        is_season_winner: false,
        level: 1,
        is_bot: true,
      })

      if (profileErr) {
        errors.push({ i, step: 'profile', message: profileErr.message })
        // Roll back the orphaned auth user if the profile insert failed
        await supabaseAdmin.auth.admin.deleteUser(authUser.user.id)
        continue
      }

      created.push(`Test Player ${i}`)
    }

    return NextResponse.json({
      success: true,
      existingBotsBefore: existingCount,
      created,
      totalBotsNow: existingCount + created.length,
      errors,
    })
  } catch (err) {
    console.error('seed-test-bots error:', err)
    return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: 500 })
  }
}
