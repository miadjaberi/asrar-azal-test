alter table public.profiles
  add column if not exists last_login_at timestamptz;

comment on column public.profiles.last_login_at is
  'Timestamp of the most recent successful phone/PIN login; written by the server-side auth function.';
