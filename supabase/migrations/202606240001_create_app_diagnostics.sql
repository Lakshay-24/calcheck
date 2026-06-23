create table if not exists public.app_diagnostics (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid null references auth.users(id) on delete set null,
  session_id text,
  event_name text not null,
  level text not null check (level in ('info', 'warn', 'error')),
  screen text,
  operation text,
  message text,
  normalized_message text,
  error_code text,
  http_status integer,
  duration_ms integer,
  app_version text,
  platform text,
  is_pwa boolean,
  is_online boolean,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists app_diagnostics_created_at_idx
  on public.app_diagnostics (created_at desc);

create index if not exists app_diagnostics_user_created_at_idx
  on public.app_diagnostics (user_id, created_at desc);

create index if not exists app_diagnostics_event_created_at_idx
  on public.app_diagnostics (event_name, created_at desc);

alter table public.app_diagnostics enable row level security;

create policy "Users can insert own app diagnostics"
  on public.app_diagnostics
  for insert
  to authenticated
  with check (user_id is null or auth.uid() = user_id);

create policy "Users can read own app diagnostics"
  on public.app_diagnostics
  for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.prune_app_diagnostics()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.app_diagnostics
  where created_at < now() - interval '14 days';

  delete from public.app_diagnostics d
  using (
    select id
    from (
      select
        id,
        row_number() over (partition by user_id order by created_at desc) as row_number
      from public.app_diagnostics
      where user_id is not null
    ) ranked
    where ranked.row_number > 300
  ) old_rows
  where d.id = old_rows.id;

  delete from public.app_diagnostics
  where user_id is null
    and created_at < now() - interval '7 days';
end;
$$;