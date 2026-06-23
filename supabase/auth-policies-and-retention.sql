-- Ejecutar en Supabase SQL Editor sobre el proyecto existente.
-- Corrige las politicas para usuarios autenticados y activa limpieza automatica
-- de registros antiguos cuando el total combinado de registros supera el
-- limite configurado.
-- La limpieza usa el tamano logico de registros vivos. El tamano fisico de
-- Postgres puede no bajar de inmediato, pero el espacio queda disponible para
-- reutilizarse en nuevas escrituras.

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

create table if not exists public.checklist_storage_policy (
  id text primary key default 'default' check (id = 'default'),
  max_total_live_bytes bigint not null check (max_total_live_bytes > 0),
  min_keep_rows_per_table integer not null default 100 check (min_keep_rows_per_table >= 0),
  delete_batch_size integer not null default 50 check (delete_batch_size > 0),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.checklist_storage_policy enable row level security;

drop policy if exists "checklist_storage_policy_select" on public.checklist_storage_policy;

create policy "checklist_storage_policy_select"
on public.checklist_storage_policy
for select
to authenticated
using (true);

grant select on public.checklist_storage_policy to authenticated;

insert into public.checklist_storage_policy (
  id,
  max_total_live_bytes,
  min_keep_rows_per_table,
  delete_batch_size,
  enabled
)
values (
  'default',
  470 * 1024 * 1024,
  100,
  50,
  true
)
on conflict (id) do update
set
  max_total_live_bytes = excluded.max_total_live_bytes,
  min_keep_rows_per_table = excluded.min_keep_rows_per_table,
  delete_batch_size = excluded.delete_batch_size,
  enabled = excluded.enabled,
  updated_at = now();

create or replace function public.checklist_live_bytes(target_table text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  live_bytes bigint;
begin
  if target_table not in ('spray_checklist_records', 'rb_monitoring_records') then
    raise exception 'Tabla de checklist no permitida: %', target_table;
  end if;

  execute format(
    'select coalesce(sum(pg_column_size(t)), 0)::bigint from public.%I t',
    target_table
  )
  into live_bytes;

  return coalesce(live_bytes, 0);
end;
$$;

create or replace function public.checklist_total_live_bytes()
returns bigint
language sql
security definer
set search_path = public
as $$
  select
    public.checklist_live_bytes('spray_checklist_records')
    + public.checklist_live_bytes('rb_monitoring_records');
$$;

create or replace function public.prune_checklist_records()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  storage_policy public.checklist_storage_policy%rowtype;
  total_live_bytes bigint;
  database_bytes bigint;
  total_rows bigint;
  average_row_bytes numeric;
  rows_to_delete integer;
  min_keep_rows integer;
  delete_batch_size integer;
  deleted_rows integer := 0;
  row_to_remove record;
begin
  select *
  into storage_policy
  from public.checklist_storage_policy
  where id = 'default'
    and enabled = true;

  if not found then
    return jsonb_build_object(
      'scope', 'all_checklist_records',
      'status', 'disabled'
    );
  end if;

  total_live_bytes := public.checklist_total_live_bytes();
  database_bytes := pg_database_size(current_database());
  min_keep_rows := storage_policy.min_keep_rows_per_table;
  delete_batch_size := storage_policy.delete_batch_size;

  select (
    (select count(*)::bigint from public.spray_checklist_records)
    + (select count(*)::bigint from public.rb_monitoring_records)
  )
  into total_rows;

  if total_live_bytes <= storage_policy.max_total_live_bytes then
    return jsonb_build_object(
      'scope', 'all_checklist_records',
      'status', 'kept',
      'total_live_bytes', total_live_bytes,
      'database_bytes', database_bytes,
      'row_count', total_rows,
      'max_total_live_bytes', storage_policy.max_total_live_bytes
    );
  end if;

  average_row_bytes := greatest(total_live_bytes::numeric / greatest(total_rows, 1), 1);
  rows_to_delete := ceil(
    (total_live_bytes - storage_policy.max_total_live_bytes)::numeric / average_row_bytes
  )::integer + delete_batch_size;

  if rows_to_delete > 0 then
    for row_to_remove in
      with spray_candidates as (
        select
          'spray_checklist_records'::text as table_name,
          id,
          coalesce(finished_at, created_at) as sort_at,
          created_at,
          row_number() over (
            order by coalesce(finished_at, created_at), created_at, id
          ) as age_rank,
          count(*) over () as table_count
        from public.spray_checklist_records
      ),
      rb_candidates as (
        select
          'rb_monitoring_records'::text as table_name,
          id,
          coalesce(finished_at, created_at) as sort_at,
          created_at,
          row_number() over (
            order by coalesce(finished_at, created_at), created_at, id
          ) as age_rank,
          count(*) over () as table_count
        from public.rb_monitoring_records
      ),
      removable_rows as (
        select table_name, id, sort_at, created_at
        from spray_candidates
        where age_rank <= table_count - min_keep_rows
        union all
        select table_name, id, sort_at, created_at
        from rb_candidates
        where age_rank <= table_count - min_keep_rows
      )
      select table_name, id
      from removable_rows
      order by sort_at, created_at, table_name, id
      limit rows_to_delete
    loop
      if row_to_remove.table_name = 'spray_checklist_records' then
        delete from public.spray_checklist_records
        where id = row_to_remove.id;
      elsif row_to_remove.table_name = 'rb_monitoring_records' then
        delete from public.rb_monitoring_records
        where id = row_to_remove.id;
      end if;

      deleted_rows := deleted_rows + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'scope', 'all_checklist_records',
    'status', 'pruned',
    'deleted_rows', deleted_rows,
    'total_live_bytes_before', total_live_bytes,
    'database_bytes_before', database_bytes,
    'row_count_before', total_rows,
    'max_total_live_bytes', storage_policy.max_total_live_bytes
  );
end;
$$;

create or replace function public.prune_checklist_table(target_table text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_table not in ('spray_checklist_records', 'rb_monitoring_records') then
    raise exception 'Tabla de checklist no permitida: %', target_table;
  end if;

  return public.prune_checklist_records();
end;
$$;

create or replace function public.prune_checklist_records_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.prune_checklist_records();
  return null;
end;
$$;

drop trigger if exists spray_checklist_records_storage_retention
on public.spray_checklist_records;

create trigger spray_checklist_records_storage_retention
after insert or update
on public.spray_checklist_records
for each statement
execute function public.prune_checklist_records_after_write();

drop trigger if exists rb_monitoring_records_storage_retention
on public.rb_monitoring_records;

create trigger rb_monitoring_records_storage_retention
after insert or update
on public.rb_monitoring_records
for each statement
execute function public.prune_checklist_records_after_write();

drop function if exists public.get_checklist_storage_usage();

create function public.get_checklist_storage_usage()
returns table (
  scope text,
  row_count bigint,
  live_bytes bigint,
  database_bytes bigint,
  max_total_live_bytes bigint,
  percent_used numeric,
  min_keep_rows_per_table integer,
  delete_batch_size integer,
  enabled boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with policy as (
    select *
    from public.checklist_storage_policy
    where id = 'default'
  ),
  usage_rows as (
    select
      'spray_checklist_records'::text as scope,
      (select count(*)::bigint from public.spray_checklist_records) as row_count,
      public.checklist_live_bytes('spray_checklist_records') as live_bytes
    union all
    select
      'rb_monitoring_records'::text as scope,
      (select count(*)::bigint from public.rb_monitoring_records) as row_count,
      public.checklist_live_bytes('rb_monitoring_records') as live_bytes
    union all
    select
      'all_checklist_records'::text as scope,
      (
        (select count(*)::bigint from public.spray_checklist_records)
        + (select count(*)::bigint from public.rb_monitoring_records)
      ) as row_count,
      public.checklist_total_live_bytes() as live_bytes
  )
  select
    usage_rows.scope,
    usage_rows.row_count,
    usage_rows.live_bytes,
    pg_database_size(current_database()) as database_bytes,
    policy.max_total_live_bytes,
    round(
      (usage_rows.live_bytes::numeric
        / greatest(policy.max_total_live_bytes, 1)) * 100,
      2
    ) as percent_used,
    policy.min_keep_rows_per_table,
    policy.delete_batch_size,
    policy.enabled
  from usage_rows
  cross join policy
  order by case usage_rows.scope
    when 'all_checklist_records' then 0
    when 'spray_checklist_records' then 1
    else 2
  end;
end;
$$;

grant execute on function public.get_checklist_storage_usage() to authenticated;

-- Consultas utiles:
-- select * from public.get_checklist_storage_usage();
-- select public.prune_checklist_records();
--
-- Para cambiar el limite global a 480 MB:
-- update public.checklist_storage_policy
-- set max_total_live_bytes = 480 * 1024 * 1024, updated_at = now()
-- where id = 'default';
