-- REVIEW ONLY: inspect the existing items.image_urls column, Storage bucket
-- configuration, RLS, and every storage.objects policy before applying.
--
-- select column_name, data_type, udt_name, is_nullable, column_default,
--        is_generated
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'items'
--   and column_name = 'image_urls';
--
-- select id, name, public, file_size_limit, allowed_mime_types
-- from storage.buckets
-- where id = 'auction-item-photos';
--
-- select policyname, permissive, roles, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
-- order by policyname;
--
-- New uploads use private paths in image_urls. Existing external image URLs
-- are not changed. The application serves managed images only while a
-- published item references them. Drafts remain private.

do $migration$
declare
  image_urls_type text;
  bucket_is_public boolean;
  bucket_file_size_limit bigint;
  bucket_mime_types text[];
  missing_policies text;
  existing_storage_policies text;
  invalid_jsonb_image_urls boolean;
begin
  if to_regclass('public.items') is null then
    raise exception 'public.items does not exist; review the catalog schema before applying this migration.';
  end if;

  if to_regclass('public.approved_admins') is null then
    raise exception 'public.approved_admins does not exist; apply and verify the approved-admin migration first.';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.items'::regclass and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on public.items. Review item-table RLS before applying this migration.';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.approved_admins'::regclass and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on public.approved_admins. Review approved-admin protection before applying this migration.';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'storage.objects'::regclass and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on storage.objects. Review Supabase Storage security before applying this migration.';
  end if;

  select udt_name
  into image_urls_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'items'
    and column_name = 'image_urls';

  if image_urls_type is null then
    alter table public.items
      add column image_urls text[] not null default '{}'::text[];
  elsif image_urls_type not in ('_text', 'jsonb') then
    raise exception 'The existing items.image_urls column has unsupported type %. Review it before applying this migration.', image_urls_type;
  end if;

  if image_urls_type = 'jsonb' then
    execute
      'select exists (
         select 1
         from public.items
         where image_urls is not null
           and jsonb_typeof(image_urls) <> ''array''
       )'
      into invalid_jsonb_image_urls;
    if invalid_jsonb_image_urls then
      raise exception 'Found non-array values in items.image_urls. Review and correct them before applying this migration.';
    end if;
  end if;

  select public, file_size_limit, allowed_mime_types
  into bucket_is_public, bucket_file_size_limit, bucket_mime_types
  from storage.buckets
  where id = 'auction-item-photos';

  if not found then
    insert into storage.buckets (
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    )
    values (
      'auction-item-photos',
      'auction-item-photos',
      false,
      5242880,
      array['image/jpeg', 'image/png', 'image/webp']
    );
  elsif bucket_is_public
    or bucket_file_size_limit is distinct from 5242880
    or bucket_mime_types is distinct from array['image/jpeg', 'image/png', 'image/webp'] then
    raise exception 'The existing auction-item-photos bucket is not configured as the expected private, 5 MB JPEG/PNG/WebP bucket. Review it manually.';
  end if;

  select string_agg(policyname, ', ')
  into missing_policies
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname in (
      'Approved admins can read private auction item photos',
      'Public can read published auction item photos',
      'Approved admins can upload auction item photos',
      'Approved admins can delete unreferenced auction item photos'
    );

  if missing_policies is not null then
    raise exception 'Storage policies already exist: %. Review their definitions before applying this migration.', missing_policies;
  end if;

  select string_agg(policyname, ', ')
  into existing_storage_policies
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects';

  if existing_storage_policies is not null then
    raise exception 'Existing storage.objects policies require manual review before adding item-photo policies: %', existing_storage_policies;
  end if;
end
$migration$;

grant select on storage.objects to anon, authenticated;
grant insert, delete on storage.objects to authenticated;

create policy "Approved admins can read private auction item photos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'auction-item-photos'
    and exists (
      select 1
      from public.approved_admins
      where user_id = (select auth.uid())
    )
  );

create policy "Public can read published auction item photos"
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'auction-item-photos'
    and exists (
      select 1
      from public.items
      where status = 'published'
        and to_jsonb(image_urls) @> jsonb_build_array(storage.objects.name)
    )
  );

create policy "Approved admins can upload auction item photos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'auction-item-photos'
    and (storage.foldername(name))[1] = 'items'
    and exists (
      select 1
      from public.approved_admins
      where user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.items
      where id::text = (storage.foldername(name))[2]
    )
  );

create policy "Approved admins can delete unreferenced auction item photos"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'auction-item-photos'
    and (storage.foldername(name))[1] = 'items'
    and exists (
      select 1
      from public.approved_admins
      where user_id = (select auth.uid())
    )
    and not exists (
      select 1
      from public.items
      where to_jsonb(image_urls) @> jsonb_build_array(storage.objects.name)
    )
  );
