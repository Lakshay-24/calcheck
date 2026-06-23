do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'meal_logs'
      and policyname = 'Users can update own meal logs'
  ) then
    create policy "Users can update own meal logs"
      on public.meal_logs for update
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;
