-- Hexagon Sector Map: database setup.
-- Run this once in the Supabase SQL editor (Dashboard > SQL Editor > New query).

-- Every piece of game state is one JSON document, grouped by room (one room = one game).
create table if not exists public.docs (
  room        text        not null,
  path        text        not null,
  collection  text        not null,
  data        jsonb       not null,
  updated_at  timestamptz not null default now(),
  primary key (room, path)
);
create index if not exists docs_room_collection on public.docs (room, collection);

-- Keep updated_at current so clients can ignore stale copies
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs
  for each row execute function public.touch_updated_at();

-- Short leases so two players can't grab the same seat at the same moment
create table if not exists public.leases (
  room        text        not null,
  path        text        not null,
  holder      text        not null,
  expires_at  timestamptz not null,
  primary key (room, path)
);

create or replace function public.acquire_lease(p_room text, p_path text, p_holder text, p_ttl_ms int)
returns boolean language plpgsql security definer set search_path = public as $$
declare got boolean;
begin
  insert into leases (room, path, holder, expires_at)
  values (p_room, p_path, p_holder, now() + make_interval(secs => greatest(1000, least(p_ttl_ms, 600000)) / 1000.0))
  on conflict (room, path) do update
    set holder = excluded.holder, expires_at = excluded.expires_at
    where leases.expires_at < now() or leases.holder = excluded.holder
  returning true into got;
  return coalesce(got, false);
end $$;

-- Realtime: send row changes to connected players (full rows so deletes include the room)
alter table public.docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- Access. Version 1 trusts anyone who has the app's public key: fine for a private
-- game among friends, NOT for a public app. See README "Hardening" before going wide.
alter table public.docs enable row level security;
alter table public.leases enable row level security;
drop policy if exists "players read docs" on public.docs;
drop policy if exists "players write docs" on public.docs;
drop policy if exists "players insert docs" on public.docs;
drop policy if exists "players update docs" on public.docs;
drop policy if exists "players delete docs" on public.docs;
create policy "players read docs"   on public.docs for select to anon, authenticated using (true);
-- Players may create the very first map, but only admins (through api/admin.js, which uses
-- the service key and skips these rules) can change or remove it afterwards.
create policy "players insert docs" on public.docs for insert to anon, authenticated with check (true);
create policy "players update docs" on public.docs for update to anon, authenticated
  using (path <> 'game/state') with check (path <> 'game/state');
create policy "players delete docs" on public.docs for delete to anon, authenticated
  using (path <> 'game/state');
grant select, insert, update, delete on public.docs to anon, authenticated;
grant execute on function public.acquire_lease(text, text, text, int) to anon, authenticated;
