import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { ADMIN_EMAILS, isAdminUser } from '../../../../lib/adminAccess'

const SUPABASE_URL  = 'https://whnsrbxeqorolkjfcniy.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobnNyYnhlcW9yb2xramZjbml5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjY3NzYsImV4cCI6MjA5MDY0Mjc3Nn0.7ZlmI1T8o-7Dm7BuUuG9wNWPaCU8yZ8O8pIFX5QBlx0'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function getRequestingAdmin(request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAnon.auth.getUser(token)
  if (!user) return null
  if (ADMIN_EMAILS.includes(user.email)) return user
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('temp_admin_until').eq('id', user.id).maybeSingle()
  return isAdminUser(user.email, profile) ? user : null
}

/**
 * GET /api/admin/login-methods
 * Returns every auth user with the sign-in methods linked to their account
 * (email, google, …). The browser can't read auth.users, so this runs with
 * the service-role key after confirming the caller is an admin.
 */
export async function GET(request) {
  const admin = await getRequestingAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Not authorised' }, { status: 403 })

  const PER_PAGE = 1000
  const out = []
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PER_PAGE })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const users = data?.users || []
    for (const u of users) {
      const fromIdentities = (u.identities || []).map(i => i.provider)
      const fromMeta = Array.isArray(u.app_metadata?.providers) ? u.app_metadata.providers
                     : (u.app_metadata?.provider ? [u.app_metadata.provider] : [])
      const providers = [...new Set([...fromIdentities, ...fromMeta])].filter(Boolean)
      out.push({
        id: u.id,
        email: u.email || null,
        providers,
        last_sign_in_at: u.last_sign_in_at || null,
        created_at: u.created_at || null,
      })
    }
    if (users.length < PER_PAGE) break
  }

  return NextResponse.json({ users: out })
}
