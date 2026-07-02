create table if not exists public.tswv_checklist_records (
  id uuid primary key,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  saved_date text,
  saved_time text,
  week_code text,
  form jsonb not null default '{}'::jsonb,
  score numeric not null default 0,
  percent numeric not null default 0,
  summary jsonb not null default '{}'::jsonb
);

alter table public.tswv_checklist_records enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update on public.tswv_checklist_records to authenticated;

drop policy if exists "tswv_checklist_records_select" on public.tswv_checklist_records;
drop policy if exists "tswv_checklist_records_insert" on public.tswv_checklist_records;
drop policy if exists "tswv_checklist_records_update" on public.tswv_checklist_records;

create policy "tswv_checklist_records_select"
on public.tswv_checklist_records
for select
to authenticated
using (true);

create policy "tswv_checklist_records_insert"
on public.tswv_checklist_records
for insert
to authenticated
with check (true);

create policy "tswv_checklist_records_update"
on public.tswv_checklist_records
for update
to authenticated
using (true)
with check (true);
