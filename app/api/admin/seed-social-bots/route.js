import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCurrentSeason } from '../../../../lib/seasons'

const SUPABASE_URL = 'https://whnsrbxeqorolkjfcniy.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Believable usernames — not "Test Player N". These show up publicly in
// feed posts and game chat, so they need to read as normal community
// members, not obviously synthetic.
const PERSONA_NAMES = [
  'Kelvin_TZ', 'AminaPlays', 'Rashidi256', 'MloziGaming', 'Zawadi_x',
  'Juma_Frags', 'NoraOnline', 'Baraka_GG', 'Fatuma_TZ', 'Emmanuel254',
]

/**
 * GET /api/admin/seed-social-bots?secret=YOUR_ADMIN_SEED_SECRET&count=8
 *
 * Same real-auth-user pattern as seed-test-bots (profiles.id is a foreign
 * key into auth.users — see that route's comment for why). These accounts
 * are flagged is_bot=true, bot_type='social' so:
 *  - they're automatically excluded from the public leaderboard and
 *    search (already filtered by is_bot in players/page.js + SearchSidebar)
 *  - delete-test-bots picks them up too, since it matches on
 *    email.ilike.%@bots.nabogaming.internal regardless of bot_type
 *
 * Requires a one-time SQL migration first:
 *   alter table profiles add column if not exists bot_type text;
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

    const targetCount = Math.min(Number(searchParams.get('count')) || PERSONA_NAMES.length, PERSONA_NAMES.length)

    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('username')
      .eq('bot_type', 'social')

    const existingNames = new Set((existing || []).map(p => p.username))
    const namesToCreate = PERSONA_NAMES.filter(n => !existingNames.has(n)).slice(0, targetCount)

    const created = []
    const errors = []
    const currentSeason = getCurrentSeason()

    for (const username of namesToCreate) {
      const emailSlug = username.toLowerCase().replace(/[^a-z0-9]/g, '')
      const email = `social-${emailSlug}@bots.nabogaming.internal`
      const password = `Social-${Math.random().toString(36).slice(2)}!`

      const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (authErr || !authUser?.user) {
        errors.push({ username, step: 'auth', message: authErr?.message })
        continue
      }

      const { error: profileErr } = await supabaseAdmin.from('profiles').insert({
        id: authUser.user.id,
        username,
        email,
        tier: 'Gold',
        rank: 99,
        wins: 0,
        losses: 0,
        points: 0,
        bio: '',
        play_style: 'Aggressive',
        current_season: currentSeason,
        season_wins: 0,
        season_losses: 0,
        is_season_winner: false,
        level: 1,
        is_bot: true,
        bot_type: 'social',
      })

      if (profileErr) {
        errors.push({ username, step: 'profile', message: profileErr.message })
        await supabaseAdmin.auth.admin.deleteUser(authUser.user.id)
        continue
      }

      created.push(username)
    }

    return NextResponse.json({
      success: true,
      created,
      totalSocialPersonasNow: existingNames.size + created.length,
      errors,
    })
  } catch (err) {
    console.error('seed-social-bots error:', err)
    return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: 500 })
  }
}
