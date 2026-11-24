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
