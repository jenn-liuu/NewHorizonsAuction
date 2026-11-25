-- REVIEW ONLY: inspect the existing category column before applying manually.
--
-- select column_name, data_type, udt_name, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'items'
--   and column_name = 'category';
--
-- This migration adds category only when it is absent. It does not change
-- existing policies, grants, RLS, or image_urls.

do $migration$
declare
  category_data_type text;
begin
  if to_regclass('public.items') is null then
    raise exception 'public.items does not exist; review the catalog schema before applying this migration.';
  end if;

  select data_type
  into category_data_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'items'
    and column_name = 'category';

  if category_data_type is null then
    alter table public.items
      add column category text;
  elsif category_data_type not in ('text', 'character varying') then
    raise exception 'The existing items.category column has unsupported type %. Review it before applying this migration.', category_data_type;
  end if;
end
$migration$;
