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

## Admin item creation setup

Saving at `/admin/items/new` stays disabled unless the server-side
`ADMIN_ITEM_CREATION_ENABLED` flag is exactly `true`. Do not enable it until the
reviewed migration has been checked and applied and the RLS checks below pass.

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
   defaults apply. It does not send `image_urls` or an empty array: photo
   uploads remain hidden until the column default and empty-array constraints
   have been confirmed. The migration also stops if required, unsupplied item
   columns have no database default or identity value, or if the money columns
   do not have a supported numeric type.

2. Inspect every current item `INSERT` and `ALL` policy:

   ```sql
   select policyname, permissive, roles, cmd, qual, with_check
   from pg_policies
   where schemaname = 'public'
     and tablename = 'items'
     and cmd in ('INSERT', 'ALL')
   order by policyname;
   ```

   The migration intentionally aborts if this query returns any rows. Review
   any existing policy with the team before changing it; do not assume that
   adding another policy narrows an existing permissive policy.

3. Review
   [`supabase/migrations/20261118175000_approved_admins_item_insert.sql`](./supabase/migrations/20261118175000_approved_admins_item_insert.sql).
   It creates the `approved_admins` membership table, self-read RLS policy, and
   the `items` INSERT policy, but does not modify or remove existing `items`
   policies. Apply it manually only after the preflight returns no policies and
   the expected catalog columns/RLS are confirmed.

4. Add the intended admin user's Auth UUID to `public.approved_admins` in SQL
   Editor:

   ```sql
   insert into public.approved_admins (user_id)
   values ('<AUTH_USER_UUID>');
   ```

5. Confirm the migration created the expected policies and RLS remains enabled:

   ```sql
   select policyname, permissive, roles, cmd, qual, with_check
   from pg_policies
   where schemaname = 'public'
     and tablename in ('items', 'approved_admins')
   order by tablename, policyname;

   select relrowsecurity
   from pg_class
   where oid = 'public.items'::regclass;
   ```

   The `items` INSERT policy must be permissive and check
   `approved_admins.user_id = auth.uid()`. The only `approved_admins` policy
   should allow authenticated users to read their own membership.

6. With a normal, non-admin test user's access token, send a direct authenticated
   `POST /rest/v1/items` using the catalog's required fields (omitting
   `image_urls`, `id`, and `created_at`). It must be rejected by RLS and create
   no row. This direct PostgREST test is important: the app route also denies
   non-admins before attempting an INSERT.

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
       "status": "draft"
     }'
   ```

   Expect an authorization error and verify that no matching row exists. If
   this insert succeeds, stop: do not enable app saving, and review the
   `items` policies before proceeding.

7. Only after schema and policy checks pass, set
   `ADMIN_ITEM_CREATION_ENABLED=true` in the server environment and restart or
   redeploy the app. Sign in as an approved admin, verify a no-session request
   is rejected, and test Draft and Published separately at
   `/admin/items/new`. Confirm published items appear at `/`. Leave the flag
   unset or `false` to keep saving disabled.


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
