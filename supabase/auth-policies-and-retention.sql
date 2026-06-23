-- Ejecutar en Supabase SQL Editor sobre el proyecto existente.
-- Corrige las politicas para usuarios autenticados y activa limpieza automatica
-- de registros antiguos cuando una tabla supera el limite configurado.
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

create table if not exists public.checklist_storage_limits (
  table_name text primary key
    check (table_name in ('spray_checklist_records', 'rb_monitoring_records')),
  max_live_bytes bigint not null check (max_live_bytes > 0),
  min_keep_rows integer not null default 100 check (min_keep_rows >= 0),
  delete_batch_size integer not null default 50 check (delete_batch_size > 0),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.checklist_storage_limits enable row level security;

drop policy if exists "checklist_storage_limits_select" on public.checklist_storage_limits;

create policy "checklist_storage_limits_select"
on public.checklist_storage_limits
for select
to authenticated
using (true);

grant select on public.checklist_storage_limits to authenticated;

insert into public.checklist_storage_limits (
  table_name,
  max_live_bytes,
  min_keep_rows,
  delete_batch_size,
  enabled
)
values
  ('spray_checklist_records', 40 * 1024 * 1024, 100, 50, true),
  ('rb_monitoring_records', 40 * 1024 * 1024, 100, 50, true)
on conflict (table_name) do nothing;

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

create or replace function public.prune_checklist_table(target_table text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  storage_limit public.checklist_storage_limits%rowtype;
  live_bytes bigint;
  relation_bytes bigint;
  total_rows bigint;
  average_row_bytes numeric;
  rows_to_delete integer;
  deleted_rows integer := 0;
begin
  if target_table not in ('spray_checklist_records', 'rb_monitoring_records') then
    raise exception 'Tabla de checklist no permitida: %', target_table;
  end if;

  select *
  into storage_limit
  from public.checklist_storage_limits
  where table_name = target_table
    and enabled = true;

  if not found then
    return jsonb_build_object(
      'table_name', target_table,
      'status', 'disabled'
    );
  end if;

  live_bytes := public.checklist_live_bytes(target_table);

  execute format(
    'select pg_total_relation_size(%L::regclass)',
    'public.' || target_table
  )
  into relation_bytes;

  execute format(
    'select count(*)::bigint from public.%I',
    target_table
  )
  into total_rows;

  if live_bytes <= storage_limit.max_live_bytes
    or total_rows <= storage_limit.min_keep_rows then
    return jsonb_build_object(
      'table_name', target_table,
      'status', 'kept',
      'live_bytes', live_bytes,
      'relation_bytes', relation_bytes,
      'row_count', total_rows,
      'max_live_bytes', storage_limit.max_live_bytes
    );
  end if;

  average_row_bytes := greatest(live_bytes::numeric / greatest(total_rows, 1), 1);
  rows_to_delete := ceil(
    (live_bytes - storage_limit.max_live_bytes)::numeric / average_row_bytes
  )::integer + storage_limit.delete_batch_size;

  rows_to_delete := least(
    rows_to_delete,
    greatest((total_rows - storage_limit.min_keep_rows)::integer, 0)
  );

  if rows_to_delete > 0 then
    execute format(
      'with rows_to_remove as (
         select id
         from public.%I
         order by coalesce(finished_at, created_at), created_at, id
         limit $1
       )
       delete from public.%I as target
       using rows_to_remove
       where target.id = rows_to_remove.id',
      target_table,
      target_table
    )
    using rows_to_delete;

    get diagnostics deleted_rows = row_count;
  end if;

  return jsonb_build_object(
    'table_name', target_table,
    'status', 'pruned',
    'deleted_rows', deleted_rows,
    'live_bytes_before', live_bytes,
    'relation_bytes_before', relation_bytes,
    'row_count_before', total_rows,
    'max_live_bytes', storage_limit.max_live_bytes
  );
end;
$$;

create or replace function public.prune_checklist_records_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.prune_checklist_table(TG_TABLE_NAME);
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

create or replace function public.get_checklist_storage_usage()
returns table (
  table_name text,
  row_count bigint,
  live_bytes bigint,
  relation_bytes bigint,
  max_live_bytes bigint,
  percent_used numeric,
  min_keep_rows integer,
  delete_batch_size integer,
  enabled boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    limits.table_name,
    case limits.table_name
      when 'spray_checklist_records' then (
        select count(*)::bigint from public.spray_checklist_records
      )
      when 'rb_monitoring_records' then (
        select count(*)::bigint from public.rb_monitoring_records
      )
    end as row_count,
    public.checklist_live_bytes(limits.table_name) as live_bytes,
    pg_total_relation_size(('public.' || limits.table_name)::regclass) as relation_bytes,
    limits.max_live_bytes,
    round(
      (public.checklist_live_bytes(limits.table_name)::numeric
        / greatest(limits.max_live_bytes, 1)) * 100,
      2
    ) as percent_used,
    limits.min_keep_rows,
    limits.delete_batch_size,
    limits.enabled
  from public.checklist_storage_limits as limits
  order by limits.table_name;
end;
$$;

grant execute on function public.get_checklist_storage_usage() to authenticated;

-- Consultas utiles:
-- select * from public.get_checklist_storage_usage();
-- select public.prune_checklist_table('spray_checklist_records');
-- select public.prune_checklist_table('rb_monitoring_records');
--
-- Para cambiar el limite a 80 MB en una tabla:
-- update public.checklist_storage_limits
-- set max_live_bytes = 80 * 1024 * 1024, updated_at = now()
-- where table_name = 'spray_checklist_records';
