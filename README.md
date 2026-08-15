# 🐄 CampoAI — Gestión Agropecuaria Inteligente

A farm-management web app for livestock and crop operations. Track your hacienda, crops,
inventory and finances from one dashboard, with an AI assistant you talk to by **text or voice**
(Spanish, Río de la Plata). Built for Uruguayan/Argentine establecimientos.

**Live:** https://89campoai.vercel.app

## Features

- **Hacienda** — cattle batches by section, categories, breeds, weight, ear tags, vaccination &
  reproductive status. Move/split batches between potreros, or import up to 200 rows from a
  validated CSV with preview.
- **Agricultura** — crops per section, plantings, applications (fertilizer/herbicide/etc.), yields.
- **Sanidad** — vaccinations and health events (births, deaths, treatments) with a timeline.
- **Inventario** — stock items with movements; stock auto-updates via a DB trigger. Las compras
  con costo usan una escritura transaccional junto con Finanzas y se rechazan sin tocar el stock
  si falta la migración de integridad. Importá el inventario inicial desde CSV con preview y
  validación.
- **Finanzas** — income/expense transactions, per-period summaries, cost breakdowns, and
  validated CSV import with preview for up to 200 historical movements.
- **Mapa** — Leaflet map with padrón parcels and custom map features.
- **Métricas** — dashboard KPIs and charts (recharts).
- **Reportes** — reportes imprimibles de hacienda, finanzas, inventario y resultado por sección.
- **Pendientes** — centro de acciones con filtros por vacunación, stock, sanidad, cosecha, clima y
  tareas, con acceso directo y completado rápido de tareas.
- **Agenda unificada** — tareas, vacunaciones y cosechas agrupadas por día, con horizonte configurable,
  enlaces directos a cada registro, completar tareas desde la propia agenda, resumen del próximo trabajo
  en Inicio, lectura offline y exportación `.ics` con enlaces accionables.
- **Actividad reciente** — resumen en Inicio enlazado al registro histórico y actualizado después
  de cada mutación.
- **Resumen con IA** — análisis bajo demanda, cacheado para no bloquear la carga inicial del panel.
- **AI chat (text + voice)** — describe a change in natural language ("mové 10 terneros del Norte
  al Sur") and the assistant updates the database. Voice notes are transcribed with Groq Whisper.
  Los movimientos de inventario del chat pasan por validación de stock y la escritura transaccional
  de compras; no se pueden borrar historiales que sostienen los reportes. Las escrituras generadas
  por el modelo también validan categorías, estados, importes y fechas antes de llegar a Supabase.
- **Modo campo instalable** — agregá CampoAI a la pantalla de inicio y consultá el último panel
  sincronizado aun cuando la conexión se corte. La agenda y el registro de actividad conservan
  sus últimos datos, y la paleta conserva su índice de búsqueda, todo en modo lectura. El estado
  offline se muestra en toda la app; desde Mi campo también podés borrar las copias locales. Los
  datos privados no se guardan en el caché del API. Desde Mi campo podés preparar una copia
  completa bajo demanda antes de salir al campo.
- **Resiliencia de conexión** — el cliente Supabase y las lecturas/mutaciones tienen límites de
  espera; si Supabase está lento, la app muestra un estado recuperable o usa el último snapshot
  en vez de quedar cargando indefinidamente. En Gestión → Mi campo hay un diagnóstico separado de
  Supabase, Groq y la migración opcional de la agenda, con reintento manual. También hay una
  revisión de integridad de solo lectura que detecta compras de inventario sin asiento financiero,
  vínculos huérfanos o duplicados. Si Auth está temporalmente lento, el login informa la causa en
  lugar de presentarlo como una sesión vencida.
- **Operación continua y accesibilidad** — un cron diario consulta el estado de Supabase para
  mantener activo el proyecto gratuito, `robots.txt` no requiere sesión y los colores principales
  cumplen contraste AA en tema claro y oscuro. El diagnóstico separa la base de datos de Supabase
  Auth para que un fallo de inicio de sesión no quede oculto; el probe público usa una caché corta
  para no multiplicar consultas durante una ráfaga de visitas.
- **Protección de escrituras** — las mutaciones internas autenticadas verifican el origen de la
  solicitud para bloquear envíos cross-site; el webhook público de WhatsApp permanece separado.

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
public/sw.js         service worker para instalación y shell offline
supabase/           schema.sql + 002–014 migrations + full_setup.sql
```

---

Part of [The Slop Machine](https://00slopmachine.vercel.app).
