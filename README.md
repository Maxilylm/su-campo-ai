# 🐄 CampoAI — Gestión Agropecuaria Inteligente

A farm-management web app for livestock and crop operations. Track your hacienda, crops,
inventory and finances from one dashboard, with an AI assistant you talk to by **text or voice**
(Spanish, Río de la Plata). Built for Uruguayan/Argentine establecimientos.

**Live:** https://89campoai.vercel.app

## Features

- **Hacienda** — cattle batches by section, categories, breeds, weight, ear tags, vaccination &
  reproductive status. Move/split batches between potreros.
- **Agricultura** — crops per section, plantings, applications (fertilizer/herbicide/etc.), yields.
- **Sanidad** — vaccinations and health events (births, deaths, treatments) with a timeline.
- **Inventario** — stock items with movements; stock auto-updates via a DB trigger.
- **Finanzas** — income/expense transactions, per-period summaries, cost breakdowns.
- **Mapa** — Leaflet map with padrón parcels and custom map features.
- **Métricas** — dashboard KPIs and charts (recharts).
- **AI chat (text + voice)** — describe a change in natural language ("mové 10 terneros del Norte
  al Sur") and the assistant updates the database. Voice notes are transcribed with Groq Whisper.

## Stack

- **Next.js 16** (App Router) + React 19, Tailwind v4, Radix UI, lucide icons.
- **Supabase** — Postgres + email/password Auth. Per-user data isolation by `farm_id`.
- **Groq** — Llama 3.3 70B for the assistant, Whisper for voice transcription. Free tier.
- **Vercel** — Hobby (free) deploy.

## Setup

### 1. Database (Supabase)

Create a free project at https://supabase.com, then in **SQL Editor** run
[`supabase/full_setup.sql`](./supabase/full_setup.sql) once. See
[`supabase/README.md`](./supabase/README.md) for the migration breakdown and notes.
Keep **Email** auth enabled (Authentication → Providers).

### 2. Environment

Copy `.env.example` → `.env.local` and fill in:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
GROQ_API_KEY=...            # https://console.groq.com (free)
```

The app validates these at runtime (`src/lib/env.ts`) and fails with a clear message if any are
missing. `GET /api/status` reports liveness (`{ ok, supabase, groq }`) without auth.

### 3. Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm test         # vitest unit tests
```

First login → create your farm at `/setup` → start managing.

## WhatsApp (optional, experimental)

A WhatsApp Business Cloud API webhook exists (`/api/whatsapp`) so you can update your farm by
messaging a bot. It is **entirely optional**: without `WHATSAPP_ACCESS_TOKEN` and
`WHATSAPP_PHONE_NUMBER_ID` the route returns 503 and the rest of the app is unaffected. Setting it
up requires a Meta Business account and number approval — out of scope for the core app.

## Project layout

```
src/app/            routes — produccion/* , gestion/* , mapa, chat, api/*
src/lib/            env, supabase clients, ai (Groq), json, cattle, rate-limit
src/components/     UI (Radix-based) + shared widgets
supabase/           schema.sql + 002–007 migrations + full_setup.sql
```

---

Part of [The Slop Machine](https://00slopmachine.vercel.app).
