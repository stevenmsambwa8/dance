# Delete Account — Setup Guide

## Only ONE environment variable needed

The URL and anon key are already hardcoded in `lib/supabase.js` — the API route
reuses them directly. The only thing you need to add is the **service_role key**,
which is the only credential that can delete from `auth.users`.

### Add to `.env.local` (local dev):
```
SUPABASE_SERVICE_ROLE_KEY=<your service_role key here>
```

### Add to Vercel (production):
Vercel Dashboard → Your Project → Settings → Environment Variables → Add:
- Name: `SUPABASE_SERVICE_ROLE_KEY`
- Value: your service_role key
- Environment: Production + Preview + Development

### Where to find the service_role key:
Supabase Dashboard → Project Settings → API → **service_role** (the "secret" one, not anon)

⚠️ Never prefix it with `NEXT_PUBLIC_` — that would expose it to the browser.

---

## How deletion works

1. User taps "Delete Account" → confirmation modal
2. User types DELETE → button activates
3. Client sends JWT to `/api/delete-account`
4. Server verifies JWT, deletes all rows from every table
5. Server calls `auth.admin.deleteUser()` — permanently removes auth record
6. User is signed out and redirected to /login — cannot log back in

---

## Run SETTINGS_SQL.sql in Supabase SQL Editor

Adds `notif_match`, `notif_shop`, `notif_tournament`, `phone` columns to profiles,
sets up RLS policies, and adds performance indexes.
