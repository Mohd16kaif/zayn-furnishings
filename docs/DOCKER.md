# Docker images and stack

Phase 8 builds two production-style images, Phase 9 adds the Compose stack,
Phase 10 adds Cloudflare Tunnel profiles and HTTPS-aware edge behavior, and
Phase 11 adds encrypted restic backups and a restore drill. There is no registry
push in these phases. Backup operations are documented in
[BACKUPS.md](./BACKUPS.md).

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
| `API_INTERNAL_URL` | `http://api:4000` | Internal API origin used by the baked `/media` rewrite; server-only, not a secret |

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

`API_INTERNAL_URL` is also used inside the web image to bake the `/media`
rewrite. Next rewrites are generated at build time, so changing the internal
API host requires rebuilding the web image. The same value is supplied at
runtime for server-side API calls.

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
| `API_INTERNAL_URL` | compose stack | Internal API origin for server-side calls; must match the build-time rewrite host |
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
| `edge` | Caddy 2.11.9. The only published port: `127.0.0.1:${EDGE_HOST_PORT:-8080}:80`. Routes `/media/*` and `/webhooks/stripe` to the API and everything else to the web app. |
| `backup` | Optional, profile `backup`. One-shot restic backup of PostgreSQL and the read-only `media` volume. No published ports, non-root, `cap_drop: ALL`, `no-new-privileges`, read-only root with a `/scratch` tmpfs. Not started by default. |
| `tunnel` | Optional, profile `tunnel`. `cloudflare/cloudflared:2026.11.2` runs a named Cloudflare Tunnel from `TUNNEL_TOKEN`. No published ports. |
| `quicktunnel` | Optional, profile `quicktunnel`. The same cloudflared image runs an anonymous quick tunnel to `http://edge:80`. Testing only. |
| `tunnel-token-check` | One-shot profile `tunnel` guard that fails with a clear message when `TUNNEL_TOKEN` is empty. It never prints the token. |

All services share one user-defined Compose network, so `api`, `web`,
`postgres`, and `edge` resolve by service name. `STOREFRONT_API_KEY` must be the
same value for `api` and `web`; the example env file has one variable that feeds
both. API and web use `read_only` root filesystems; media writes go to the
`media` volume.

### Web runtime caches and the read-only root

Next writes regenerated prerenders and optimized images at runtime, so the web
container gets three tmpfs mounts while keeping `read_only: true`:

| Mount | Owner / mode | Size | Purpose |
| --- | --- | --- | --- |
| `/tmp` | default tmpfs | default | Temporary files |
| `/app/apps/web/.next/cache` | `1001:1001`, `0700` | 128 MB | `next/image` optimizer cache |
| `/app/apps/web/.next/server/route-cache` | `1001:1001`, `0700` | 128 MB | Cache Components regenerated page/prerender output |

These are caches. It is safe to lose them on restart: the container starts with
an empty route cache and empty image cache, pages regenerate from the API and
database on the next request, and images are optimized again on demand. Do not
make the whole `.next` directory or the container root writable. The `web`
service still runs as uid `1001` with `cap_drop: ALL` and
`no-new-privileges`.

To check for cache write failures after generating traffic:

```powershell
docker compose -f docker-compose.stack.yml --env-file .env.compose logs web |
  Select-String "Failed to update prerender cache|EROFS|ENOENT|EACCES"
```

A clean result prints nothing. The smoke test also asserts that the web logs
stay clean, that the tmpfs mounts are owned by uid/gid `1001`, and that the web
root remains read-only.

### How images are served in the stack

- The API still stores and returns absolute public media URLs built from
  `MEDIA_PUBLIC_BASE_URL` (the edge origin).
- `SmartImage` and the admin image components pass absolute media URLs through
  `resolveMediaImageSrc()`. If the URL origin equals
  `NEXT_PUBLIC_MEDIA_BASE_URL` and the path starts with `/media/`, it becomes a
  site-relative `/media/<path>` with no query string.
- `images.localPatterns` allows only `/media/**` and `/images/**` without query
  strings. Next optimizes `/media/...` through `/_next/image`.
- A Next rewrite proxies `/media/:path*` to `API_INTERNAL_URL` (the `api`
  service inside Compose). This is only for the optimizer's internal fetch.
- Caddy still routes browser requests for `/media/*` directly to the API. The
  API media route, cache headers, and path validation are unchanged.
- Non-Docker development keeps working: without `API_INTERNAL_URL`, the rewrite
  targets `http://localhost:4000`, and absolute local media URLs are converted
  to relative paths.
- The remote `NEXT_PUBLIC_MEDIA_BASE_URL` pattern remains for non-Docker
  setups that still use absolute URLs; production does not enable
  `dangerouslyAllowLocalIP`.

### Initialize and run

```powershell
pnpm docker:stack:init
# Set OWNER_EMAIL and any Stripe/Resend/Twilio values in .env.compose.
pnpm docker:stack:up
```

`.env.compose` is ignored by Git and Docker. `docker:stack:init` generates
random alphanumeric `POSTGRES_PASSWORD`, `ADMIN_AUTH_SECRET`,
`STOREFRONT_API_KEY`, and `RESTIC_PASSWORD` values and never prints them. The
database password is alphanumeric so it can be embedded directly in
`DATABASE_URL` without URL escaping. If an existing `.env.compose` is missing
`RESTIC_PASSWORD` or `RESTIC_REPOSITORY`, init refuses to rewrite it and prints a
one-line reminder; add the values manually and store `RESTIC_PASSWORD` in the
client's password manager.

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
The local edge itself stays plain HTTP on `:80`; HTTPS is terminated by
Cloudflare when a tunnel profile is active. Use `NODE_ENV=development` for the
local HTTP stack (cookies are not marked Secure and work over HTTP) and
`NODE_ENV=production` for a real tunnel deployment (cookies are Secure and
HttpOnly). See "Cloudflare Tunnel" below.

### Cloudflare Tunnel (Phase 10)

A Cloudflare Tunnel is an outbound-only connection from the server to
Cloudflare. Cloudflare terminates HTTPS for the public hostname and forwards the
request to Caddy over the private Compose network. The edge keeps publishing
only `127.0.0.1:${EDGE_HOST_PORT}`; no inbound port is opened on the server.

There are two profiles:

- `pnpm docker:stack:up:quick` starts the `quicktunnel` profile. It needs no
  Cloudflare account or token, prints a temporary
  `https://<random>.trycloudflare.com` URL, and is for testing only. Anyone with
  the URL can reach the stack while it runs. Quick tunnel hostnames change on
  every start, so they cannot be baked into `NEXT_PUBLIC_SITE_URL`; use a named
  tunnel for a stable HTTPS origin.
- `pnpm docker:stack:up:tunnel` starts the `tunnel` profile. It requires
  `TUNNEL_TOKEN` in `.env.compose` and serves the public hostname configured in
  the Cloudflare dashboard. The token is passed to cloudflared as an environment
  variable, never on the command line; it is never printed by the scripts.

Both profiles depend on a healthy edge, join the same Compose network, publish
no ports, restart unless stopped, drop all capabilities, set
`no-new-privileges`, use a read-only root with a `/tmp` tmpfs, and rotate logs.
The cloudflared image is tag-pinned to `cloudflare/cloudflared:2026.11.2` (not
digest-pinned). The cloudflared healthcheck uses the binary's `tunnel ready`
command, which queries the local metrics `/ready` endpoint. The helper
`tunnel-token-check` fails the `tunnel` profile with a clear message when
`TUNNEL_TOKEN` is empty.

#### Create a named tunnel (UNVERIFIED dashboard labels, may differ)

The dashboard labels below could not be verified from this repository; they may
differ in the current Cloudflare UI.

1. Open the Cloudflare dashboard, then **Zero Trust** > **Networks** >
   **Tunnels**.
2. Create a tunnel and choose **Cloudflare** (remotely managed). Give it a name.
3. Add a **Public hostname**. Pick the subdomain/domain, set the service type to
   **HTTP**, and set the URL to `edge:80`. That is the internal Compose service
   name and port; do not use `localhost`.
4. Copy the tunnel token from the dashboard. Paste it into `TUNNEL_TOKEN` in
   `.env.compose` (never commit that file and never paste the token into a
   command line, issue, or chat).
5. Optionally protect `/admin` with Cloudflare Access or WAF rules.
6. Run `pnpm docker:stack:up:tunnel`. The stack builds the web image and starts
   the tunnel.
7. Set the public HTTPS origin in `.env.compose`:
   `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_MEDIA_BASE_URL`, `NEXT_PUBLIC_API_URL`,
   `MEDIA_PUBLIC_BASE_URL`, and `WEB_ORIGIN`. Rebuild web and restart the API as
   described below.
8. In Stripe, set the webhook URL to `https://<domain>/webhooks/stripe` and put
   the signing secret in `STRIPE_WEBHOOK_SECRET`.

A locally-managed tunnel with a credentials file is not used here; this Compose
service runs a remotely-managed token tunnel.

#### Trust model and real visitor IP

This is safe only because the edge port is bound to `127.0.0.1` and the tunnel
is the only ingress. Caddy trusts only private/loopback peers: `10.0.0.0/8`,
`172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.1/8`, `fd00::/8`, and `::1`. In this
stack those are the cloudflared container and the local Docker gateway that the
published loopback port uses. For a trusted peer Caddy reads the visitor IP from
`CF-Connecting-IP` first and `X-Forwarded-For` second (right-to-left,
`trusted_proxies_strict`). It then overwrites `X-Forwarded-For` and `X-Real-IP`
with that single client IP, sets `X-Forwarded-Proto` to the original `https` or
`http` scheme, and removes client-supplied `CF-Connecting-IP`, `CF-Visitor`,
`X-Visitor-IP`, `X-Storefront-Key`, `X-Admin-Session`, and `Forwarded` before
forwarding to web or API.

`requestGuards.getVisitorIp()` reads `x-forwarded-for` first (now the validated
single client IP) and falls back to `x-real-ip`; the API talks to the web app
with the shared `STOREFRONT_API_KEY` and the `x-visitor-ip` header, and its
public rate limiter keys on that value only when the key matches. The web server
never reads a visitor IP from a client-supplied `x-visitor-ip`, and the API is
not published.

The scheme headers are read for every request because the edge is loopback-only.
If the edge were ever exposed directly, or reached through another untrusted
proxy, a client could spoof `CF-Connecting-IP` and the scheme headers. Never
publish the edge listener on a public interface.

#### HTTPS values, rebuilds, and cookies

`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_MEDIA_BASE_URL`, and
`NEXT_PUBLIC_API_URL` are build arguments baked into the web image; changing the
public domain requires rebuilding the web image. `MEDIA_PUBLIC_BASE_URL` (API
product media URLs) and `WEB_ORIGIN` (API CORS) are runtime values, so restart
the API after changing them. The `docker:stack:up*` scripts build first, and
they warn when a tunnel profile is active while these public origins still point
at localhost, are unset, or are not HTTPS.

The admin `zf_admin_session` and customer `zf_session` cookies are always
`HttpOnly`, `SameSite=Lax`, and `Path=/`. They add `Secure` only when
`NODE_ENV=production`. That is correct for a real tunnel deployment: set
`NODE_ENV=production` and the browser sends the cookies only over HTTPS. Local
`http://localhost` development uses `NODE_ENV=development`, so the cookies are
usable without TLS. The flag is not derived from `X-Forwarded-Proto`; using
`NODE_ENV=development` behind the tunnel is for local testing only and does not
mark cookies Secure.

The admin BFF same-origin guard compares the request `Origin` (and
`Sec-Fetch-Site`) with `NEXT_PUBLIC_SITE_URL`, or with the request URL when it is
unset. With a tunnel, set it to the public `https://<domain>` origin and rebuild
web. A quick tunnel's random hostname is not known at build time, so admin login
through a quick tunnel needs a web rebuild with that origin; use a named tunnel
for normal operation.

#### Conservative HSTS

Caddy sends `Strict-Transport-Security` only when the original request was HTTPS
(`CF-Visitor` or `X-Forwarded-Proto`). The default is:

```text
Strict-Transport-Security: max-age=300
```

There is no `includeSubDomains` and no `preload` in the first rollout. After the
HTTPS site is verified, raise `HSTS_MAX_AGE` in `.env.compose` in steps: `86400`
(1 day), then `2592000` (30 days), then `15552000` (180 days). Restart the edge
after changing it. Do not add `includeSubDomains` or `preload` until every
subdomain is HTTPS-only.

#### VPS notes (unverified)

cloudflared connects outbound to Cloudflare. A VPS with only IPv6 outbound may
need `TUNNEL_EDGE_IP_VERSION=auto` or `6` in `.env.compose`, and outbound
TCP/UDP 7844 must be allowed. This was not tested on an IPv6-only VPS.

### Backups (Phase 11)

The full developer and owner guide is [BACKUPS.md](./BACKUPS.md). The key
points for the stack:

- The `backup` service is behind the `backup` profile and never starts with
  `docker:stack:up`. It is built from `deploy/backup/Dockerfile` on
  `postgres:16` (so `pg_dump` is major version 16 and matches the server) and
  installs restic `0.18.0` from the Debian package repository. The entrypoint
  asserts the `pg_dump` and server major versions at runtime.
- The media volume is mounted `:ro`. The container runs as uid/gid `1001`
  (`zaynbackup`) because the API writes media as `1001:1001`. It drops all
  capabilities, sets `no-new-privileges`, uses a read-only root with a
  `/scratch` tmpfs, and publishes no ports.
- `RESTIC_REPOSITORY` and `RESTIC_PASSWORD` are required in `.env.compose`.
  The default local `RESTIC_REPOSITORY=/repo` is the `backup-repo` Docker
  volume and is **not** an off-server backup. Use an S3-compatible bucket or
  sftp for real backups. S3 credentials use `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, and `AWS_DEFAULT_REGION`.
- Losing `RESTIC_PASSWORD` makes every backup unreadable. Store it in the
  client's password manager and keep an offline copy. `.env.compose` is not
  included in backups.
- `BACKUP_KEEP_DAILY` (default `7`), `BACKUP_KEEP_WEEKLY` (`4`), and
  `BACKUP_KEEP_MONTHLY` (`6`) control `restic forget --prune`. The newest
  snapshot is always kept. `RESTIC_HOST` defaults to `zayn-stack` so one-shot
  runs share a retention group.
- `BACKUP_READ_DATA_SUBSET` is optional. When set (for example `5%` or `1/10`)
  the script also runs `restic check --read-data-subset`. The metadata
  `restic check` always runs.
- The status file is written to the `backup-status` volume at
  `/status/last-backup.json` and contains no secrets. An optional
  `HEALTHCHECK_PING_URL` is pinged after success and with `/fail` after a
  failure; the URL is never printed.
- Commands:

  ```powershell
  pnpm docker:backup:run
  pnpm docker:backup:list
  pnpm docker:restore
  pnpm docker:backup:drill
  ```

`docker:backup:run` refuses unless the stack is up and the two restic values are
set. `docker:restore` restores into a fresh PostgreSQL container and a fresh
media volume by default. `--into-live` additionally requires the typed word
`RESTORE-LIVE` and stopped `api`/`web` containers.

The project volumes are now `zayn_pgdata`, `zayn_media`, `zayn_backup-repo`,
and `zayn_backup-status`.

### Build-time vs runtime for the web image

| Variable | Compose source | When |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `.env.compose` | Build-time, public edge origin |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | `.env.compose` | Build-time, public edge origin |
| `NEXT_PUBLIC_SITE_URL` | `.env.compose` | Build-time, public edge origin |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `.env.compose` | Build-time |
| `NEXT_PUBLIC_APP_ENV` | `.env.compose` | Build-time |
| `API_INTERNAL_URL` | Compose (`http://api:4000`) | Build-time rewrite destination and runtime server calls |
| `STOREFRONT_API_KEY` | `.env.compose` | Runtime, server-only, shared with the API |
| `APPLE_PAY_DOMAIN_ASSOCIATION` | `.env.compose` | Runtime, server-only |
| `NODE_ENV` | `.env.compose` | Runtime |

### Stop, reset, logs

```powershell
pnpm docker:stack:down       # stop containers (including tunnel profiles), keep volumes
pnpm docker:stack:logs       # follow logs
pnpm docker:stack:reset -- --yes  # remove containers and volumes
```

`docker:stack:down` and `docker:stack:reset` pass both tunnel profiles, so
named and quick tunnel containers are removed too. `docker:stack:reset` refuses
to remove volumes without `--yes`. The project name is `zayn`, so the named
volumes are `zayn_pgdata`, `zayn_media`, `zayn_backup-repo`, and
`zayn_backup-status`. Removing the backup volumes deletes the local backup
repository; remote repositories are unaffected.

### What is exposed

- Host: only `127.0.0.1:<EDGE_HOST_PORT>`, default `8080`.
- Not exposed: PostgreSQL `5432`, API `4000`, web `3000`.
- Through the edge: `/media/*` and `/webhooks/stripe` go to the API. The API's
  public, admin, health, and order routes are not directly published; for
  example `/api/public/categories` at the edge returns the web 404 page.
- The edge passes the original `Host`, sets `X-Forwarded-For` and `X-Real-IP`
  to the single validated visitor IP, sets `X-Forwarded-Proto` to the original
  scheme, and strips client-supplied `CF-Connecting-IP`, `CF-Visitor`,
  `X-Visitor-IP`, `X-Storefront-Key`, `X-Admin-Session`, and `Forwarded`. See
  "Trust model and real visitor IP" above.
- The tunnel services publish no ports. Only the edge is bound to the host, on
  `127.0.0.1`.

### Smoke test

```powershell
pnpm docker:stack:smoke
```

The smoke test uses the `zayn-smoke` Compose project, a temp env file in the OS
temp folder, and port `18080`. It builds the stack images, tests the edge,
migrations, owner creation, real code login, admin product and image upload,
media serving, foreign-origin rejection, deletion cleanup, API restart
persistence, and non-root operation. It also simulates the tunnel from the host
with `CF-Connecting-IP` / `X-Forwarded-Proto`, checks that Caddy trusts only the
Docker gateway peer and derives the visitor IP from `CF-Connecting-IP` (not
client-supplied `X-Forwarded-For`), checks the per-IP rate limiter buckets,
checks conservative HSTS only on HTTPS, checks that forged admin/storefront
headers do not authenticate, and checks that the tunnel services stay behind
profiles and both profile configs validate.

It also verifies the read-only web runtime: the tmpfs ownership and size, a real
admin product PATCH followed by the admin content UI's `revalidateStorefront`
server action, the new name and price becoming visible on the product and
category pages within 15 seconds, the same values persisting across a web
restart, and zero `Failed to update prerender cache` / `EROFS` / `ENOENT` /
`EACCES` lines in the web logs. The Caddy access-log check sends a fake
User-Agent, Cookie, Referer, and query string and asserts that none of them
appear, that all headers are absent, that the path-only `uri` is logged, and
that loopback healthchecks are skipped. It also stops the web container briefly
to force a 502, sends a request with a fake User-Agent, Cookie, Referer, and
query string, and asserts that the `http.log.error` line keeps only the compact
error fields and none of those values. The smoke removes all of its containers,
networks, volumes, and the temp env file even on failure, and never touches the
developer's `zayn-furnishings-postgres-dev` container or the real `.env.compose`.

The optional live quick-tunnel check is not part of the offline smoke test; run
`pnpm docker:stack:up:quick` on a machine with internet access when a live
Cloudflare round trip is needed.

## Logs

```powershell
docker logs -f <container-name>
```

The API and web healthchecks use Node `fetch`. The edge healthcheck uses the
`curl` binary bundled in the Caddy image, and the cloudflared healthcheck uses
its own `cloudflared tunnel ready` command.

### Caddy access logs

Caddy logs one compact JSON line per external request to stdout, with only:
timestamp, level, message, method, host, path-only `uri` (no query string),
protocol, status, duration, size, remote IP, and client IP. The `logger` field
is added by Caddy's logging core and cannot be filtered. All request and
response headers are dropped, so User-Agent, Cloudflare headers, Cookie,
Set-Cookie, Referer, and Authorization never appear. Caddy's own loopback
healthcheck requests are skipped with `log_skip`.

Caddy error logs (logger name starts with `http.log.error`, for example
`http.log.error.log0`) used to include the full request, including headers. The
global `log default` block in `deploy/Caddyfile` now drops request
headers, bodies, remote port, protocol, TLS details, response headers,
`bytes_read`, `user_id`, `err_id`, and `err_trace`, and strips the query string
from `request.uri`. An upstream error therefore keeps only timestamp, level,
logger, message/error text, method, host, path-only URI, status, duration,
remote IP, and client IP. Caddy's logging core adds `logger` and it cannot be
filtered.

Visitor IPs are personal data. Retention is the Docker `json-file` log rotation
configured on the services (`3` files of `10` MB each). The privacy policy must
mention that IP addresses are logged for security and rate limiting and are
retained on that rotation.

## Known small items

- `/favicon.ico` currently returns 404 because the project has no favicon yet.
- A quick tunnel URL cannot be used for a manual admin login test because
  `NEXT_PUBLIC_SITE_URL` is baked into the web image at build time. Rebuild web
  with the quick URL, or use a named tunnel with a stable public origin.

## Remove the images

```powershell
docker image rm zayn-api:local zayn-web:local
```

Remove the smoke-test images only if you no longer need local builds. Named
media volumes created for real deployments are separate and are not removed by
this command.
