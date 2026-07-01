create table if not exists public.meal_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_log_id uuid null references public.meal_logs(id) on delete set null,
  source text not null default 'unknown',
  feedback_type text not null,
  original_snapshot jsonb null,
  corrected_snapshot jsonb null,
  constraint meal_feedback_type_check check (feedback_type in ('confirmed', 'corrected', 'deleted', 'incorrect')),
  constraint meal_feedback_source_check check (source in ('photo', 'image', 'text', 'voice_transcript', 'unknown'))
);

create index if not exists meal_feedback_user_created_at_idx
  on public.meal_feedback (user_id, created_at desc);

create index if not exists meal_feedback_meal_log_id_idx
  on public.meal_feedback (meal_log_id);

alter table public.meal_feedback enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'meal_feedback'
      and policyname = 'Users can insert own meal feedback'
  ) then
    create policy "Users can insert own meal feedback"
      on public.meal_feedback for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'meal_logs'
      and policyname = 'Users can delete own meal logs'
  ) then
    create policy "Users can delete own meal logs"
      on public.meal_logs for delete
      to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;