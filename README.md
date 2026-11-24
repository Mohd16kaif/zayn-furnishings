# Zayn Furnishings

A US-only furniture e-commerce store. This repository currently contains **project
setup only** — product, cart, and checkout features will be added later.

## Stack

- **Monorepo:** pnpm workspaces
- **Web (`apps/web`):** Next.js (App Router, TypeScript, Tailwind CSS, ESLint), deployed to Vercel
- **API (`apps/api`):** Node.js + Express + TypeScript
- **Shared (`packages/shared`):** shared TypeScript types and constants
- **Database:** PostgreSQL via Drizzle ORM + `drizzle-kit` and the `postgres` driver
- **Admin auth:** the app's own email-code login and database-backed sessions
- **Media:** local files served from the API at `/media`
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

Then fill in `apps/api/.env` with your database and service values (see below).

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
| `DATABASE_URL`              | Plain PostgreSQL connection string                           |
| `MEDIA_DIR`                 | Absolute media directory (development defaults to `apps/api/media-data`) |
| `MEDIA_PUBLIC_BASE_URL`     | Public API origin used to build `/media` image URLs          |
| `ADMIN_AUTH_SECRET`         | Secret for admin login codes and sessions                    |
| `WEB_ORIGIN`                | Allowed CORS origin (e.g. `http://localhost:3000`)           |

Local development can use the plain PostgreSQL container documented in
`docker-compose.dev.yml`. Admin sign-in uses the app's own email-code flow; no
external auth provider is required.

### `apps/web/.env`

| Variable                        | Notes                                  |
| ------------------------------- | -------------------------------------- |
| `NEXT_PUBLIC_API_URL`           | Base URL of the API (e.g. `http://localhost:4000`) |
| `NEXT_PUBLIC_MEDIA_BASE_URL`    | API public origin allowed by `next/image` for `/media` URLs |
| `APPLE_PAY_DOMAIN_ASSOCIATION`  | Server-only Apple Pay domain association file contents; never `NEXT_PUBLIC_` |

Until `DATABASE_URL` is set, `GET /health` returns `db: false` — this is expected.

## Deploy (later)

The hosting sections are being rewritten for the Docker/VPS target in phases
8-12 of [docs/SUPABASE_REMOVAL_PLAN.md](docs/SUPABASE_REMOVAL_PLAN.md). See
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the current environment variable
reference and the clearly marked legacy hosting notes.

## Troubleshooting

- If the storefront styles disappear (plain unstyled HTML), delete `apps/web/.next` and restart the dev server — stale Turbopack CSS chunks can break stylesheet resolution.
