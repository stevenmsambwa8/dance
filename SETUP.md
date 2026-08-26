# Tournament Worker — Setup (5 minutes)

Free forever. No AI, no external API. Just your app talking to your own
Supabase database.

## Step 1 — Copy the files into your project

Unzip this, then copy folders so they land exactly like this in your
existing repo (same names, same spots):

```
your-project/
  lib/adminCommands.js          <- copy this in
  app/
    api/admin/command/route.js  <- copy this in
    worker/page.js               <- copy this in
```

## Step 2 — Install one package (if you don't already have it)

```bash
npm install @supabase/supabase-js
```

## Step 3 — Add your secrets to Vercel

Go to your Vercel project → Settings → Environment Variables, add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase dashboard → Settings → API → service_role key |
| `ADMIN_COMMAND_SECRET` | any password you make up — this is what unlocks your `/worker` page |

(See `.env.example` in this zip for the exact format.)

## Step 4 — Deploy

Push to git as usual, Vercel redeploys automatically.

## Step 5 — Use it

Go to `yoursite.com/worker`, type the password you set as
`ADMIN_COMMAND_SECRET`, type a tournament ID, tap a button.

That's it. It runs 24/7 on Vercel's servers — your phone can be off,
the site still works when you click the button from anywhere.

## Important — check your table names

The two commands `generate-group-stage` and `generate-bracket` assume
your Supabase tables are named `tournament_participants`,
`tournament_groups`, `tournament_group_members`, `group_fixtures`,
`group_standings`, `knockout_matches`. If your real table names are
different, open `lib/adminCommands.js` and change the `.from('...')`
names to match — that's the only thing you'd need to edit.

## Adding more buttons later

1. Open `lib/adminCommands.js`, write a new function, add it to `COMMANDS` at the bottom.
2. Open `app/worker/page.js`, add a new `<button>` that calls `run('your-command-name')`.

## Want it to run without you clicking anything?

Say the word and I'll add a scheduled job (Vercel Cron — also free) that,
for example, checks for stuck matches every hour automatically, with
zero taps from you.
