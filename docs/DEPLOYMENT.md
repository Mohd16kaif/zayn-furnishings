# Deployment guide (staging and production)

This guide covers the staging stack and the later production stack:

- API: Render web service (Node runtime); `render.yaml` deploys staging only,
  and `docs/render.production.example.yaml` holds the production reference for later
- Web: Vercel project, root directory `apps/web`, built from `apps/web/vercel.json`
- Database: plain PostgreSQL addressed by `DATABASE_URL`
- Admin auth: the application's own email-code login and database-backed sessions
- Media: local files served by the API from `/media`
- Payments: Stripe
- Email: Resend
- SMS verification: Twilio

> **Legacy hosting note.** The Render and Vercel hosting sections below describe
> the layout that existed during the Supabase era. Supabase is fully removed
> from the application now. Those hosting sections will be rewritten for the
> Docker-on-a-VPS target in phases 8-12 of
> [docs/SUPABASE_REMOVAL_PLAN.md](SUPABASE_REMOVAL_PLAN.md). Do not treat them
> as the final deployment instructions.

Nothing is deployed yet. Replace every `<...>` placeholder with the real value
for your accounts. Never put a real secret in a tracked file; use the Render and
Vercel dashboards.

## 0. The two stacks

| | Staging | Production |
| --- | --- | --- |
| API service | `zayn-api-staging` on Render (from `render.yaml`) | `zayn-api-production` (reference only in `docs/render.production.example.yaml`; not created yet) |
| API branch | `main` | `production` |
| Web project | `zayn-web-staging` on Vercel | `zayn-web-production` on Vercel |
| Web branch | `main` | `production` |
| API URL | `<staging-api>` (example: `https://zayn-api-staging.onrender.com`) | `<production-api>` (example: `https://api.example.com`) |
| Web URL | `<staging-web>` (example: `https://zayn-staging.vercel.app`) | `<production-web>` (example: `https://www.example.com`) |
| Database | staging PostgreSQL database | production PostgreSQL database |
| Stripe mode | test mode | live mode |
| Store default | open (staging) | open only after the owner opens it |

Use separate staging and production databases. Do not point staging at the
production database, even for a quick test.

The real Render URL is shown in the Render Dashboard after each service is
created. The real Vercel URL is shown after the first deployment.

## 1. Render API environment variables

All of these are declared in `render.yaml` for staging and in
`docs/render.production.example.yaml` for the production reference. Values
marked `sync: false` are prompted for during the Blueprint sync and are not
stored in Git.

| Variable | What it is | Where to get it | Staging value | Production value |
| --- | --- | --- | --- | --- |
| `APP_ENV` | App mode used by shared code (`development`, `staging`, `production`) | Set in `render.yaml` (staging) or the production example | `staging` | `production` |
| `NODE_ENV` | Node runtime mode; turns on the production config checks | Set in `render.yaml` (staging) or the production example | `production` | `production` |
| `NODE_VERSION` | Node version Render installs | Set in `render.yaml` (staging) or the production example; Render supports this variable | `24.15.0` | `24.15.0` |
| `PORT` | HTTP port | Render provides it automatically | Do not set | Do not set |
| `DATABASE_URL` | Plain PostgreSQL connection string | Your database provider | Staging database | Production database |
| `MEDIA_DIR` | Absolute media directory inside the API runtime | Choose a persistent path | Required | Required |
| `MEDIA_PUBLIC_BASE_URL` | Public API origin used for `/media` image URLs; no path or trailing slash | The API's public origin | `<staging-api>` | `<production-api>` |
| `ADMIN_AUTH_SECRET` | Secret used to hash admin email login codes; at least 32 characters | Generate a random value (below) | Required in staging; use a different value from production | Required in production; use a different value from staging |
| `OWNER_EMAIL` | Owner/admin email used by the app | Your own records | Test inbox you control | The real owner inbox |
| `WEB_ORIGIN` | Exact web origin allowed by CORS; no trailing slash | The Vercel project URL or custom domain | `<staging-web>` | `<production-web>` |
| `STOREFRONT_API_KEY` | Random shared secret between the web server and API | Generate a random value (below) | One random value; same value in Vercel staging | A different random value; same value in Vercel production |
| `RESEND_API_KEY` | Resend API key for order/sign-in emails | Resend -> API Keys | Staging/test key | Production key for the verified domain |
| `EMAIL_FROM` | Sender shown on transactional email | Resend verified sender | A test sender you control | `Zayn Furnishings <orders@example.com>` on the verified domain |
| `STRIPE_SECRET_KEY` | Stripe secret API key | Stripe -> Developers -> API keys | `sk_test_...` test key | `sk_live_...` live key (or a live restricted key) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for that environment's webhook endpoint | Stripe -> Developers -> Webhooks -> endpoint -> signing secret | Staging endpoint's `whsec_...` | Production endpoint's `whsec_...` |
| `TWILIO_ACCOUNT_SID` | Twilio account SID | Twilio Console | Optional on staging | Required for production phone sign-in |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | Twilio Console | Optional on staging | Required for production phone sign-in |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify service SID | Twilio Console -> Verify | Optional on staging | Required for production phone sign-in |

Notes:

- The API refuses to start outside `APP_ENV=production` if
  `STRIPE_SECRET_KEY` starts with `sk_live_`, `rk_live_`, or is otherwise a live
  key. Staging must use a test key.
- With `NODE_ENV=production`, the API requires `DATABASE_URL`,
  `MEDIA_DIR`, `MEDIA_PUBLIC_BASE_URL`, `STRIPE_SECRET_KEY`, and
  `STRIPE_WEBHOOK_SECRET` even on staging. Set real values.
- `ADMIN_AUTH_SECRET` is required whenever `APP_ENV` is `staging` or
  `production`. Use a random value of at least 32 characters, and never reuse
  the staging value in production. Development falls back to a built-in
  dev-only secret with a startup warning.
- Staging phone sign-in falls back to the development stub while `APP_ENV` is
  `staging`: the code `123456` is accepted when Twilio is not configured. This
  is useful for testing, but it means staging must never be used by real
  customers. The API's `dev_mode` hint is hidden when `NODE_ENV=production`,
  but the stub code still works.
- Missing Resend settings do not stop the API. It logs a warning and writes
  emails to the log instead of sending them.
- Admin sign-in uses the API's own email-code and session tables. No external
  auth service key is required.

Generate a storefront key without adding any dependency:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run that twice: once for staging and once for production. Within one
environment, use the same value on Render (API) and Vercel (web).

## 2. Vercel web environment variables

Set these in each Vercel project (Settings -> Environment Variables). The
staging and production projects use different values.

| Variable | What it is | Where to get it | Staging value | Production value |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_ENV` | Web app mode; controls the STAGING banner and noindex | Set in Vercel | `staging` | `production` |
| `NEXT_PUBLIC_API_URL` | API base URL used by the browser and server code | Render service URL | `<staging-api>` | `<production-api>` |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | Public origin that serves `/media` images through `next/image`; no path or trailing slash | The API's public origin; must equal the API's `MEDIA_PUBLIC_BASE_URL` | `<staging-api>` | `<production-api>` |
| `NEXT_PUBLIC_SITE_URL` | Public web origin used for canonical links, the sitemap, and the admin same-origin check | Your domain | `<staging-web>` | `<production-web>` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe public key used by checkout | Stripe -> Developers -> API keys | `pk_test_...` | `pk_live_...` |
| `STOREFRONT_API_KEY` | Server-only shared secret sent to the API | Same value as the API's `STOREFRONT_API_KEY` | Same as Render staging | Same as Render production |
| `APPLE_PAY_DOMAIN_ASSOCIATION` | Server-only contents of the Apple Pay domain association file | Stripe -> Apple Pay domain registration (exact wording may vary) | Usually empty (route returns 404); set only if you test Apple Pay on staging | Exact file contents from Stripe |

Notes:

- `STOREFRONT_API_KEY` must not be prefixed with `NEXT_PUBLIC_`. The browser
  must never see it.
- `APPLE_PAY_DOMAIN_ASSOCIATION` must not be prefixed with `NEXT_PUBLIC_`.
- `NEXT_PUBLIC_MEDIA_BASE_URL` is read at build time and inlined into the
  `next/image` allow-list. Set it to the exact same origin (scheme, hostname,
  and port) as the API's `MEDIA_PUBLIC_BASE_URL`. It must not include a path.
- After changing any Vercel environment variable, redeploy the project.
- In the Vercel project settings, set the Root Directory to `apps/web`.
  "Include source files outside of the Root Directory in the Build Step" is on
  by default for new projects; keep it on so `packages/shared` is available.
- Do not set a functions region. Leave the default region as-is (`iad1`).
- Do not add rewrites for `/admin` or `/api`. The existing Next route handlers
  and admin pages must keep their paths.
- `NEXT_PUBLIC_SITE_URL` must equal the public origin that users and admins
  visit. Behind a tunnel or reverse proxy, use the public origin, not the
  internal container URL. The admin BFF compares the `Origin` and
  `Sec-Fetch-Site` headers with this origin and rejects same-site mutations
  when it does not match.

## 3. Stripe setup

### 3.1 Keys

- Staging uses Stripe test mode keys (`sk_test_...`, `pk_test_...`).
- Production uses live mode keys (`sk_live_...`, `pk_live_...`). A live
  restricted key works only if it can create payment intents and refunds.

### 3.2 Webhook endpoint

Create one webhook endpoint per environment in the Stripe Dashboard:

| Environment | Endpoint URL | Events |
| --- | --- | --- |
| Staging | `<staging-api>/webhooks/stripe` | `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded` |
| Production | `<production-api>/webhooks/stripe` | `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded` |

Copy each endpoint's signing secret (`whsec_...`) into that environment's
Render `STRIPE_WEBHOOK_SECRET`. The two environments must not share a signing
secret.

The API reads the raw request body for signature verification, so the endpoint
must stay at `<api>/webhooks/stripe` with no proxy that rewrites the body.

### 3.3 Apple Pay domain file

The web app serves this path:

```text
/.well-known/apple-developer-merchantid-domain-association
```

The route is outside the `(store)` route group and outside the store-closed
screen, so it works while the shop shows "Coming soon". It returns
`text/plain` with status 200 when `APPLE_PAY_DOMAIN_ASSOCIATION` is set, and a
plain 404 when it is empty.

Steps in the Stripe Dashboard (labels may vary slightly):

1. Open the Apple Pay domain settings for the account.
2. Add the production web domain.
3. Download or copy the domain association file contents.
4. In Vercel, set `APPLE_PAY_DOMAIN_ASSOCIATION` to that exact content for the
   production project.
5. Redeploy, then check the file:

```powershell
curl.exe -i https://<production-web>/.well-known/apple-developer-merchantid-domain-association
```

The response should be 200, `content-type: text/plain`, and no redirect. If the
variable is empty, the expected response is 404.

## 4. Database, admin auth, and media

- Set `DATABASE_URL` to a plain PostgreSQL database. No external database or
  auth provider is required.
- Admin sign-in uses the API's own email-code endpoint and the
  `admin_login_codes` / `admin_sessions` tables. Set `ADMIN_AUTH_SECRET` and
  `OWNER_EMAIL`; bootstrap the first owner with
  `pnpm --filter @zayn/api admin:create-owner`.
- Uploaded images are written under `MEDIA_DIR` and served from the API at
  `/media`. Set `MEDIA_PUBLIC_BASE_URL` on the API and
  `NEXT_PUBLIC_MEDIA_BASE_URL` on the web project to the same public origin.
- The full database, media-volume, reverse-proxy, and backup deployment
  procedure will be written in phases 8-12.

## 5. Deploy the API on Render (staging first)

`render.yaml` defines only the staging API service. The production service is
reference-only until you add it later.

1. Commit and push this repository to GitHub.
2. In Render, choose New -> Blueprint, select this repository, and apply
   `render.yaml`. This creates only `zayn-api-staging` on branch `main`.
3. Enter the `sync: false` values for the staging service when prompted.
4. Wait for the deploy. The health check is `GET /health`. A response with
   `"status": "ok"` and `"db": true` means the API and database are connected.
5. Keep production off until staging has been checked and signed off.

Later, when the client's production account is ready:

1. Create the `production` branch:

```powershell
git switch main
git pull
git switch -c production
git push -u origin production
git switch main
```

2. Copy the production service definition from
   `docs/render.production.example.yaml` into the `services:` list in
   `render.yaml`, or create the service by hand with the same settings. That
   example file is reference only and is not read by Render.
3. Apply the Blueprint again and enter the production values for
   `zayn-api-production`.
4. Keep the environment variable names, build command, and start command
   consistent with the example file.

Important:

- The region is `ohio` for the staging service and the production example. A
  Render service's region cannot be changed after creation.
- The build command installs with the frozen lockfile and includes dev
  dependencies (`--prod=false`), because the TypeScript compiler and build
  tools are dev dependencies.
- The start command runs the compiled API from `apps/api/dist`.
- Do not run migrations automatically in the build or start command. Follow
  the migration policy below.

## 6. Deploy the web app on Vercel

Create two Vercel projects from the same repository:

1. `zayn-web-staging`: production branch `main`.
2. `zayn-web-production`: production branch `production`.

For each project:

1. Set Root Directory to `apps/web`.
2. Keep the framework preset as Next.js.
3. Keep "Include source files outside of the Root Directory in the Build Step"
   enabled.
4. Let `apps/web/vercel.json` supply the install and build commands. The build
   command builds `@zayn/shared` before the web app.
5. Add the environment variables from section 2.
6. Deploy and set the custom domain (or use the Vercel URL for staging).

Branch behavior: a push to `main` produces a staging deployment. A push to
`production` produces a production deployment. Preview deployments (pull
requests) use the Preview environment variables, so keep those in sync if you
use previews.

## 7. Branch strategy

- `main` is the integration branch. It deploys the staging API and staging web
  project automatically.
- `production` is the release branch. Once the production services are set up,
  it deploys the production API and production web project.
- Merge `main` into `production` only after staging has been checked.
- Do not commit directly to `production` except for an emergency fix that is
  also merged back into `main`.

## 8. Database migrations

The owner may be entering real data, so migrations are **additive only**:

- Add columns and tables.
- Do not rename or drop columns or tables.
- Do not change a column's type in a way that can lose data.

Routine:

1. Generate and review the migration locally (`pnpm db:generate`).
2. Take a database backup of the production database before every production
   migration.
3. Apply the migration to staging first: `pnpm db:migrate` with staging
   `DATABASE_URL`.
4. Check the staging app.
5. Apply the same migration to production with production `DATABASE_URL`.
6. Keep the backup until the production check passes.

`pnpm db:migrate` uses Drizzle Kit from `apps/api`. Run it from a trusted
machine or a Render shell with the target `DATABASE_URL` set. Never run it
against production while pointing at staging values, and never wrap it in the
build command.

## 9. Release and rollback

Release:

1. Check staging: health, storefront, admin login, test checkout, webhook.
2. Merge `main` into `production`.
3. Confirm both production services deployed the new commit.
4. Run the post-deploy checklist.
5. Open the store only when the owner is ready.

Rollback:

- Vercel: Project -> Deployments -> choose the last good deployment ->
  Promote to Production (or Redeploy).
- Render: Service -> Deploys -> choose the last successful deploy ->
  Redeploy.
- Database changes are **not** rolled back automatically. Additive changes can
  usually stay in place while the previous app version runs. If a migration
  caused the problem, restore the database backup taken before the migration.

## 10. Post-deploy checklist

Run this on staging first, then on production where applicable.

- [ ] `GET <api>/health` returns 200 with `"status": "ok"`.
- [ ] `"db": true` in the health response (database connected).
- [ ] The storefront loads and product images appear.
- [ ] `/admin/login` loads; the owner can request a code and sign in.
- [ ] On staging, complete a checkout with the Stripe test card
      `4242 4242 4242 4242`, any future expiry, any CVC.
- [ ] The Stripe Dashboard webhook delivery shows HTTP 200 for
      `payment_intent.succeeded`.
- [ ] Refunding the test payment produces a `charge.refunded` delivery with
      HTTP 200.
- [ ] The staging site shows the yellow "STAGING: test site, no real orders"
      banner.
- [ ] Staging `robots.txt` disallows everything (`Disallow: /`).
- [ ] The admin "Coming soon" / store-open switch works: close the store and
      confirm the storefront shows the Coming soon screen; reopen it and
      confirm the shop returns.
- [ ] Apple Pay domain file returns 200 `text/plain` on production and 404 when
      the variable is intentionally empty on staging.

## 11. Verify before use

These items were not fully confirmed offline. Check them in the current
dashboards before the first real deploy.

Render:

- Render's Node runtime installs pnpm automatically based on the lockfile and
  `packageManager` field. The exact pnpm/corepack behavior was not tested
  against Render here. If the build fails because pnpm is missing or the wrong
  version, enable Corepack or pin pnpm in the build command.
- The exact service URLs and plan limits are only known after creation.
- `NODE_VERSION=24.15.0` is a supported mechanism, but the exact patch release
  being available in Render's image was not tested.

Vercel:

- The Root Directory, "Include source files outside of the Root Directory",
  and Production Branch settings are dashboard settings. Their labels and
  locations can change; confirm them in the current project settings.
- The project's Node.js version was not pinned in `vercel.json`. Next.js 16
  needs a current Node 20+ runtime. If the build complains about Node, set the
  project's Node.js version in Settings.
- The `apps/web/vercel.json` fields `framework`, `installCommand`, and
  `buildCommand` follow the current Vercel configuration reference, but this
  file has not been run on Vercel yet.
- The default functions region is left unchanged (`iad1`); do not add a
  `regions` entry unless you intentionally move functions.

Other:

- The Apple Pay route was verified in the local Next dev server for both the
  set and empty cases. Re-check it after the first Vercel deployment because
  Vercel's edge/CDN behavior can differ from local development.
- Stripe Dashboard labels for Apple Pay domain registration and webhook event
  selection may change; confirm the current wording.
- Twilio trial restrictions and production SMS deliverability were not tested.
- Local media serving was verified in the local Next dev server; re-check it
  behind the final reverse proxy when the Docker/VPS hosting sections are
  written in phases 8-12.
