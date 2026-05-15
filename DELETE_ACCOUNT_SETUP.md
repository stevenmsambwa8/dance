# Delete Account — Setup Guide

## 1. Add environment variables to `.env.local`

The API route `/api/delete-account` uses the Supabase **service_role** key 
(server-side only — never exposed to the browser). Add these to your `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://whnsrbxeqorolkjfcniy.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobnNyYnhlcW9yb2xramZjbml5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjY3NzYsImV4cCI6MjA5MDY0Mjc3Nn0.7ZlmI1T8o-7Dm7BuUuG9wNWPaCU8yZ8O8pIFX5QBlx0
SUPABASE_SERVICE_ROLE_KEY=<your service_role key here>
```

### Where to find your service_role key:
Supabase Dashboard → Project Settings → API → **service_role** (secret) key

⚠️ Never put the service_role key in client-side code or commit it to Git.

---

## 2. Run SETTINGS_SQL.sql in Supabase SQL Editor

This adds the `notif_match`, `notif_shop`, `notif_tournament`, `phone` columns
and sets up RLS policies. The `delete_my_account()` function is optional now
since the API route handles deletion — but run it anyway for the RLS policies
and indexes.

---

## 3. How the delete flow works

1. User taps "Delete Account" → confirmation modal opens
2. User types "DELETE" → "Delete Forever" button activates
3. Client gets the current session JWT (`supabase.auth.getSession()`)
4. Client POSTs to `/api/delete-account` with the JWT in Authorization header
5. Server verifies the JWT, deletes all user data from public tables
6. Server calls `supabase.auth.admin.deleteUser(uid)` — only possible server-side
7. Client receives success → signs out locally → redirects to /login
8. User cannot log back in because the auth record is permanently gone

---

## 4. Deploy to Vercel

Add the environment variables in Vercel Dashboard → Project → Settings → Environment Variables.
Do NOT add `SUPABASE_SERVICE_ROLE_KEY` as a `NEXT_PUBLIC_` variable.
