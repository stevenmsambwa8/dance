-- ============================================================================
-- Nabogaming — Invite & Earn (referral) feature schema
-- Run this once in Supabase Dashboard → SQL Editor.
-- Mirrors the conventions of events-schema.sql / the existing tournaments table.
-- ============================================================================

-- ── profiles: referral identity ────────────────────────────────────────────
alter table public.profiles
  add column if not exists referral_code text unique,
  add column if not exists referred_by   uuid references public.profiles(id);

create index if not exists profiles_referred_by_idx on public.profiles (referred_by);

-- ── Anti-spam: one phone number per account ────────────────────────────────
-- Enforced at the DB level so a phone can't be reused to verify a farm of
-- throwaway accounts. Partial index so it only applies once a phone is set.
create unique index if not exists profiles_phone_unique_idx
  on public.profiles (phone) where phone is not null;

-- ── referrals ───────────────────────────────────────────────────────────────
-- One row per referred signup. status:
--   pending    — referred user signed up, hasn't verified phone yet
--   processing — payout claimed, being awarded (short-lived, prevents double-pay)
--   paid       — 300 TZS awarded to the referrer
--   capped     — referrer had already hit the weekly cap, no bonus paid
create table if not exists public.referrals (
  id           uuid primary key default gen_random_uuid(),
  referrer_id  uuid not null references public.profiles(id) on delete cascade,
  referred_id  uuid not null unique references public.profiles(id) on delete cascade,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  paid_at      timestamptz,
  check (referrer_id <> referred_id)
);

create index if not exists referrals_referrer_idx      on public.referrals (referrer_id);
create index if not exists referrals_referrer_paid_idx  on public.referrals (referrer_id, status, paid_at);

alter table public.referrals enable row level security;

-- A user can see referrals where they're either side (their invite list, or
-- the "who invited me" record).
drop policy if exists "referrals_select_own" on public.referrals;
create policy "referrals_select_own"
  on public.referrals for select
  using (auth.uid() = referrer_id or auth.uid() = referred_id);

-- The referred user's own client is the one that creates the row right after
-- signup, so the insert must be allowed as long as they're inserting
-- themselves as the referred_id.
drop policy if exists "referrals_insert_self" on public.referrals;
create policy "referrals_insert_self"
  on public.referrals for insert
  with check (auth.uid() = referred_id);

-- Either party's client may flip status (referred user triggers payout after
-- verifying phone; the cap/claim logic runs as an update from that session).
drop policy if exists "referrals_update_own" on public.referrals;
create policy "referrals_update_own"
  on public.referrals for update
  using (auth.uid() = referrer_id or auth.uid() = referred_id);
