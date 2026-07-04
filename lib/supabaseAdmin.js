/**
 * lib/supabaseAdmin.js
 * Server-only Supabase client using the SERVICE ROLE key.
 * This bypasses Row Level Security — never import it into 'use client' code,
 * and only use it in trusted server contexts (API routes, webhooks) where
 * there is no user session to authenticate the request naturally.
 *
 * Get the service role key from: Supabase Dashboard -> Project Settings -> API
 */
import { createClient } from '@supabase/supabase-js'

const URL = 'https://whnsrbxeqorolkjfcniy.supabase.co'

export function getSupabaseAdmin() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }
  return createClient(URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
