# Docker images

Phase 8 builds two production-style images. There is no compose stack yet and
no registry push in this phase.

- `zayn-api:local`: the Express API from `apps/api`, built with TypeScript and
  run with Node. It serves `/media` from a writable `/data/media` volume.
- `zayn-web:local`: the Next.js storefront from `apps/web`, built as a Next
  standalone server with `node apps/web/server.js`.

Both images use `node:24-bookworm-slim`, pnpm `12.4.2` through Corepack, and a
non-root user. The build context is always the repository root.

## Build

```powershell
pnpm docker:build:api
pnpm docker:build:web
```

The API image has no build arguments. The web image bakes the public
`NEXT_PUBLIC_*` values into the Next build; they are build arguments, not
runtime secrets. `scripts/docker-build.mjs` supplies these local defaults and
allows overrides from the current environment:

| Build argument | Local default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | API base URL used by browser and server code |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | `http://localhost:4000` | API origin allowed by `next/image` for `/media` |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Public web origin |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | empty | Stripe publishable key |
| `NEXT_PUBLIC_APP_ENV` | `development` | Web app mode (`development`, `staging`, `production`) |

Example with production values:

```powershell
$env:NEXT_PUBLIC_API_URL = "https://api.example.com"
$env:NEXT_PUBLIC_MEDIA_BASE_URL = "https://api.example.com"
$env:NEXT_PUBLIC_SITE_URL = "https://www.example.com"
$env:NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_live_..."
$env:NEXT_PUBLIC_APP_ENV = "production"
pnpm docker:build:web
```

`NEXT_OUTPUT=standalone` is set only inside the web image build. Local
`pnpm dev` and ordinary local `pnpm build` do not use standalone output.

## Run the API

The API image runs as uid `1001`, uses `tini` as PID 1, and defaults to
`NODE_ENV=production`, `PORT=4000`. Create a media volume and pass the runtime
environment.

```powershell
docker volume create zayn-media
docker run --rm -p 4000:4000 -v zayn-media:/data/media `
  -e DATABASE_URL="postgres://user:pass@host:5432/db" `
  -e DATABASE_SSL=disable `
  -e APP_ENV=development `
  -e ADMIN_AUTH_SECRET="<at-least-32-characters>" `
  -e MEDIA_DIR=/data/media `
  -e MEDIA_PUBLIC_BASE_URL="http://localhost:4000" `
  -e WEB_ORIGIN="http://localhost:3000" `
  -e STOREFRONT_API_KEY="<random-shared-secret>" `
  zayn-api:local
```

Run migrations with the compiled entrypoint (no `tsx`, no source needed):

```powershell
docker run --rm --network <network> `
  -e DATABASE_URL="postgres://user:pass@db:5432/db" `
  zayn-api:local node dist/scripts/migrate.js
```

It applies `db-bootstrap/0000_roles.sql` and all Drizzle migrations. It is safe
to run more than once; the smoke test checks this.

### API runtime environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | image default `production` | Node mode and production validation |
| `APP_ENV` | no (default development) | `development`, `staging`, or `production` |
| `PORT` | image default `4000` | HTTP port |
| `DATABASE_URL` | yes in production | PostgreSQL connection string |
| `DATABASE_SSL` | no | `require` or `disable` |
| `ADMIN_AUTH_SECRET` | staging/production | Admin code and session signing secret, 32+ characters |
| `MEDIA_DIR` | staging/production | Absolute writable media directory |
| `MEDIA_PUBLIC_BASE_URL` | staging/production | Public API origin used for `/media` URLs |
| `MEDIA_MIN_FREE_MB` | no (default `500`) | Refuse uploads below this free space |
| `OWNER_EMAIL` | bootstrap only | Owner email for `admin:create-owner` |
| `WEB_ORIGIN` | no (default `http://localhost:3000`) | Allowed CORS origin |
| `STOREFRONT_API_KEY` | no | Shared key for server-side storefront requests |
| `RESEND_API_KEY` | no | Resend email API key |
| `EMAIL_FROM` | no | Transactional email sender |
| `STRIPE_SECRET_KEY` | production | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | production | Stripe webhook signing secret |
| `TWILIO_ACCOUNT_SID` | no | Twilio Verify account SID |
| `TWILIO_AUTH_TOKEN` | no | Twilio Verify auth token |
| `TWILIO_VERIFY_SERVICE_SID` | no | Twilio Verify service SID |

## Run the web app

```powershell
docker run --rm -p 3000:3000 `
  -e STOREFRONT_API_KEY="<same-value-as-the-api>" `
  zayn-web:local
```

The web image runs as uid `1001`, defaults to `NODE_ENV=production`,
`HOSTNAME=0.0.0.0`, and `PORT=3000`, and has no build tools or source tree.

### Web runtime environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `STOREFRONT_API_KEY` | when the API uses it | Server-only shared key; never a build argument |
| `APPLE_PAY_DOMAIN_ASSOCIATION` | no | Server-only Apple Pay domain file contents |
| `NODE_ENV` | image default `production` | Node mode |
| `HOSTNAME` | image default `0.0.0.0` | Listen address |
| `PORT` | image default `3000` | HTTP port |
| `NEXT_TELEMETRY_DISABLED` | image default `1` | Disable Next telemetry |

`NEXT_PUBLIC_*` values are inlined at build time and are not required at
runtime. Server-only secrets such as `STOREFRONT_API_KEY` are never build
arguments and are not present in either image.

## Smoke test

```powershell
pnpm docker:smoke
```

The script creates its own random PostgreSQL container, network, and media
volume. It rebuilds the web image with `NEXT_PUBLIC_API_URL=http://api:4000`
for that test only, runs migrations twice, seeds categories, starts the API and
web containers, checks HTTP responses, non-root operation, writable media,
`sharp` resizing, image contents, and image sizes. It removes every container,
network, and volume it created, including on failure. It never touches the
developer's `zayn-furnishings-postgres-dev` container or volume.

## Compose stack (Phase 9)

`docker-compose.stack.yml` runs the complete local stack with one published
edge port:

| Service | Role |
| --- | --- |
| `postgres` | PostgreSQL 16 data store on the named `pgdata` volume. No published port. |
| `migrate` | One-shot API image command: `node dist/scripts/migrate.js`. Runs after PostgreSQL is healthy and must complete before the API starts. |
| `api` | API image. Reaches PostgreSQL by service name, writes `/data/media` on the `media` volume, and is not published to the host. |
| `web` | Next standalone image. Server code uses `API_INTERNAL_URL=http://api:4000`; browser-facing values stay on `NEXT_PUBLIC_*`. Not published to the host. |
| `edge` | Caddy 2. The only published port: `127.0.0.1:${EDGE_HOST_PORT:-8080}:80`. Routes `/media/*` and `/webhooks/stripe` to the API and everything else to the web app. |

All services share one user-defined Compose network, so `api`, `web`,
`postgres`, and `edge` resolve by service name. `STOREFRONT_API_KEY` must be the
same value for `api` and `web`; the example env file has one variable that feeds
both. API and web use `read_only` root filesystems with small tmpfs mounts for
`/tmp` (and the web `.next/cache`); media writes go to the `media` volume.

### Initialize and run

```powershell
pnpm docker:stack:init
# Set OWNER_EMAIL and any Stripe/Resend/Twilio values in .env.compose.
pnpm docker:stack:up
```

`.env.compose` is ignored by Git and Docker. `docker:stack:init` generates
random alphanumeric `POSTGRES_PASSWORD`, `ADMIN_AUTH_SECRET`, and
`STOREFRONT_API_KEY` values and never prints them. The password is alphanumeric
so it can be embedded directly in `DATABASE_URL` without URL escaping.

Create the owner admin (the compiled entry exists in the API image):

```powershell
docker compose -f docker-compose.stack.yml --env-file .env.compose run --rm api node dist/scripts/createOwner.js
```

If your shell needs the project name explicitly, use `-p zayn`. Then open
`http://localhost:8080/admin/login`, request a code, and read the development
code from the API logs:

```powershell
pnpm docker:stack:logs
```

The code is logged only when `APP_ENV=development` and Resend is not configured.
This local edge is plain HTTP; Phase 10 adds TLS and the HTTPS-only cookie and
HSTS behavior.

### Build-time vs runtime for the web image

| Variable | Compose source | When |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `.env.compose` | Build-time, public edge origin |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | `.env.compose` | Build-time, public edge origin |
| `NEXT_PUBLIC_SITE_URL` | `.env.compose` | Build-time, public edge origin |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `.env.compose` | Build-time |
| `NEXT_PUBLIC_APP_ENV` | `.env.compose` | Build-time |
| `API_INTERNAL_URL` | Compose (`http://api:4000`) | Runtime, server-only |
| `STOREFRONT_API_KEY` | `.env.compose` | Runtime, server-only, shared with the API |
| `APPLE_PAY_DOMAIN_ASSOCIATION` | `.env.compose` | Runtime, server-only |
| `NODE_ENV` | `.env.compose` | Runtime |

### Stop, reset, logs

```powershell
pnpm docker:stack:down       # stop containers, keep zayn_pgdata and zayn_media
pnpm docker:stack:logs       # follow logs
pnpm docker:stack:reset -- --yes  # remove containers and volumes
```

`docker:stack:reset` refuses to remove volumes without `--yes`. The project name
is `zayn`, so the named volumes are `zayn_pgdata` and `zayn_media`.

### What is exposed

- Host: only `127.0.0.1:<EDGE_HOST_PORT>`, default `8080`.
- Not exposed: PostgreSQL `5432`, API `4000`, web `3000`.
- Through the edge: `/media/*` and `/webhooks/stripe` go to the API. The API's
  public, admin, health, and order routes are not directly published; for
  example `/api/public/categories` at the edge returns the web 404 page.
- The edge passes the original `Host` and adds `X-Forwarded-For`,
  `X-Forwarded-Proto`, and `X-Forwarded-Host`.

### Smoke test

```powershell
pnpm docker:stack:smoke
```

The smoke test uses the `zayn-smoke` Compose project, a temp env file in the OS
temp folder, and port `18080`. It builds the stack images, tests the edge,
migrations, owner creation, real code login, admin product and image upload,
media serving, foreign-origin rejection, deletion cleanup, API restart
persistence, and non-root operation. It removes all of its containers,
networks, volumes, and the temp env file even on failure, and never touches the
developer's `zayn-furnishings-postgres-dev` container or the real `.env.compose`.

### Phase 10 limitations

- No TLS: the edge listens on plain HTTP at `:80`. Phase 10 must add
  Cloudflare Tunnel/HTTPS, HSTS, and secure-cookie behavior.
- Visitor IP: Caddy's `X-Forwarded-For` is the direct peer. Behind Cloudflare,
  Caddy must use trusted proxies or Cloudflare's real-IP header before the app
  can see the real client IP.
- Stripe webhook URL: Phase 10 must set the public HTTPS webhook endpoint and
  matching signing secret.
- Same-origin checks: `NEXT_PUBLIC_SITE_URL` must equal the final public web
  origin used by the admin BFF, and Caddy must preserve the original Host.

## Logs

```powershell
docker logs -f <container-name>
```

The API and web healthchecks use Node `fetch`; no `curl` is installed.

## Remove the images

```powershell
docker image rm zayn-api:local zayn-web:local
```

Remove the smoke-test images only if you no longer need local builds. Named
media volumes created for real deployments are separate and are not removed by
this command.
