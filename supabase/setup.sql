-- BTS Ticket Monitor — Supabase Realtime
-- Execute este arquivo no SQL Editor do Supabase.

create table if not exists public.ticket_status (
  show_id text primary key,
  date_label text,
  status text not null default 'unknown'
    check (status in ('soldout','available','unknown','error')),
  label text not null default 'Verificando',
  message text not null default '',
  offers jsonb not null default '[]'::jsonb,
  checked_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.monitor_events (
  event_id text primary key,
  event_type text not null
    check (event_type in ('availability','manual')),
  show_id text,
  title text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.ticket_status enable row level security;
alter table public.monitor_events enable row level security;

drop policy if exists "Public can read ticket status" on public.ticket_status;
create policy "Public can read ticket status"
on public.ticket_status
for select
to anon, authenticated
using (true);

drop policy if exists "Public can read monitor events" on public.monitor_events;
create policy "Public can read monitor events"
on public.monitor_events
for select
to anon, authenticated
using (true);

-- O navegador só pode ler. Escritas são feitas pelo backend com a Service Role.
revoke insert, update, delete on public.ticket_status from anon, authenticated;
revoke insert, update, delete on public.monitor_events from anon, authenticated;
grant select on public.ticket_status to anon, authenticated;
grant select on public.monitor_events to anon, authenticated;

-- Adiciona as tabelas ao Supabase Realtime.
do $$
begin
  begin
    alter publication supabase_realtime add table public.ticket_status;
  exception
    when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.monitor_events;
  exception
    when duplicate_object then null;
  end;
end $$;

-- Linhas iniciais. O bot atualizará esses registros.
insert into public.ticket_status
  (show_id, date_label, status, label, message)
values
  ('28', '28 DE OUTUBRO', 'soldout', 'Esgotado', 'Nenhuma disponibilidade confirmada.'),
  ('30', '30 DE OUTUBRO', 'soldout', 'Esgotado', 'Nenhuma disponibilidade confirmada.'),
  ('31', '31 DE OUTUBRO', 'soldout', 'Esgotado', 'Nenhuma disponibilidade confirmada.')
on conflict (show_id) do nothing;
