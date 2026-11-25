# Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/ChrisHill415/NewHorizonsAuction.git
cd NewHorizonsAuction
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create environment variables

Create a `.env.local` file in the root of the project:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
ADMIN_ITEM_CREATION_ENABLED=false
```

Use the project URL (not its `/rest/v1` endpoint) and publishable key from
Supabase project settings. The app normalizes an existing URL ending in
`/rest/v1` for compatibility.

## Admin item management setup

Saving at `/admin/items` and `/admin/items/new` stays disabled unless the
server-side `ADMIN_ITEM_CREATION_ENABLED` flag is exactly `true`. Do not enable
it until all reviewed migrations have been checked and applied and the RLS
checks below pass.

1. In Supabase SQL Editor, inspect the current item schema:

   ```sql
   select column_name, data_type, udt_name, is_nullable, column_default,
          is_identity, is_generated
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'items'
   order by ordinal_position;

   select conname, pg_get_constraintdef(oid)
   from pg_constraint
   where conrelid = 'public.items'::regclass
   order by conname;
   ```

   The catalog formats `retail_value`, `minimum_bid`, and `bid_increment`
   directly as USD amounts; it does not divide by 100. The create request uses
   those dollar-valued columns and omits `id` and `created_at` so database
   defaults apply. The photo migration adds or validates `image_urls` before
   the admin form writes an ordered array (empty when no photos are attached).
   The item-management migration also stops if required, unsupplied item
   columns have no database default or identity value, or if the money columns
   do not have a supported numeric type.

2. Inspect every current item policy:

   ```sql
   select policyname, permissive, roles, cmd, qual, with_check
   from pg_policies
   where schemaname = 'public'
     and tablename = 'items'
   order by policyname;
   ```

   Review the existing public published-item `SELECT` rule and approved-admin
   `INSERT` rule. The item-management migration is additive and does not
   replace or remove any existing policy.

3. Review
   [`supabase/migrations/20261118175000_approved_admins_item_insert.sql`](./supabase/migrations/20261118175000_approved_admins_item_insert.sql).
   It creates the `approved_admins` membership table, self-read RLS policy, and
   the `items` INSERT policy, but does not modify or remove existing `items`
   policies. Apply it manually only if it has not already been applied, after
   its preflight and the expected catalog columns/RLS are confirmed.

4. Review
   [`supabase/migrations/20261125180000_admin_item_drafts_and_updates.sql`](./supabase/migrations/20261125180000_admin_item_drafts_and_updates.sql).
   It makes the description and bidding amount columns nullable for drafts,
   requires a title for every item and complete valid values for published
   items, and adds approved-admin `SELECT`/`UPDATE` grants and RLS policies. It
   does not change public access, the existing `INSERT` policy, or `image_urls`;
   it never inserts placeholder money values. It aborts if the expected schema
   is missing, money column types differ, or existing rows violate the new
   requirements. Apply it manually only after reviewing the schema and every
   current item policy.

5. Review
   [`supabase/migrations/20261125180200_admin_item_category.sql`](./supabase/migrations/20261125180200_admin_item_category.sql).
   It checks whether `items.category` exists and adds it only if absent. An
   existing non-text category column stops the migration for manual review.
   The category field uses the provisional choices “Other item” and “Stallion
   breeding,” centralized in the application for later revision. Apply this
   migration manually only after inspecting the current column; it does not
   change grants, RLS policies, public access, or `image_urls`.

6. Review
   [`supabase/migrations/20261125180500_private_item_photos.sql`](./supabase/migrations/20261125180500_private_item_photos.sql).
   It creates a private `auction-item-photos` bucket limited to JPEG, PNG, and
   WebP files up to 5 MB, and adds approved-admin Storage upload/read/delete
   policies. The catalog image endpoint can read only objects referenced by a
   published item; drafts stay private. It preserves external URLs already in
   `image_urls`, accepts an existing `text[]` or array-valued `jsonb` column,
   and adds a text-array column only if `image_urls` is absent.
   The migration stops for incompatible schema/bucket settings or any existing
   `storage.objects` policy so those policies can be reviewed rather than
   silently combined. Inspect the migration's read-only preflight queries and
   manually review before applying. Do not make the bucket public.

   When an item is reopened, the form may clean up files in that item's folder
   only if they are unreferenced and older than 24 hours. Normal removal first
   saves the updated image list, then deletes only managed Storage paths;
   Storage RLS prevents deleting any object still referenced by an item.
   External sample image URLs are never deleted.

7. Add the intended admin user's Auth UUID to `public.approved_admins` in SQL
   Editor:

   ```sql
   insert into public.approved_admins (user_id)
   values ('<AUTH_USER_UUID>');
   ```

8. Confirm the migrations created the expected policies and RLS remains enabled:

   ```sql
   select policyname, permissive, roles, cmd, qual, with_check
   from pg_policies
   where schemaname = 'public'
     and tablename in ('items', 'approved_admins')
   order by tablename, policyname;

   select relrowsecurity
   from pg_class
   where oid = 'public.items'::regclass;

   select relrowsecurity
   from pg_class
   where oid = 'storage.objects'::regclass;

   select policyname, permissive, roles, cmd, qual, with_check
   from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
   order by policyname;
   ```

   Confirm the existing public item policy still limits public reads to
   published items, and the admin `SELECT`, `INSERT`, and `UPDATE` policies
   require an `approved_admins.user_id = auth.uid()` membership. The only
   `approved_admins` policy should allow authenticated users to read their own
   membership.

9. With a normal, non-admin test user's access token, send a direct
   authenticated `POST /rest/v1/items` using the catalog's required fields
   (including an empty `image_urls` array and omitting `id` and `created_at`).
   It must be rejected by RLS and create no row. This direct PostgREST test is
   important: the app route also denies non-admins before attempting an INSERT.

   ```sh
   curl --include --request POST \
     "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/items" \
     --header "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
     --header "Authorization: Bearer $NON_ADMIN_ACCESS_TOKEN" \
     --header "Content-Type: application/json" \
     --header "Prefer: return=minimal" \
     --data '{
       "title": "RLS check (remove if unexpectedly allowed)",
       "description": "Temporary policy check.",
       "retail_value": 1.00,
       "minimum_bid": 1.00,
       "bid_increment": 0.01,
       "donor_url": null,
       "image_urls": [],
       "status": "draft"
     }'
   ```

   Expect an authorization error and verify that no matching row exists. If
   this insert succeeds, stop: do not enable app saving, and review the
   `items` policies before proceeding.

10. Only after schema and policy checks pass, set
   `ADMIN_ITEM_CREATION_ENABLED=true` in the server environment and restart or
   redeploy the app. Sign in as an approved admin, verify a no-session request
   is rejected, and test the Draft and Published lists at `/admin/items`.
   Create an incomplete draft, reopen and update it, use “Save draft and add
   another,” then publish a complete item from the shared form. Confirm drafts
   are absent from public and non-admin reads and published items still appear
   at `/`. For photos, test several valid images, file rejection (wrong type
   and over 5 MB), preview, removal, and reordering; verify the first image is
   the public main photo. Confirm text-only edits retain images, draft image
   paths return 404 from the public catalog endpoint, and published image paths
   load through it. Verify an unapproved account cannot upload or delete
   Storage objects. Reopen an item with an unreferenced managed object older
   than 24 hours to verify safe abandoned-upload cleanup. Leave the flag unset
   or `false` to keep saving disabled.


### 4. Run the development server

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

### 5. Before starting work

Update your local `main` branch:

```bash
git checkout main
git pull origin main
```

Then create a new branch:

```bash
git checkout -b feature/your-feature-name
```
