# CampoAI

> Farm management for livestock and crop operations, with an AI assistant you update records by talking to.

**[Live demo](https://campo-ai-mlx.vercel.app)**

Cattle and crop records tend to live in a notebook only one person understands. CampoAI puts hacienda, crops, health events, inventory, finances and parcel maps behind one farm-scoped dashboard with role-based access. Its distinguishing feature is the assistant: describe a change in plain Spanish, by text or voice note, and it transcribes, interprets, validates and writes it to the database. Interface and assistant are in Spanish, built for Uruguayan and Argentine establecimientos.

## Features

- **Producción** — cattle batches by section with categories, breeds, ear tags and weights; crop plantings, applications and yields; vaccinations and health events
- **Gestión** — inventory with stock movements, income/expense finances with per-period summaries, task and agenda scheduling, and validated CSV import
- **Mapa & Métricas** — Leaflet map of padrón parcels and custom features, plus KPI dashboards and charts
- **AI assistant** — Groq Llama 3.3 70B interprets requests and executes database operations; voice notes transcribed with Whisper; model-generated writes are validated and made idempotent before reaching Supabase
- **Offline field mode** — installable PWA whose service worker serves the last synced dashboard read-only when the connection drops
- **Hardening** — startup env validation, unauthenticated `/api/status` liveness probe, rate limiting, CSRF checks on mutations, request timeouts, and 340+ unit tests

## Stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Radix UI
- Supabase — Postgres and email/password auth, data isolated by `farm_id`
- Groq — Llama 3.3 70B for the assistant, Whisper large v3 turbo for transcription
- Leaflet and Recharts for maps and charts; Open-Meteo for weather; optional WhatsApp Business Cloud API webhook
- Vitest

## Running locally

Run [`supabase/full_setup.sql`](./supabase/full_setup.sql) once in your Supabase SQL editor, then copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `GROQ_API_KEY`. The `WHATSAPP_*` variables are optional.

```bash
npm install
npm run dev
```

---

Part of a series of 91 small web apps. [Browse them all](https://lorenzoylosada.vercel.app).
