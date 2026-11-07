# Zayn Furnishings

A US-only furniture e-commerce store. This repository currently contains **project
setup only** — product, cart, and checkout features will be added later.

## Stack

- **Monorepo:** pnpm workspaces
- **Web (`apps/web`):** Next.js (App Router, TypeScript, Tailwind CSS, ESLint), deployed to Vercel
- **API (`apps/api`):** Node.js + Express + TypeScript, deployed to Render
- **Shared (`packages/shared`):** shared TypeScript types and constants
- **Database:** Supabase Postgres via Drizzle ORM + `drizzle-kit` and the `postgres` driver
- **Other:** zod (validation), dotenv (env loading), tsx (dev runner), CORS, helmet

## Structure

```
zayn-furnishings/
├── apps/
│   ├── api/        Express + TypeScript API
│   └── web/        Next.js web app
├── packages/
│   └── shared/     Shared types and constants
├── package.json
└── pnpm-workspace.yaml
```

## Prerequisites

- Node.js 20+
- pnpm (`corepack enable` or `npm install -g pnpm`)

## Setup

```powershell
pnpm install
```

Create local env files from the examples (they contain no secrets):

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env
```

Then fill in `apps/api/.env` with your Supabase values (see below).

## Run

```powershell
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:4000/health

`pnpm dev` builds `packages/shared` once, then runs the web and API dev servers
together.

## Scripts

| Command            | Description                                    |
| ------------------ | ---------------------------------------------- |
| `pnpm dev`         | Run web + API in watch mode                    |
| `pnpm build`       | Build shared, API, and web                     |
| `pnpm lint`        | Type-check shared/API and lint web             |
| `pnpm start`       | Start the built API                            |
| `pnpm db:generate` | Generate Drizzle migrations from the schema    |
| `pnpm db:migrate`  | Apply Drizzle migrations to the database       |

## Environment

### `apps/api/.env`

| Variable                    | Notes                                                        |
| --------------------------- | ------------------------------------------------------------ |
| `PORT`                      | API port (default `4000`)                                    |
| `NODE_ENV`                  | `development` / `test` / `production`                        |
| `DATABASE_URL`              | Supabase Postgres connection string (session pooler)         |
| `SUPABASE_URL`              | Supabase project URL                                         |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only)                 |
| `WEB_ORIGIN`                | Allowed CORS origin (e.g. `http://localhost:3000`)           |

> **Database connection:** use the Supabase **session pooler** connection string
> (port `5432`), **not** the transaction pooler on port `6543`. Render's free
> tier is IPv4-only while Supabase's direct connection is IPv6, so the session
> pooler is required.

### `apps/web/.env`

| Variable              | Notes                                  |
| --------------------- | -------------------------------------- |
| `NEXT_PUBLIC_API_URL` | Base URL of the API (e.g. `http://localhost:4000`) |

Until `DATABASE_URL` is set, `GET /health` returns `db: false` — this is expected.

## Deploy (later)

- Web → Vercel (root `apps/web`)
- API → Render (root `apps/api`)
