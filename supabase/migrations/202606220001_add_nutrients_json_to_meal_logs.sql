alter table public.meal_logs
  add column if not exists nutrients_json jsonb,
  add column if not exists nutrient_confidence text,
  add column if not exists nutrient_source text,
  add column if not exists nutrients_estimated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'meal_logs_nutrient_confidence_check'
  ) then
    alter table public.meal_logs
      add constraint meal_logs_nutrient_confidence_check
      check (
        nutrient_confidence is null
        or nutrient_confidence in ('low', 'medium', 'high')
      );
  end if;
end $$;
