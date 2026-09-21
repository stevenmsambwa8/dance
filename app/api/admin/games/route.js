import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { ADMIN_EMAILS, isAdminUser } from '../../../../lib/adminAccess'
import { GAME_SLUGS } from '../../../../lib/constants'

const SUPABASE_URL  = 'https://whnsrbxeqorolkjfcniy.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobnNyYnhlcW9yb2xramZjbml5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjY3NzYsImV4cCI6MjA5MDY0Mjc3Nn0.7ZlmI1T8o-7Dm7BuUuG9wNWPaCU8yZ8O8pIFX5QBlx0'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Same rule as the other admin routes: permanent admin (email) or an active temp admin.
async function getRequestingAdmin(request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAnon.auth.getUser(token)
  if (!user) return null
  if (ADMIN_EMAILS.includes(user.email)) return { user, isPermanentAdmin: true }
  const { data: requesterProfile } = await supabaseAdmin
    .from('profiles').select('temp_admin_until').eq('id', user.id).maybeSingle()
  if (!isAdminUser(user.email, requesterProfile)) return null
  return { user, isPermanentAdmin: false }
}

/**
 * POST /api/admin/games
 * Body: { slug, action: 'show' | 'hide' | 'disable' | 'delete', until?, note? }
 *
 *  show    → back to live (not allowed once a game is deleted)
 *  hide    → hidden everywhere on the site
 *  disable → unavailable until `until` (ISO date, must be in the future)
 *  delete  → removed forever. Permanent admins only. Also wipes the game's
 *            subscriptions. Tournaments/matches history is left untouched.
 */
export async function POST(request) {
  const admin = await getRequestingAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Not authorised' }, { status: 403 })

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const { slug, action, until, note } = body || {}

  if (!GAME_SLUGS.includes(slug)) return NextResponse.json({ error: 'Unknown game' }, { status: 400 })
  if (!['show', 'hide', 'disable', 'delete'].includes(action)) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const { data: existing } = await supabaseAdmin
    .from('game_settings').select('status').eq('slug', slug).maybeSingle()

  if (existing?.status === 'deleted') {
    return NextResponse.json({ error: 'This game was deleted permanently and cannot be changed.' }, { status: 409 })
  }

  const base = { slug, updated_by: admin.user.id, updated_at: new Date().toISOString() }
  let row

  if (action === 'show') {
    row = { ...base, status: 'active', disabled_until: null, note: null }
  } else if (action === 'hide') {
    row = { ...base, status: 'hidden', disabled_until: null, note: null }
  } else if (action === 'disable') {
    const t = until ? new Date(until).getTime() : NaN
    if (!Number.isFinite(t) || t <= Date.now()) {
      return NextResponse.json({ error: 'Pick a date and time in the future.' }, { status: 400 })
    }
    row = { ...base, status: 'disabled', disabled_until: new Date(t).toISOString(), note: (note || '').toString().slice(0, 200) || null }
  } else {
    if (!admin.isPermanentAdmin) {
      return NextResponse.json({ error: 'Only a permanent admin can delete a game forever.' }, { status: 403 })
    }
    row = { ...base, status: 'deleted', disabled_until: null, note: null }
  }

  const { error } = await supabaseAdmin.from('game_settings').upsert(row, { onConflict: 'slug' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (action === 'delete') {
    // Best-effort cleanup — the game is already gone from the site either way.
    await supabaseAdmin.from('game_subscriptions').delete().eq('game_slug', slug)
  }

  return NextResponse.json({ ok: true, setting: row })
}
