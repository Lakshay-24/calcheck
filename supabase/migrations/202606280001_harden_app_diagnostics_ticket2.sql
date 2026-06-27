-- Ticket 2 diagnostics hardening: keep inserts lightweight, but prevent users from reading logs.
create index if not exists app_diagnostics_session_created_at_idx
  on public.app_diagnostics (session_id, created_at desc);

drop policy if exists "Users can read own app diagnostics" on public.app_diagnostics;