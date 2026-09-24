# CampoAI

> Farm management for livestock and crop operations, with an AI assistant you update records by talking to.

**[Live demo](https://campo-ai-mlx.vercel.app)**

Cattle and crop records tend to live in a notebook only one person understands. CampoAI puts hacienda, potreros, crops, health events, inventory, finances and parcel maps behind one farm-scoped dashboard shared between owner, editor and viewer members. Its distinguishing feature is the assistant: describe a change in plain Spanish, by text or voice note, and it transcribes, interprets, validates and writes it to the database. Interface and assistant are in Spanish (es-UY), built for Uruguayan and Argentine establecimientos.

## Features

- **Producción**: cattle batches by potrero with categories, breeds, ear tags and weight history (daily gain); crop plantings, applications and yields; vaccinations and health events
- **Gestión**: inventory with stock movements, income/expense finances per period and per potrero, tasks and a unified agenda, printable reports, validated CSV import, JSON/CSV export
- **Potreros y rotación**: the map shows what is in each potrero, stocking in UG/ha against capacity, days grazed and rested (kept by a database trigger on every cattle write), grazing history, and a suggested next potrero for herds that should move
- **Plan del día**: the day's work grouped by potrero (water problems, rotation moves, overdue tasks, vaccinations, harvests, the next spray window from the wind and rain forecast); share it over WhatsApp or print it
- **Assistant**: Groq (`openai/gpt-oss-120b` by default) answers from the live farm context and proposes database operations. Inserts apply directly; anything that changes or deletes existing records becomes a signed proposal the user confirms. Voice notes are transcribed with Whisper. Also reachable through an optional WhatsApp webhook
- **Offline**: an installable PWA that keeps private per-user snapshots and serves them read-only when the connection drops
- **Operations**: `/api/status` health probe (Supabase, Auth, schema migrations, Groq model), CSRF checks, Postgres-backed rate limits, idempotency keys on every write, bounded timeouts, 530+ unit tests

## Stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Radix UI
- Supabase: Postgres with row-level security per farm membership, email/password auth
- Groq: chat model (override with `GROQ_CHAT_MODEL`) and Whisper large v3 turbo
- Leaflet and Recharts; Open-Meteo for weather (no key)
- Vitest; deployed on Vercel Hobby

## Running locally

1. Create a Supabase project and run [`supabase/full_setup.sql`](./supabase/full_setup.sql) once in its SQL editor (see [`supabase/README.md`](./supabase/README.md) for the migration order).
2. Copy `.env.example` to `.env.local` and fill in the variables below.
3. Install and start:

```bash
npm ci
npm run dev
```

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Browser auth client |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-side data access (every route scopes by the session's farm) |
| `GROQ_API_KEY` | yes | Assistant, weekly summary, transcription |
| `GROQ_CHAT_MODEL` | no | Chat model id; set it when Groq retires the default |
| `AI_CONFIRMATION_SECRET` | no | HMAC key for confirmation tokens (falls back to the service-role key) |
| `TYPESAFE_API_KEY` | no | Jev gate that holds doubtful auto-inserts for confirmation (metered, ~USD 0.0004 per check; skipped when unset) |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` | no | WhatsApp Business Cloud API webhook; `/api/whatsapp` returns 503 without them |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm test` | Vitest (unit tests live next to the code in `src/lib/*.test.ts`) |
| `npm run typecheck` / `lint` | `tsc --noEmit` / ESLint |
| `npm run check:supabase` | Checks that every migration is in `full_setup.sql`, in order and documented |
| `npm run verify` | All of the above plus the build; CI runs it on every PR |

## Architecture

- `src/app/**/page.tsx`: client pages; `src/app/api/**/route.ts`: route handlers that resolve the user's farm from the session (`requireFarm`) and use the service-role client, never a client-supplied farm id.
- `src/lib/`: pure logic with a test next to each module (grazing, alerts, daily plan, dates, validation, offline snapshots). The assistant is `ai.ts` (orchestration) over `ai-farm-context`, `ai-context-budget`, `ai-prompt`, `ai-groq`, `ai-proposal` and `ai-execute`.
- `src/proxy.ts`: session refresh, CSRF check and auth redirects.
- `public/sw.js`: service worker; caches the app shell and static assets, never `/api/*`.
- `supabase/`: numbered migrations, `full_setup.sql` (all of them, in order) and the setup guide.

Planning and history: [`ROADMAP.md`](./ROADMAP.md) (open work), [`LOOP.md`](./LOOP.md) (how changes are shipped and verified), [`docs/history.md`](./docs/history.md) (what shipped and why), [`strategy.md`](./strategy.md) (product learnings).

---

Part of a series of 91 small web apps. [Browse them all](https://lorenzoylosada.vercel.app).
