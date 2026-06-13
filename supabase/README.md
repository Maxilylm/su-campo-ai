# CampoAI — Database setup

CampoAI runs on Supabase (Postgres + Auth). To stand up a fresh database:

## Quick setup (recommended)

1. Create a free Supabase project at https://supabase.com.
2. Open **SQL Editor** → paste the contents of [`full_setup.sql`](./full_setup.sql) → **Run**.
3. Grab your keys from **Project Settings → API** and set the app env vars:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. In **Authentication → Providers**, keep **Email** enabled (the app uses email/password).
   For zero-friction local testing you may disable "Confirm email".

`full_setup.sql` is the seven migrations concatenated in apply order. **Run it once on a
fresh project** — it is *not* re-runnable, because `CREATE POLICY` has no `IF NOT EXISTS`
and will error on a second run.

## Apply order (manual / for reference)

If you prefer to apply migrations individually, run them strictly in this order:

| # | File | Adds |
|---|------|------|
| 1 | `schema.sql` | `farms`, `sections`, `cattle`, `activities` + base RLS |
| 2 | `002_auth.sql` | `farms.user_id`, swaps anon-read policies for per-user RLS |
| 3 | `003_expanded.sql` | section/cattle columns, `vaccinations`, `health_events` |
| 4 | `004_chat_messages.sql` | `chat_messages` (in-app + voice chat history) |
| 5 | `005_map.sql` | `padrones`, `map_features`, `sections.padron_id` |
| 6 | `006_section_map.sql` | `sections.map_center` |
| 7 | `007_expansion.sql` | `farms.operation_type`, `crops`, `crop_applications`, `inventory_items`, `inventory_movements` (+ stock trigger), `financial_transactions` |

## Notes / known drift

- **Tables created by migrations but not in `schema.sql`**: everything from 003 onward is
  additive via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`, so
  the column additions (`operation_type`, `padron_id`, `map_center`, cattle/section fields)
  are all captured in the ordered migrations — `full_setup.sql` is the source of truth.
- **`farms.owner_phone` is `NOT NULL UNIQUE`** but the web app has no phone. The farm-create
  route (`/api/farm`) supplies a synthetic `web-<user_id>` value, so web signup works without
  a phone. WhatsApp-created farms use the real `+<number>`.
- **RLS**: API routes use the service-role client (bypasses RLS) and scope every query by the
  `farm_id` derived from `auth.uid()`. The per-user policies are belt-and-suspenders for any
  direct anon/auth client access.
- **WhatsApp** columns/flow exist but the integration is optional and out of scope for the
  core app; nothing here requires WhatsApp credentials.
