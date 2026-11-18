-- REVIEW ONLY: run the preflight query below in Supabase SQL Editor first.
-- This migration refuses to continue when any INSERT/ALL policy already
-- exists on public.items. Review such policies before making any policy change.
--
-- select policyname, permissive, roles, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'items'
--   and cmd in ('INSERT', 'ALL')
-- order by policyname;
--
-- This migration does not alter, replace, or remove existing items policies.
-- It expects the current catalog table columns used by the create route and
-- existing RLS on public.items. It does not insert image_urls, id, or created_at.

do $migration$
declare
  item_policies text;
  missing_columns text;
  incompatible_money_columns text;
  required_unsupplied_columns text;
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
    raise exception 'RLS is not enabled on public.items. Review and enable item-table RLS before applying this migration.';
  end if;

  select string_agg(
    format('%I (command=%s, permissive=%s, roles=%s)', policyname, cmd, permissive, roles),
    '; '
  )
  into item_policies
  from pg_policies
  where schemaname = 'public'
    and tablename = 'items'
    and cmd in ('INSERT', 'ALL');

  if item_policies is not null then
    raise exception 'Review existing public.items INSERT/ALL policies before adding another policy: %', item_policies;
  end if;

  select string_agg(required.column_name, ', ')
  into missing_columns
  from unnest(array[
    'title',
    'description',
    'retail_value',
    'minimum_bid',
    'bid_increment',
    'donor_url',
    'status'
  ]) as required(column_name)
  where not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'items'
      and column_name = required.column_name
  );

  if missing_columns is not null then
    raise exception 'The catalog items schema does not match the reviewed create route. Missing columns: %', missing_columns;
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
    and data_type not in (
      'numeric',
      'decimal',
      'real',
      'double precision'
    );

  if incompatible_money_columns is not null then
    raise exception 'Review item money column types before applying: %', incompatible_money_columns;
  end if;

  select string_agg(column_name, ', ')
  into required_unsupplied_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'items'
    and is_nullable = 'NO'
    and column_default is null
    and is_identity = 'NO'
    and is_generated = 'NEVER'
    and column_name not in (
      'title',
      'description',
      'retail_value',
      'minimum_bid',
      'bid_increment',
      'donor_url',
      'status'
    );

  if required_unsupplied_columns is not null then
    raise exception 'The create route does not supply required item columns without defaults: %', required_unsupplied_columns;
  end if;
end
$migration$;

create table public.approved_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.approved_admins enable row level security;
revoke all on public.approved_admins from public, anon, authenticated;
grant select on public.approved_admins to authenticated;

create policy "Approved admins can read their own membership"
  on public.approved_admins
  for select
  to authenticated
  using (user_id = (select auth.uid()));

grant insert on public.items to authenticated;

create policy "Approved admins can create items"
  on public.items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.approved_admins
      where user_id = (select auth.uid())
    )
  );
