-- ============================================================================
-- Nabogaming — Events feature schema
-- Run this once in Supabase Dashboard → SQL Editor.
-- Mirrors the conventions of the existing `tournaments` table.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── events ──────────────────────────────────────────────────────────────────
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  slug          text not null unique,
  category      text not null default 'other',      -- tournament | giveaway | community | news | other
  description   text,
  location      text,                                -- venue name, or "Online"
  location_link text,                                 -- optional map / discord / stream link
  banner_url    text,
  start_at      timestamptz not null,
  end_at        timestamptz,
  status        text not null default 'upcoming',     -- upcoming | live | ended | cancelled (manual override only)
  rsvp_count    int not null default 0,
  is_test       boolean not null default false,
  created_by    uuid not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists events_start_at_idx on public.events (start_at desc);
create index if not exists events_created_by_idx on public.events (created_by);

-- ── event_rsvps ─────────────────────────────────────────────────────────────
create table if not exists public.event_rsvps (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (event_id, user_id)
);

-- Keep events.rsvp_count in sync automatically.
create or replace function public.events_sync_rsvp_count() returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    update public.events set rsvp_count = rsvp_count + 1 where id = new.event_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.events set rsvp_count = greatest(0, rsvp_count - 1) where id = old.event_id;
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_events_rsvp_insert on public.event_rsvps;
create trigger trg_events_rsvp_insert
  after insert on public.event_rsvps
  for each row execute function public.events_sync_rsvp_count();

drop trigger if exists trg_events_rsvp_delete on public.event_rsvps;
create trigger trg_events_rsvp_delete
  after delete on public.event_rsvps
  for each row execute function public.events_sync_rsvp_count();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;

-- NOTE: keep this list identical to ADMIN_EMAILS in components/AuthProvider.js.
create or replace function public.is_nabogaming_admin() returns boolean as $$
  select coalesce(auth.jwt() ->> 'email', '') in (
    'stevenmsambwa8@gmail.com',
    'nabogamingss1@gmail.com'
  );
$$ language sql stable;

-- Anyone can read events.
drop policy if exists "events_select_all" on public.events;
create policy "events_select_all" on public.events for select using (true);

-- Only admins can create/edit/delete events, and only as themselves.
drop policy if exists "events_insert_admin" on public.events;
create policy "events_insert_admin" on public.events for insert
  with check (public.is_nabogaming_admin() and created_by = auth.uid());

drop policy if exists "events_update_admin" on public.events;
create policy "events_update_admin" on public.events for update
  using (public.is_nabogaming_admin());

drop policy if exists "events_delete_admin" on public.events;
create policy "events_delete_admin" on public.events for delete
  using (public.is_nabogaming_admin());

-- RSVPs: anyone can read; a signed-in user can only RSVP/un-RSVP themselves.
drop policy if exists "event_rsvps_select_all" on public.event_rsvps;
create policy "event_rsvps_select_all" on public.event_rsvps for select using (true);

drop policy if exists "event_rsvps_insert_self" on public.event_rsvps;
create policy "event_rsvps_insert_self" on public.event_rsvps for insert
  with check (user_id = auth.uid());

drop policy if exists "event_rsvps_delete_self" on public.event_rsvps;
create policy "event_rsvps_delete_self" on public.event_rsvps for delete
  using (user_id = auth.uid());
