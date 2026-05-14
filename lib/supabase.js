import { createClient } from '@supabase/supabase-js'

const URL = 'https://whnsrbxeqorolkjfcniy.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobnNyYnhlcW9yb2xramZjbml5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjY3NzYsImV4cCI6MjA5MDY0Mjc3Nn0.7ZlmI1T8o-7Dm7BuUuG9wNWPaCU8yZ8O8pIFX5QBlx0'

export const supabase = createClient(URL, ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'nabogaming-auth',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
})
