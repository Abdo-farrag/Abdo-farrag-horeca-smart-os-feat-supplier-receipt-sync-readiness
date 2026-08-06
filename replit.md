# Horeca Smart OS

Private application platform for Horeca Smart. The first production module is **Procurement V1**.

## Stack

- **Monorepo** — npm workspaces (`apps/*`, `packages/*`)
- **Frontend** — React 19 + Vite (`apps/web`), runs on port **5173**
- **Backend** — Fastify 5 + TypeScript (`apps/api`), runs on port **3000**
- **Contracts** — shared Zod schemas (`packages/contracts`)
- **Database** — Supabase (Postgres + Auth + Edge Functions)

## How to run

```
npm run dev
```

Starts both services concurrently via the **Start application** workflow:
- Vite dev server → `http://localhost:5173`
- Fastify API → `http://localhost:3000`
- Vite proxies `/api` requests to the Fastify backend

## Required secrets (Replit Secrets)

| Key | Description |
|-----|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key |
| `OVERVIEW_PASSWORD_HASH` | bcrypt hash for the overview screen |
| `SESSION_SECRET` | ≥32-char random hex for session signing |

All four must be present or the API will refuse to start (`INVALID_SERVER_CONFIGURATION`).

## Verify the API is healthy

```
curl http://localhost:3000/api/health
# → {"data":{"service":"horeca-smart-os-api","status":"ok"},"error":null}
```

## Key files

- `apps/api/src/config.ts` — env schema (Zod); all secrets validated here
- `apps/api/src/server.ts` — Fastify entry point
- `apps/api/src/app.tsauth` — route definitions
- `apps/web/src/main.tsx` — React entry point
- `supabase/migrations/` — database migrations
- `docs/replit/` — Replit-specific setup notes

## Node version

Project targets Node 22. Replit currently runs Node 20 (a non-breaking engine warning appears on `npm install`).

## Do not deploy until

- Required Supabase migrations are applied
- All four secrets are added in the Replit Publishing pane
- Login, logout, Reviewer, and Admin flows pass against a non-production account
