-- REVIEW ONLY: inspect the current schema and policies before applying manually.
-- This migration does not replace, alter, or remove existing items policies.
--
-- select column_name, data_type, udt_name, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'items'
-- order by ordinal_position;
--
-- select policyname, permissive, roles, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename = 'items'
-- order by policyname;
--
-- It adds only approved-admin SELECT and UPDATE access. The existing public
-- published-item SELECT policy and approved-admin INSERT policy remain intact.
-- It never sets default/fake money values and leaves image_urls untouched.

do $migration$
declare
  missing_columns text;
  incompatible_money_columns text;
  invalid_published_count bigint;
  invalid_title_count bigint;
begin
  if to_regclass('public.items') is null then
    raise exception 'public.items does not exist; review the catalog schema before applying this migration.';
  end if;

  if not exists (
    select 1
    from pg_class
    where oid = 'public.items'::regclass
      and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on public.items. Review item-table RLS before applying this migration.';
  end if;

  if to_regclass('public.approved_admins') is null then
    raise exception 'public.approved_admins does not exist; apply and verify the approved-admin migration first.';
  end if;

  if not exists (
    select 1
    from pg_class
    where oid = 'public.approved_admins'::regclass
      and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on public.approved_admins. Review approved-admin membership protection before applying this migration.';
  end if;

  select string_agg(required.column_name, ', ')
  into missing_columns
  from unnest(array[
    'id',
    'title',
    'description',
    'retail_value',
    'minimum_bid',
    'bid_increment',
    'donor_url',
    'status',
    'created_at'
  ]) as required(column_name)
  where not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'items'
      and column_name = required.column_name
  );

  if missing_columns is not null then
    raise exception 'The catalog items schema does not match the reviewed item-management routes. Missing columns: %', missing_columns;
  end if;

  select string_agg(
    format('%s (%s)', column_name, data_type),
    ', '
  )
  into incompatible_money_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'items'
    and column_name in ('retail_value', 'minimum_bid', 'bid_increment')
    and data_type not in ('numeric', 'decimal', 'real', 'double precision');

  if incompatible_money_columns is not null then
    raise exception 'Review item money column types before applying: %', incompatible_money_columns;
  end if;

  select count(*)
  into invalid_title_count
  from public.items
  where nullif(btrim(title), '') is null;

  if invalid_title_count > 0 then
    raise exception 'Found % items without a usable title. Review and correct them before applying this migration.', invalid_title_count;
  end if;

  select count(*)
  into invalid_published_count
  from public.items
  where status = 'published'
    and (
      nullif(btrim(title), '') is null
      or nullif(btrim(description), '') is null
      or retail_value is null
      or retail_value < 0
      or minimum_bid is null
      or minimum_bid < 0
      or bid_increment is null
      or bid_increment <= 0
    );

  if invalid_published_count > 0 then
    raise exception 'Found % incomplete or invalid published items. Review and correct them before applying this migration.', invalid_published_count;
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.items'::regclass
      and conname = 'items_title_required'
  ) then
    raise exception 'Constraint items_title_required already exists; review its definition before applying this migration.';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.items'::regclass
      and conname = 'items_published_fields_complete'
  ) then
    raise exception 'Constraint items_published_fields_complete already exists; review its definition before applying this migration.';
  end if;
end
$migration$;

alter table public.items
  alter column title set not null,
  alter column description drop not null,
  alter column retail_value drop not null,
  alter column minimum_bid drop not null,
  alter column bid_increment drop not null;

alter table public.items
  add constraint items_published_fields_complete
  check (
    status <> 'published'
    or (
      nullif(btrim(title), '') is not null
      and nullif(btrim(description), '') is not null
      and retail_value is not null
      and retail_value >= 0
      and minimum_bid is not null
      and minimum_bid >= 0
      and bid_increment is not null
      and bid_increment > 0
    )
  );

alter table public.items
  add constraint items_title_required
  check (nullif(btrim(title), '') is not null);

grant select, update on public.items to authenticated;

create policy "Approved admins can read auction items"
  on public.items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.approved_admins
      where user_id = (select auth.uid())
    )
  );

create policy "Approved admins can update auction items"
  on public.items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.approved_admins
      where user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.approved_admins
      where user_id = (select auth.uid())
    )
  );
