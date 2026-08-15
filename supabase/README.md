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

`full_setup.sql` is the ordered migration set concatenated into one script. **Run it once on a
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
| 8 | `008_insights.sql` | Cached AI insights |
| 9 | `009_weight_records.sql` | Weight history |
| 10 | `010_integrity.sql` | Transactional purchase/weight writes and unique farm ownership |
| 11 | `011_whatsapp_events.sql` | Incoming-message idempotency and retry state |
| 12 | `012_audit_triggers.sql` | Database-level activity history for ordinary mutations |
| 13 | `013_inventory_currency.sql` | Currency-preserving inventory movements and valuation updates |
| 14 | `014_tasks.sql` | Persistent operational tasks linked to sections, cattle and crops |
| 15 | `015_financial_inventory_links.sql` | One financial entry per inventory movement |
| 16 | `016_cattle_ear_tags.sql` | One non-empty caravana per field |
| 17 | `017_idempotency.sql` | Safe retry keys for inventory purchases and weighings |
| 18 | `018_padron_transaction.sql` | Atomic padrón plus initial section creation |
| 19 | `019_padron_idempotency.sql` | Safe retries for padrón creation |
| 20 | `020_import_idempotency.sql` | Safe retries for CSV imports |
| 21 | `021_cattle_move_transaction.sql` | Atomic whole-batch and split-batch cattle moves |
| 22 | `022_task_idempotency.sql` | Safe retries for task creation |
| 23 | `023_financial_idempotency.sql` | Safe retries for financial transactions |
| 24 | `024_operational_idempotency.sql` | Safe retries for agriculture and animal-health records |
| 25 | `025_map_feature_idempotency.sql` | Safe retries for drawn map infrastructure |
| 26 | `026_chat_request_idempotency.sql` | Safe retries for AI chat requests and responses |
| 27 | `027_whatsapp_side_effects.sql` | Safe WhatsApp response retries after AI changes |
| 28 | `028_sample_data_idempotency.sql` | Safe retries for demo data seeding |
| 29 | `029_hacienda_idempotency.sql` | Safe retries for section and cattle creation |
| 30 | `030_inventory_item_idempotency.sql` | Safe retries for inventory item creation |
| 31 | `031_farm_memberships.sql` | Shared fields with owner, editor and viewer roles plus invite records |

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
- **Tasks activation**: `014_tasks.sql` enables persistent agenda storage. Until it is applied,
  the app keeps the rest of the product usable, shows a migration notice in Agenda, and omits
  `tasks` from the full JSON backup with an explicit `omitted_tables` entry.
- **Farm sharing**: `031_farm_memberships.sql` backfills the existing owner into `farm_members`
  and adds editor/viewer membership policies. The API keeps a legacy `farms.user_id` fallback
  until this migration is applied, so existing owner sessions remain usable during rollout.
