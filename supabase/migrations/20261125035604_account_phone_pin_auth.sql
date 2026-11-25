create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  phone text not null unique,
  role text not null default 'user' check (role in ('user','admin')),
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
for select to authenticated
using ((select auth.uid()) = id or ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));
drop policy if exists profiles_insert_self_user on public.profiles;
create policy profiles_insert_self_user on public.profiles
for insert to authenticated
with check ((select auth.uid()) = id and role = 'user');
drop policy if exists profiles_update_admin_only on public.profiles;
create policy profiles_update_admin_only on public.profiles
for update to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
revoke all on public.profiles from anon;
grant select, insert on public.profiles to authenticated;
grant update on public.profiles to authenticated;

create table if not exists public.phone_pin_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null default now(),
  hits integer not null default 0 check (hits >= 0),
  updated_at timestamptz not null default now()
);
alter table public.phone_pin_rate_limits enable row level security;
revoke all on public.phone_pin_rate_limits from anon, authenticated;
grant all on public.phone_pin_rate_limits to service_role;

create or replace function public.consume_phone_pin_rate_limit(
  p_rate_key text, p_limit integer, p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare v_hits integer;
begin
  if p_rate_key is null or length(p_rate_key) < 16
     or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;
  insert into public.phone_pin_rate_limits(rate_key,window_started_at,hits,updated_at)
  values(p_rate_key,clock_timestamp(),1,clock_timestamp())
  on conflict(rate_key) do update
    set hits = case
      when public.phone_pin_rate_limits.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds) then 1
      else public.phone_pin_rate_limits.hits + 1 end,
    window_started_at = case
      when public.phone_pin_rate_limits.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds) then clock_timestamp()
      else public.phone_pin_rate_limits.window_started_at end,
    updated_at = clock_timestamp()
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$function$;
revoke all on function public.consume_phone_pin_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_phone_pin_rate_limit(text,integer,integer) to service_role;