create extension if not exists "pgcrypto";

create table if not exists public.spray_checklist_records (
  id uuid primary key,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  products jsonb not null default '[]'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  observations text,
  score numeric not null default 0,
  max_score numeric not null default 0,
  non_compliant_score numeric,
  calification_base_score numeric not null default 212,
  calification_percent numeric,
  compliance_percent numeric not null default 0,
  summary jsonb not null default '{}'::jsonb
);

create table if not exists public.rb_monitoring_records (
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

alter table public.spray_checklist_records enable row level security;
alter table public.rb_monitoring_records enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update on public.spray_checklist_records to authenticated;
grant select, insert, update on public.rb_monitoring_records to authenticated;

drop policy if exists "spray_checklist_records_select" on public.spray_checklist_records;
drop policy if exists "spray_checklist_records_insert" on public.spray_checklist_records;
drop policy if exists "spray_checklist_records_update" on public.spray_checklist_records;

create policy "spray_checklist_records_select"
on public.spray_checklist_records
for select
to authenticated
using (true);

create policy "spray_checklist_records_insert"
on public.spray_checklist_records
for insert
to authenticated
with check (true);

create policy "spray_checklist_records_update"
on public.spray_checklist_records
for update
to authenticated
using (true)
with check (true);

drop policy if exists "rb_monitoring_records_select" on public.rb_monitoring_records;
drop policy if exists "rb_monitoring_records_insert" on public.rb_monitoring_records;
drop policy if exists "rb_monitoring_records_update" on public.rb_monitoring_records;

create policy "rb_monitoring_records_select"
on public.rb_monitoring_records
for select
to authenticated
using (true);

create policy "rb_monitoring_records_insert"
on public.rb_monitoring_records
for insert
to authenticated
with check (true);

create policy "rb_monitoring_records_update"
on public.rb_monitoring_records
for update
to authenticated
using (true)
with check (true);
