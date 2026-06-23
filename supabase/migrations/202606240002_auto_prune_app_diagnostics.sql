create or replace function public.prune_app_diagnostics_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.prune_app_diagnostics();
  return null;
end;
$$;

drop trigger if exists app_diagnostics_prune_after_insert on public.app_diagnostics;

create trigger app_diagnostics_prune_after_insert
after insert on public.app_diagnostics
for each statement
execute function public.prune_app_diagnostics_after_insert();