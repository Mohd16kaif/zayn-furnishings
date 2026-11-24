# Supabase Removal Audit and Phased Plan

Status: Phase 0, read-only audit. This document changes no runtime code, no
migrations, and no dependencies. It records the current Supabase usage and the
design for a self-hosted stack: Postgres in Docker on one VPS, Docker images for
the API and web app, and Cloudflare Tunnel in front.

Repository state at audit time:

- Branch: `main`
- Commit: `70bb5f3 Make render.yaml staging-only and use autoDeployTrigger`
- Package manager: pnpm `12.4.2`
- Node: `24.15.0`

## 1. Summary

Supabase is used for exactly two runtime features:

1. Admin authentication (Supabase Auth email one-time codes).
2. Product, category, and content image storage (Supabase Storage bucket
   `product-images`).

The application database is already plain PostgreSQL accessed through Drizzle
ORM and the `postgres` driver. It currently points at Supabase Postgres, but no
application code uses the Supabase database client, PostgREST, Realtime, or
Supabase row-level-security policies. Customer authentication is already
custom: phone verification plus hashed database sessions and an HttpOnly
cookie. Admin auth can follow that existing pattern.

Tracked files with direct Supabase references, excluding `pnpm-lock.yaml` and
generated Drizzle metadata snapshots:

| Area | Files | Notes |
| --- | ---: | --- |
| API | 7 | Two clients, storage upload/delete, admin token verification, OTP request, env, package, example env |
| Web | 11 | Browser/server Supabase clients, login, admin shell, admin API, preview, revalidation, proxy, Next image config, package, example env |
| Database migrations | 5 | `0000`, `0001`, `0002`, `0004`, `0007`; 3 fail on a vanilla PostgreSQL 16 cluster |
| Config and docs | 4 | `render.yaml`, `docs/render.production.example.yaml`, `docs/DEPLOYMENT.md`, `README.md` |
| Lockfile | 1 | `pnpm-lock.yaml` contains the transitive dependency graph |
| Tests | 0 | No test mocks Supabase directly; 4 tests mock `requireAdmin` |

Database migrations `0002`, `0004`, and `0007` fail on plain PostgreSQL 16
because they revoke privileges from the Supabase-only roles `anon` and
`authenticated`. The tables themselves do not use the `auth` schema and there
is no foreign key to `auth.users`.

## 2. Part 1 - Audit

### 2.1 API Supabase dependencies

| File | Supabase usage | Purpose | Replacement direction |
| --- | --- | --- | --- |
| `apps/api/src/lib/supabase.ts` | `createClient` with service-role and anon keys; cached clients | Creates the admin Storage/Auth client and the anon Auth client | Delete. Add a local media adapter and an admin session verifier |
| `apps/api/src/config/env.ts` | Declares `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`; requires the service role in production | Runtime configuration and production boot validation | Remove Supabase variables. Add `MEDIA_ROOT`, optional `MEDIA_PUBLIC_BASE_URL`, `AUTH_SECRET`/OTP pepper, and admin session settings |
| `apps/api/src/middleware/requireAdmin.ts` | `getSupabaseAdmin().auth.getUser(token)`; requires `email_confirmed_at`; matches `admin_users` by lowercased email; binds `auth_user_id` on first login; writes `audit_log` | Authenticates every `/admin` request | Look up SHA-256 hash of the bearer token in `admin_sessions`, join `admin_users`, require `is_active`, check expiry, optionally touch `last_seen_at` |
| `apps/api/src/routes/adminAuth.ts` | `getSupabaseAnon().auth.signInWithOtp({ shouldCreateUser: true })` after an active-admin lookup; generic 200 response; `GET /admin/me` | Sends admin sign-in codes and returns the current admin | Keep `POST /admin/auth/otp/request` and `GET /admin/me`. Add `POST /admin/auth/otp/verify` and `POST /admin/auth/logout`. Generate and store codes locally and send them through the existing email sender |
| `apps/api/src/lib/imagePipeline.ts` | `storage.from("product-images")`, `upload`, `remove`, `getPublicUrl` | Validates and processes images with multer/sharp, then uploads/deletes Storage objects | Keep `detectImageType`, `processImage`, multer limits, and rate limiter. Replace Storage calls with filesystem writes/deletes and a URL builder |
| `apps/api/package.json` | Dependency `@supabase/supabase-js` | API runtime dependency | Remove after the last import is deleted |
| `apps/api/.env.example` | Supabase URL/keys and Supabase pooler connection instructions | Local setup documentation | Remove Supabase entries; document plain Postgres and media settings |

Indirect consumers of the Storage pipeline (no direct Supabase import, but they
break if the adapter is not replaced):

| File | Calls | Behavior to preserve |
| --- | --- | --- |
| `apps/api/src/routes/adminProducts.ts` | `uploadImageObject`, `deleteImageObjects` | Product image upload, image row deletion, product deletion cleanup |
| `apps/api/src/routes/adminCategories.ts` | `uploadImageObject`, `deleteImageObjects` | Category image upload/replacement/removal and category deletion cleanup |
| `apps/api/src/routes/adminContent.ts` | `uploadImageObject`, `deleteImageObjects` | Content block image upload/replacement/removal and deletion cleanup |
| `apps/api/src/lib/adminCatalog.ts` | Serializes `storage_path` and image URLs | Keep the API response shape unchanged |
| `apps/api/src/lib/productImages.ts` | Reads `product_images.url` | Keep the public/primary image behavior unchanged |

Scripts and tests reviewed:

| File | Supabase dependency | Notes |
| --- | --- | --- |
| `apps/api/src/scripts/createOwner.ts` | None | Inserts an active `admin_users` row from `OWNER_EMAIL`; this is already the owner bootstrap and should be kept |
| `apps/api/src/scripts/verifyImages.ts` | None | Exercises `detectImageType` and `processImage` only |
| `apps/api/src/scripts/seedCategories.ts` | None | Category seed used by the cutover |
| `apps/api/src/scripts/auditTestData.ts` | None | Read-only data audit |
| `apps/api/tests/*` | None directly | `adminDashboardRoute.test.ts`, `adminDeliveryRoute.test.ts`, `adminMessagesRoute.test.ts`, and `adminRefundRoute.test.ts` mock `requireAdmin`; no test covers image upload or admin OTP |

The owner bootstrap does not call Supabase. Running
`pnpm --filter @zayn/api admin:create-owner` with `OWNER_EMAIL` is sufficient to
create the first admin row. First login currently binds `auth_user_id`; that
binding must be removed with Supabase Auth.

### 2.2 Web Supabase dependencies

| File | Supabase usage | Purpose | Replacement direction |
| --- | --- | --- | --- |
| `apps/web/src/lib/supabase/client.ts` | `createBrowserClient` from `@supabase/ssr` using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-side Supabase client | Delete. Use same-origin calls to Next route handlers backed by an HttpOnly cookie |
| `apps/web/src/lib/supabase/server.ts` | `createServerClient` with Next `cookies()` | Server-side session reads | Delete. Replace with a server helper that reads the admin cookie and calls the API |
| `apps/web/src/app/admin/login/login-form.tsx` | Requests a code from `POST /admin/auth/otp/request`, then calls `supabase.auth.verifyOtp` in the browser | Admin email OTP flow | Verify through a server-side Next route handler; that handler sets an HttpOnly cookie and never exposes the session token to JavaScript |
| `apps/web/src/app/admin/admin-shell.tsx` | `supabase.auth.getSession()`, sends `Bearer session.access_token` to `/admin/me`, `supabase.auth.signOut()` | Admin shell guard and logout | Read admin identity through the same-origin BFF; logout calls the API and clears the cookie |
| `apps/web/src/lib/adminApi.ts` | `getSession()` before every request, `Bearer access_token`, `signOut()` on 401, XHR upload with the access token | All admin API calls and uploads | Change to same-origin `/api/admin/...` calls; the BFF attaches the bearer token from the HttpOnly cookie |
| `apps/web/src/lib/adminPreview.ts` | Server-side `createSupabaseServerClient()` then `getSession()` | Allows admins to preview the storefront while the store is closed | Check the admin cookie and call `GET /admin/me` server-side |
| `apps/web/src/lib/actions/revalidateStorefront.ts` | Server-side Supabase `getUser()` before revalidating tags | Authorization for the cache revalidation action | Verify the admin cookie via the API before revalidating; fail closed |
| `apps/web/src/proxy.ts` | Creates a Supabase server client, calls `getSession()`, redirects unauthenticated `/admin` requests, refreshes Supabase cookies | Admin route gate | Redirect when the admin cookie is absent. The API remains the real authorization boundary for every admin call |
| `apps/web/next.config.ts` | Builds `images.remotePatterns` from `NEXT_PUBLIC_SUPABASE_URL` for `/storage/v1/object/public/product-images/**` | Allows `next/image` to load Supabase public image URLs | Remove the Supabase pattern. Prefer origin-relative `/media/...` URLs, or add the API media host if absolute URLs are kept |
| `apps/web/package.json` | Dependencies `@supabase/ssr`, `@supabase/supabase-js` | Web runtime dependencies | Remove after the last import is deleted |
| `apps/web/.env.example` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe Supabase configuration | Remove; add any admin BFF/internal API setting if needed |

Session location today: the app code does not write admin auth to
`localStorage`. `@supabase/ssr` uses cookie storage, and `proxy.ts` plus
`lib/supabase/server.ts` read cookies. The access token is therefore in
Supabase-managed cookies that are readable by JavaScript; it is not an
HttpOnly application cookie. The exact cookie names and flags were not
inspected at runtime (marked Unverified).

Login flow today:

1. Browser posts the email to `POST /admin/auth/otp/request`.
2. The API checks `admin_users` for an active row, then asks Supabase Auth to
   send a code with `shouldCreateUser: true`.
3. Browser calls `supabase.auth.verifyOtp` directly against Supabase with the
   anon key.
4. `@supabase/ssr` stores the session cookies.
5. `proxy.ts` and `admin-shell.tsx` read the session; `adminApi.ts` sends the
   Supabase access token as a bearer token to the API.
6. Logout calls `supabase.auth.signOut()` in the browser.

### 2.3 Database migrations

| Migration | Supabase-dependent content | Result on plain PostgreSQL 16 |
| --- | --- | --- |
| `0000_initial_schema.sql` | `customers.auth_user_id uuid`, `admin_users.auth_user_id uuid NOT NULL`, both unique. No `auth` schema and no `auth.users` foreign key | Passes. The columns are plain UUIDs; they should be deprecated and later dropped |
| `0001_rls_and_updated_at.sql` | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on 18 tables plus `set_updated_at` triggers | Passes. RLS is core PostgreSQL. There are no policies, so a table owner is unaffected and any non-owner sees no rows |
| `0002_admin_auth_privileges.sql` | Drops `NOT NULL` on `admin_users.auth_user_id` (passes), then `REVOKE ALL ... FROM anon, authenticated` and `ALTER DEFAULT PRIVILEGES ... FROM anon, authenticated` | Fails: roles `anon` and `authenticated` do not exist in a vanilla PostgreSQL 16 cluster |
| `0003_loving_squadron_supreme.sql` | Adds `product_images.storage_path` | Passes; no Supabase-specific statement |
| `0004_careless_lady_bullseye.sql` | Creates `store_settings`, enables RLS (passes), then `REVOKE ALL ON store_settings FROM anon, authenticated` | Fails at the revoke: roles do not exist |
| `0005_wealthy_inertia.sql` | Adds `categories.image_storage_path` and `content_blocks.storage_path` | Passes; no Supabase-specific statement |
| `0006_*`, `0008_*`, `0009_*` | No Supabase-specific statements found | Pass |
| `0007_flaky_mister_fear.sql` | Creates customer auth tables, enables RLS (passes), then revokes from `anon, authenticated` on `customer_sessions` and `phone_verification_attempts` | Fails at the revoke: roles do not exist |

Other database facts:

- No migration creates an extension. `gen_random_uuid()` is built into
  PostgreSQL 13 and later, so PostgreSQL 16 does not need `pgcrypto`.
- No migration references `auth.users`, `storage.objects`, or the `storage`
  schema.
- The failing migrations fail only because of the missing Supabase roles. The
  RLS statements are valid PostgreSQL and can stay.
- The API currently connects with a role that owns the tables (the Supabase
  `postgres` role or pooler equivalent), so RLS is bypassed for the API. No
  policies exist to grant or restrict anything else.

### 2.4 Data columns and public image URLs

| Table | Columns | What is stored | How it is used |
| --- | --- | --- | --- |
| `product_images` | `url text NOT NULL`, `storage_path text` | `url` is the absolute Supabase public URL; `storage_path` is the object path such as `products/<productId>/<uuid>.webp` | Admin product lists, product detail images, cart snapshots, public product cards |
| `categories` | `image_url text`, `image_storage_path text` | Absolute Supabase public URL plus object path | Navigation/menu category images and admin category rows |
| `content_blocks` | `image_url text`, `storage_path text` | Absolute Supabase public URL plus object path | Home hero, promo cards, room tiles, info cards |
| `order_items` | `image_url_snapshot text` | Copy of the image URL at order time | Admin order detail and customer order history; may keep Supabase URLs after a storage move |
| `customers` | `auth_user_id uuid` | Legacy Supabase Auth link, currently unused by customer phone auth | Can be dropped after confirming no external consumer |
| `admin_users` | `auth_user_id uuid` | Supabase Auth user binding, written on first admin login | Must stop being read/written when Supabase Auth is removed |

Public URL construction today:

```text
getSupabaseAdmin()
  .storage.from("product-images")
  .getPublicUrl(path)

=> <SUPABASE_URL>/storage/v1/object/public/product-images/<path>
```

This happens in `apps/api/src/lib/imagePipeline.ts`. The API stores that
absolute URL in `product_images.url`, `categories.image_url`, or
`content_blocks.image_url`. Public routes return the stored value without
rewriting it (`apps/api/src/routes/public.ts`), and the web app renders it with
`next/image` through `SmartImage` or direct `Image` components. The seeded
homepage content uses local `/images/...` paths, not Supabase URLs.

### 2.5 Config and docs

| File | Supabase content | Action |
| --- | --- | --- |
| `render.yaml` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` env entries | Remove or replace when Render is retired |
| `docs/render.production.example.yaml` | Same three Supabase env entries | Remove or replace |
| `docs/DEPLOYMENT.md` | Supabase is listed as database and auth; Supabase project setup, env tables, database connection, backup/restore references | Rewrite for Docker, Postgres, Cloudflare Tunnel, and local media |
| `README.md` | Supabase Postgres, Supabase env vars, session pooler explanation | Rewrite for plain Postgres and local media |
| `apps/api/.env.example` | Supabase URL/keys and pooler instructions | Remove Supabase entries |
| `apps/web/.env.example` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Remove |
| `pnpm-lock.yaml` | Supabase packages and transitive auth/storage/realtime packages | Regenerate with pnpm after removing dependencies |
| `scripts/check-encoding.mjs` | No Supabase reference | Unaffected; keep using it |

No files under `scripts/` reference Supabase. `apps/web/vercel.json` has no
Supabase variables; it is deployment configuration only.

## 3. Part 2 - Replacement Design

This is design only. No code is changed in this phase.

### 3.1 Admin authentication

Use the existing Resend email sender and a database-backed one-time-code login.
This mirrors the customer phone flow: random token, SHA-256 hash in the
database, HttpOnly cookie, explicit expiry. Supabase Auth is not replaced with
another identity provider.

#### Tables

`admin_login_codes`:

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | `uuid` primary key | Row identity |
| `admin_user_id` | `uuid NOT NULL` references `admin_users(id)` on delete cascade | The admin the code was issued to |
| `code_hash` | `text NOT NULL` | HMAC-SHA256 of the six-digit code with a server-side pepper; never store the plaintext code |
| `expires_at` | `timestamptz NOT NULL` | Ten minutes after creation |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Request time |
| `consumed_at` | `timestamptz` | Set when the code is used successfully |
| `attempts` | `integer NOT NULL DEFAULT 0` | Failed verification count; invalidate at five |
| `request_ip` | `text` | Request IP for audit and rate-limit forensics |
| `user_agent` | `text` | Truncated user agent for audit |

Indexes: `(admin_user_id, created_at)` and `(expires_at)`.

`admin_sessions`:

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | `uuid` primary key | Row identity |
| `admin_user_id` | `uuid NOT NULL` references `admin_users(id)` on delete cascade | Session owner |
| `token_hash` | `text NOT NULL UNIQUE` | SHA-256 of the random session token |
| `expires_at` | `timestamptz NOT NULL` | Seven days after creation |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Login time |
| `last_seen_at` | `timestamptz NOT NULL DEFAULT now()` | Throttled activity update |
| `user_agent` | `text` | Truncated user agent |
| `ip` | `text` | Login IP |

Indexes: `(admin_user_id)` and `(expires_at)`. Consider a nullable
`revoked_at` if immediate revocation without row deletion is wanted; deleting
the row is sufficient for this app.

Link between admins and sessions: `admin_sessions.admin_user_id` is a foreign
key to `admin_users.id`. Every admin request loads the session and the admin
row together, requires `admin_users.is_active = true`, and uses
`admin_users.role` for owner-only checks. Deactivating or deleting an admin
cascades session deletion. No `auth_user_id` is involved.

`admin_users.auth_user_id` handling:

- Phase 3 stops reading and writing it.
- Keep the column temporarily so the migration is non-destructive.
- In the final cleanup phase, after grep and runtime checks confirm it is
  unused, drop the column and its unique constraint. Because the dev database
  will be recreated, this cleanup can happen immediately after cutover if
  preferred. `customers.auth_user_id` can be dropped in the same cleanup.

#### API behavior

Endpoints:

| Endpoint | Behavior |
| --- | --- |
| `POST /admin/auth/otp/request` | Normalize email; look up an active `admin_users` row; if found, invalidate previous unused codes, generate a six-digit code with `crypto.randomInt`, store only its HMAC hash with a ten-minute expiry, and send it through the existing email sender. Always return the existing generic message and HTTP 200 |
| `POST /admin/auth/otp/verify` | Normalize email; load the latest unconsumed, unexpired code for that admin; reject after five failed attempts; compare hashes in constant time; mark the code consumed; create an `admin_sessions` row; write `audit_log`; return `{ token, admin }` |
| `GET /admin/me` | Require an admin session and return `{ id, email, name, role }` |
| `POST /admin/auth/logout` | Require an admin session and delete that session row; return `{ ok: true }` |

Code handling:

- Six digits, generated with `crypto.randomInt`.
- TTL: 10 minutes.
- Single use.
- A new request invalidates older unused codes for that admin.
- Store `HMAC-SHA256(pepper, admin_user_id + ":" + code)`. The pepper comes
  from a new required production secret such as `AUTH_SECRET`. A database leak
  must not reveal live codes.
- Constant-time comparison.
- Never log the code in production. In non-production, the existing log-only
  email sender can print the message text so local testing works without
  Resend; add an explicit guard so this never happens when
  `NODE_ENV=production` or `APP_ENV=production`.
- Use the existing `getEmailSender()` / `ResendSender`. Add an admin sign-in
  email template with the code, expiry, and a "you can ignore this" line.
- Keep the existing generic response so the endpoint does not reveal whether
  an email belongs to an admin.

Rate limits (single VPS, one API instance; in-memory `express-rate-limit` is
acceptable, with database-backed attempt counters for the code itself):

| Control | Limit |
| --- | --- |
| OTP requests per IP | 5 per 15 minutes (existing limit) |
| OTP requests per email | 5 per 15 minutes (existing limit) |
| New code request cooldown | 60 seconds server-side; 30 seconds in the current UI |
| Verify attempts per IP | 10 per 15 minutes |
| Failed attempts per code | 5, then invalidate the code |
| Code lifetime | 10 minutes |
| Admin session lifetime | 7 days, with throttled `last_seen_at` refresh |
| Active sessions per admin | Optional cap (for example 10), delete oldest when exceeded |

Session handling:

- Generate 32 random bytes as a base64url token, like `customerAuth.ts`.
- Store only the SHA-256 hash in `admin_sessions.token_hash`.
- Cookie name `zf_admin_session`.
- Cookie flags: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production,
  `Max-Age` equal to the session lifetime. Consider the `__Host-` prefix in
  production.
- The cookie value is the raw token. The database stores only its hash.
- `requireAdmin` hashes the bearer token, loads the session and admin in one
  query, checks expiry and `is_active`, and attaches the admin context. It does
  not call Supabase.
- Logout deletes the session row and clears the cookie. Changing an admin's
  role or active flag takes effect on the next request.

Owner bootstrap and first login:

1. After migrations, run
   `pnpm --filter @zayn/api admin:create-owner` with `OWNER_EMAIL` set.
2. The script inserts an active `owner` row if it does not exist. This is the
   current behavior and needs no Supabase.
3. The first OTP request finds that row and sends a code. The first successful
   verify creates the first session and writes an `admin.login` audit entry.
4. Unknown or inactive emails get the same generic response and no email.
5. Do not auto-provision admins from the login endpoint. Adding staff remains
   an explicit database or script operation until an admin management UI is
   built.

#### Web session and BFF design

The browser must not hold the session token. Use the Next.js server as a small
backend-for-frontend (BFF):

| Route | Behavior |
| --- | --- |
| `POST /api/admin/auth/request-code` | Forwards the email to `POST <api>/admin/auth/otp/request` |
| `POST /api/admin/auth/verify` | Forwards email and code to `POST <api>/admin/auth/otp/verify`, receives `{ token, admin }`, sets the HttpOnly cookie, and returns only the admin object |
| `POST /api/admin/auth/logout` | Reads the cookie, calls the API logout with a bearer token, clears the cookie |
| `/api/admin/proxy/[...path]` | Reads the cookie, forwards GET/POST/PATCH/DELETE to `<api>/admin/<path>` with an `Authorization: Bearer <token>` header, and streams the response. On a 401, clears the cookie |

The admin API client changes from direct API calls with a Supabase token to
same-origin calls to `/api/admin/proxy/...`. Browser JavaScript never sees the
session token.

`proxy.ts` changes from a Supabase session check to a cookie-presence check.
A missing cookie redirects `/admin` to `/admin/login`. The API still validates
every request; a stale cookie results in a 401 from the BFF and a redirect to
the login page.

`revalidateStorefront` and `hasAdminPreviewSession` read the cookie server-side
and call `GET /admin/me` with the bearer token. `revalidateStorefront` fails
closed. The login form calls the BFF verify route instead of
`supabase.auth.verifyOtp`. Logout calls the BFF logout route.

CSRF and abuse:

- `SameSite=Lax` blocks most cross-site state-changing requests.
- The BFF should also reject mutations whose `Origin` header does not match the
  configured web origin, and should require JSON content type for JSON bodies.
- Keep the existing per-admin upload rate limiter.
- Consider a Cloudflare WAF rule or rate limit on `/admin` and
  `/api/admin/auth/*`.
- XSS still defeats HttpOnly cookies for actions performed in the page; keep
  the existing output escaping and avoid injecting untrusted HTML.

### 3.2 Image storage

Store files on a Docker volume (or host bind mount) on the VPS and serve them
through the API at `/media/...`. Keep the existing validation and processing
pipeline; only the storage backend changes.

Configuration:

| Variable | Purpose |
| --- | --- |
| `MEDIA_ROOT` | Absolute path inside the API container, for example `/data/media` |
| `MEDIA_PUBLIC_BASE_URL` | Optional absolute prefix. Leave empty to store origin-relative `/media/<path>` URLs, which is recommended |
| `MEDIA_MAX_BYTES` | Optional override; default stays 8 MB |

Directory layout (same path scheme as the current Supabase object keys):

```text
$MEDIA_ROOT/
  products/<productId>/<uuid>.webp
  categories/<categoryId>/<uuid>.webp
  content/<contentBlockId>/<uuid>.webp
```

Naming and validation:

- Keep the random UUID filename and the folder/owner-id layout.
- Validate `folder` against an allowlist (`products`, `categories`, `content`),
  `ownerId` as a UUID, and the filename as `<uuid>.webp`.
- Keep the 8 MB multer limit, file-count limits, magic-byte detection for
  JPEG/PNG/WebP, and the `sharp` WebP re-encode. Never trust the original
  filename or MIME header.
- Write to a temporary file in the target directory and rename into place so a
  crash cannot leave a partial object with a valid name.
- Create directories with restrictive permissions and run the API container as
  a non-root user. The host media directory must be writable by that user only.
- Consider `sharp({ limitInputPixels })` to reject decompression bombs. Keep
  the existing rate limiter and max image count per product.
- Never allow `..`, absolute paths, backslashes, or symlinks to escape
  `MEDIA_ROOT`.

Serving:

- Add a read-only `GET /media/...` route on the API (or mount static file
  serving with an explicit path resolver).
- Only `GET` and `HEAD`; no directory listing.
- Resolve the real path and require it to stay under `MEDIA_ROOT`; reject
  symlinks.
- Set `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000,
  immutable`, and `X-Content-Type-Options: nosniff`.
- Return 404 for missing files. Do not reveal filesystem paths.

URL strategy:

- Recommended: store origin-relative URLs such as
  `/media/products/<id>/<uuid>.webp`. The web app and the API are exposed under
  one public origin through Cloudflare/Caddy, so `next/image` can use the URL
  without `remotePatterns`. A Next rewrite or reverse-proxy path rule sends
  `/media/*` to the API.
- Alternative: store absolute URLs built from `MEDIA_PUBLIC_BASE_URL` (for
  example `https://api.example.com/media/...`). This decouples the web app but
  requires an `images.remotePatterns` entry and makes future domain changes a
  data migration.
- Because the dev data is disposable, either option starts clean. The relative
  option is the least coupled.
- Existing Supabase URLs in old rows will stop working when the Supabase
  project is deleted. Do not migrate them for dev; recreate the database and
  re-upload images.

Delete and cleanup:

- `deleteImageObjects(paths)` resolves each path under `MEDIA_ROOT` and
  unlinks it. Missing files are ignored; other errors are logged without
  failing an already-committed database transaction.
- Keep the current DB-first deletion order: remove the row in a transaction,
  then delete the object. A failed object delete leaves an orphan file, not a
  broken row.
- Add a read-only media audit script that compares `storage_path` values in
  `product_images`, `categories`, and `content_blocks` with files on disk.
  Support a later `--delete` flag for confirmed orphans.
- Extend the same audit to detect files not referenced by any row and row paths
  with no file.

Backups:

- The media directory is part of the application data and must be backed up
  with the database. A database-only backup will restore rows pointing at
  missing images.
- Use the same off-server backup job for `pg_dump` and the media directory, or
  separate restic snapshots with the same schedule and retention.

### 3.3 Database

Connection:

- Docker service `db` runs `postgres:16` (or `postgres:16-alpine`) with a named
  volume for the data directory.
- The API uses an internal connection string such as
  `postgres://zayn:<password>@db:5432/zayn`. No pooler is needed on a single
  VPS.
- Keep `max` small and predictable (for example 10). The current
  `prepare: false` exists for the Supabase pooler; plain PostgreSQL can keep it
  or switch to prepared statements. Changing it is not required for
  correctness.
- Do not publish the database port on the public interface in production. For
  local development it can be published on `127.0.0.1:5432`.
- Use a strong password from a root-owned env file or Docker secret. Do not
  commit it.

Migrations in Docker:

- Build one migration runner from the API image. A one-shot compose service
  runs `pnpm --filter @zayn/api db:migrate` after `db` is healthy.
- Deploy sequence: `docker compose run --rm migrate`, then
  `docker compose up -d api web`.
- Do not run migrations automatically on every API start. That is safe with one
  replica but becomes unsafe if the API is ever scaled.
- Take a database backup before a migration that changes existing data. Take a
  fresh-database migration test in CI first.
- `drizzle-kit migrate` reads the existing Drizzle journal. Keep the generated
  metadata in the image.

Making migrations work on plain PostgreSQL 16:

Recommended minimal-change option: create the Supabase role names as inert
roles before migrations run. A small bootstrap step (run by the migration
runner as a superuser, before `drizzle-kit migrate`) executes an idempotent
block equivalent to:

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;
```

Then `0002`, `0004`, and `0007` run unchanged. The roles cannot log in and have
no privileges, so they are harmless. This keeps the existing migration history
valid for any environment where it was already applied.

Alternative: edit `0002`, `0004`, and `0007` to remove the revoke/default
privilege statements, or wrap them in a conditional block. This is cleaner for
a brand-new baseline but changes already-applied SQL. Because the dev database
will be recreated, this is acceptable here if the team prefers a clean
migration set. Do not mix both approaches. If the project later squashes to a
single baseline migration, remove the Supabase role statements then.

Tradeoff and recommendation: use the inert-role bootstrap now to unblock plain
PostgreSQL with the smallest diff; remove the role references during the final
baseline cleanup if desired.

RLS decision:

- Keeping RLS enabled is harmless when the API connects as the table owner.
  PostgreSQL bypasses RLS for the table owner unless `FORCE ROW LEVEL
  SECURITY` is set.
- With no policies, any non-owner role gets zero rows instead of an error.
  That is a useful safety net against accidental grants to an `anon` or
  `authenticated` role, but it can be confusing if the application role ever
  changes.
- Recommendation: keep RLS enabled, keep the app role as the table owner, do
  not create login-capable `anon`/`authenticated` roles, and document that
  there are no policies because only the owning API role may access these
  tables.
- Alternative: drop the RLS statements for simplicity and rely on network
  isolation plus a single database role. This reduces schema noise but removes
  a defense-in-depth layer. Either choice is defensible for a single-VPS
  deployment; keep one choice consistent across environments.

Backup plan:

- Nightly logical backup: `pg_dump -Fc` of the application database, run from
  the host (not from the API container) using `docker compose exec -T db`.
  Write to a directory outside the Postgres data volume.
- Retention: 7 daily, 4 weekly, 6 monthly.
- Off-server copy: push encrypted backups to object storage or another host
  (for example restic to Backblaze B2/S3, or rclone with client-side
  encryption). Use a separate credential from the VPS root account.
- Media: back up `MEDIA_ROOT` on the same schedule. Database and media
  snapshots should be close in time.
- Restore test: at least monthly, restore the latest dump into a throwaway
  `postgres:16` container, run `pg_restore --clean --if-exists`, and compare
  row counts for key tables (`products`, `orders`, `order_items`,
  `admin_users`, `store_settings`). Restore a sample of media files and check
  that a public `/media/...` URL works.
- Record restore time and failures. Alert on a failed dump, a missing offsite
  copy, or a failed restore test.
- Keep one offline copy or a copy in a different provider to survive account
  compromise.

### 3.4 Cutover for the existing dev database

The dev database is disposable and there is nothing real to migrate.

1. Stop the local API and web dev servers. Confirm no Node processes are
   listening on the dev ports.
2. Start plain PostgreSQL 16 (Docker or a local service).
3. Point `DATABASE_URL` at the new database and remove `SUPABASE_*` values from
   the local API environment.
4. Drop and recreate the local database, then run the role bootstrap and
   `pnpm db:migrate` from an empty database.
5. Run `pnpm --filter @zayn/api db:seed-categories`. Optionally run
   `pnpm --filter @zayn/api db:seed` for sample products and content.
6. Run `pnpm --filter @zayn/api admin:create-owner` with `OWNER_EMAIL` set.
7. Start the API and web app. Request an admin code. In development without
   Resend, read the code from the guarded log-only email output; with Resend,
   read the real inbox.
8. Verify login, admin pages, product image upload, public storefront images,
   and logout.
9. Do not copy old Supabase rows. Old Supabase image URLs are dead after the
   project is deleted. Re-upload images through the new admin flow.
10. Keep the old Supabase project read-only for a short observation window if
    desired, then delete it. Do not leave credentials in any tracked file.

If a future environment has real data, use a separate export/import task with
a downtime window and explicit image download/rewrite. That is out of scope for
this cutover.

## 4. Part 3 - Local Tooling Check

Commands were run without installing anything.

| Tool | Result |
| --- | --- |
| `docker --version` | Docker version 28.3.2, build 578ccf6 |
| `docker compose version` | Docker Compose version v2.38.2-desktop.1 |
| `wsl --status` | Default distribution `docker-desktop`, default version 2 |
| `wsl --list --verbose` | `docker-desktop`, state `Stopped`, WSL version 2; WSL 2.5.7.0, kernel 6.6.87.1-1 |
| `psql --version` | Not found; `psql` is not installed on the Windows host |
| `node --version` | v24.15.0 |
| `pnpm --version` | 12.4.2 |
| `docker info` | Failed: `dockerDesktopLinuxEngine` pipe not found because the Docker engine is stopped |

Conclusion: Docker Desktop and WSL2 are installed on this Windows machine, so
Docker should be able to run once Docker Desktop is started. As-is right now,
the engine is stopped, so containers cannot run. No Docker daemon or dev
servers were started during this audit.

Because `psql` is missing on the host, use `docker compose exec db psql` for
manual database work once the stack runs, or install the PostgreSQL client
later.

If Docker cannot be started on this machine (for example virtualization is
disabled), fallback options are:

- Install PostgreSQL 16 natively on Windows and run migrations with
  `drizzle-kit migrate`; test the media adapter against a local directory.
- Use a remote/dev PostgreSQL instance for migration and API tests.
- Defer compose-only tests to the VPS, but keep unit tests for auth, storage,
  and migration SQL in CI with a `postgres:16` service.

Do not install anything as part of this audit.

## 5. Implementation Phases

Each phase is intended to be one small prompt and independently testable. The
order keeps the app working at every step.

### Phase 1 - Plain-Postgres migration bootstrap (done)

- Add an idempotent role bootstrap for `anon` and `authenticated` (NOLOGIN,
  no privileges) and run it before the migration runner.
- Add a CI/local test that starts `postgres:16`, runs migrations from empty,
  runs them again to confirm no duplicate failure, and runs
  `db:seed-categories`.
- Do not change application runtime code yet.
- Tests: fresh migration succeeds; all 10 migrations applied; key tables
  exist; seed is idempotent; `pnpm check:encoding`.

#### Local plain-Postgres testing

The local test database is defined in `docker-compose.dev.yml` at the repo
root. It listens on `127.0.0.1:5433` (not 5432) and uses throwaway credentials
that are marked local-development-only in the compose file.

```powershell
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml ps

$env:TEST_DATABASE_URL = "postgres://zayn_dev:zayn_dev_local@127.0.0.1:5433/zayn_dev"
pnpm --filter @zayn/api db:fresh-check
pnpm test

Remove-Item Env:TEST_DATABASE_URL
docker compose -f docker-compose.dev.yml down
```

The fresh check creates a randomly named throwaway database, runs the role
bootstrap and every migration twice, asserts the Drizzle schema tables, the RLS
state specified by the migrations, and the migration history, then drops the
throwaway database. It refuses to run when `TEST_DATABASE_URL` is missing or
when its host contains `supabase`. The integration test is skipped when
`TEST_DATABASE_URL` is not set, so `pnpm test` still passes without Docker.

To apply migrations and the category seed to the same local database (the seed
is safe to re-run):

```powershell
$env:DATABASE_URL = $env:TEST_DATABASE_URL
pnpm --filter @zayn/api db:migrate
pnpm --filter @zayn/api db:seed-categories
Remove-Item Env:DATABASE_URL
```

`apps/api/.env` is not used by the fresh check. To stop the test database and
delete its named volume as well:

```powershell
docker compose -f docker-compose.dev.yml down -v
```

### Phase 2 - Plain-Postgres database client and env cleanup (done, reduced scope)

- Replace Supabase pooler comments with plain Postgres documentation.
- Revisit `prepare: false` and `max: 1` in `db/client.ts` for a direct
  connection.
- Add media and auth configuration placeholders to the env schema without
  using them yet.
- Tests: API boots against local PostgreSQL; `/health` returns `db: true`;
  API and web lint/build still pass.

#### Local plain-Postgres development

This reduced Phase 2 makes the API run against the local Docker database for
daily development. Supabase Auth and Storage are unchanged in this phase, so
admin login and image uploads still use Supabase.

The committed local connection URL is dev-only and is already in
`docker-compose.dev.yml`; it is not a production secret:

```text
postgres://zayn_dev:zayn_dev_local@127.0.0.1:5433/zayn_dev
```

1. Start the database and wait for it to become healthy:

```powershell
pnpm db:dev:up
```

2. In `apps/api/.env` (gitignored), set the local database values:

```text
DATABASE_URL=postgres://zayn_dev:zayn_dev_local@127.0.0.1:5433/zayn_dev
DATABASE_SSL=disable
```

`DATABASE_SSL` is optional. When it is unset, the driver keeps its previous
behavior, including any `sslmode` in `DATABASE_URL`. Use `disable` for the local
container, which does not serve TLS.

3. Apply migrations:

```powershell
pnpm --filter @zayn/api db:migrate
```

4. Run the seeds:

```powershell
pnpm --filter @zayn/api db:seed-categories
pnpm --filter @zayn/api db:seed
```

5. Create the owner admin row. `admin:create-owner` only needs
   `OWNER_EMAIL` and `DATABASE_URL`; it does not call Supabase:

```powershell
$env:OWNER_EMAIL = "owner@example.com"
pnpm --filter @zayn/api admin:create-owner
Remove-Item Env:OWNER_EMAIL
```

6. Start development (web and API), or the API alone:

```powershell
pnpm dev
# API only:
pnpm --filter @zayn/api dev
```

Database helper scripts:

- `pnpm db:dev:up` starts the container and waits for its healthcheck.
- `pnpm db:dev:down` stops the container and keeps the data volume.
- `pnpm db:dev:reset` removes the volume, starts the container, runs
  migrations, and seeds categories.

Do not commit `apps/api/.env`. If a developer created
`apps/api/.env.supabase-backup`, that file must never be committed either, even
with a forced add. Keep Supabase credentials in the developer's shell or local
env files only.

### Phase 3 - Admin auth schema and API

- Add `admin_login_codes` and `admin_sessions` Drizzle tables and migration.
- Add code generation, HMAC hashing, session token hashing, and expiry helpers.
- Implement `POST /admin/auth/otp/verify`, `POST /admin/auth/logout`, and the
  new `requireAdmin` session lookup.
- Replace the Supabase OTP call in `adminAuth.ts` with code storage plus the
  existing email sender. Add the admin sign-in email template.
- Stop reading/writing `admin_users.auth_user_id`.
  - Tests: valid code creates a session; expired, reused, or over-attempted code
    fails; inactive admin fails; logout revokes; rate limits enforced; no
    Supabase imports remain in auth code; audit log written.

Phase 3 note: the `x-storefront-key` requirement belongs on the three new
routes (`POST /admin/auth/code/request`, `POST /admin/auth/code/verify`, and
`POST /admin/auth/logout`) individually. It must not be router-wide on
`/admin` or `/admin/auth`, because Express router middleware also runs for
paths that do not match that router. A router-wide check previously caused the
legacy public `POST /admin/auth/otp/request` to return 401. The regression test
suite now covers the public OTP request, the protected new endpoints, and the
dual-mode `GET /admin/me` and protected admin routes.

### Phase 4 - Admin auth web BFF, login, and logout

#### Phase 4a - Server-side admin session layer (done)

- Added the HttpOnly `zf_admin_session` cookie helpers with a 7-day lifetime,
  `SameSite=Lax`, production-only `Secure`, and server-only token handling.
- Added the new auth routes under `/api/admin-auth/`:
  - `POST /api/admin-auth/code-request`
  - `POST /api/admin-auth/code-verify`
  - `POST /api/admin-auth/logout`
  - `GET /api/admin-auth/me`
- Added the same-origin guard in `requestGuards.ts`; every mutating admin BFF
  handler rejects a foreign `Origin` or `Sec-Fetch-Site`.
- Added the admin data proxy at `/api/admin-proxy/[...path]`. It only forwards
  `admin/*` paths, blocks `admin/auth/*`, strips browser credentials and
  hop-by-hop headers, adds the server-held session and storefront key, and
  streams multipart bodies with a 45 MB cap.
- Added the dev-only `admin:mint-dev-session` script. It refuses unless
  `APP_ENV=development` and the database host is localhost/127.0.0.1.
- The old Supabase login path is unchanged. The new layer is not referenced by
  the visible login page, admin pages, `proxy.ts`, or `adminApi.ts` yet.

#### Phase 4b - Switch the visible admin UI (done)

- Changed `apps/web/src/app/admin/login/login-form.tsx` to request and verify
  codes through `/api/admin-auth/code-request` and `/api/admin-auth/code-verify`.
  The BFF sets the HttpOnly cookie, and the form no longer imports Supabase.
- Changed `apps/web/src/lib/adminApi.ts` and all admin calls and XHR uploads to
  use same-origin `/api/admin-proxy/` URLs. No bearer token or Authorization
  header is created in the browser. A 401 redirects to
  `/admin/login?reason=expired`; 413 and 403 return plain-language messages.
- Made the protected admin layout a server component. It validates
  `zf_admin_session` through a server-side `GET /admin/me` call and redirects
  unauthenticated or invalid sessions to `/admin/login`. The shell receives the
  admin identity as a prop and logs out through `/api/admin-auth/logout`.
- Changed `apps/web/src/proxy.ts` to gate `/admin/*` on the presence of the
  `zf_admin_session` cookie only. It makes no API call and leaves
  `/admin/login` alone, so an invalid cookie cannot loop. The `/c/<slug>` and
  `/p/<slug>` 404 guards and their 2.5-second API timeout are unchanged.
- Changed `adminPreview.ts` and `revalidateStorefront.ts` to validate the admin
  cookie through the API me endpoint. The server action fails closed unless the
  caller is a valid admin.
- Removed every Supabase import from the admin area and admin-related web libs.
  The now-unused `apps/web/src/lib/supabase/client.ts` and `server.ts` adapters
  remain until Phase 7, along with the packages and environment variables.
- Added `apps/web/scripts/check-admin-login.mjs` and the
  `pnpm --filter web check:admin-login` command. It covers the admin shell,
  HttpOnly visibility, logout, missing/invalid cookie redirects, and zero
  browser requests to Supabase hosts while browsing admin pages. Product image
  GETs from Supabase Storage are reported separately.
- `NEXT_PUBLIC_SITE_URL` must equal the public origin behind a tunnel or reverse
  proxy because the admin BFF same-origin guard compares it with `Origin` and
  `Sec-Fetch-Site`.

##### Manual login test

The Playwright check does not automate the email-code step because it needs a
real inbox (or the development log-only email sender).

1. Start the local database, API, and web app. Set the local `DATABASE_URL`
   and `DATABASE_SSL` in the current shell only.
2. Open `/admin/login`, enter the owner email, and request a code.
3. Read the code from the API development log (when Resend is not configured)
   or from the real inbox.
4. Enter the six-digit code. Confirm the redirect to `/admin`, the admin email
   and role in the header, and the owner-only controls for an owner.
5. Open products, categories, content, delivery, settings, and an order detail
   page. Confirm the pages load through `/api/admin-proxy/` and no browser
   request goes to a Supabase host except product image GETs.
6. Click Logout. Confirm `/admin/login` loads and the cookie is gone.
7. Without a cookie, open `/admin/products`; confirm the redirect to
   `/admin/login`.
8. With a bogus `zf_admin_session` cookie, open `/admin/products`; confirm the
   redirect to `/admin/login` without a redirect loop.

### Phase 5 - Local media adapter (done)

- Added `apps/api/src/lib/mediaStorage.ts` with the `MediaStorage` interface
  (`put`, `remove`, `publicUrl`) and two drivers:
  - `SupabaseMediaStorage` keeps the existing `product-images` bucket,
    upload options, delete calls, and public URL behavior.
  - `LocalMediaStorage` writes under `MEDIA_DIR` using the same
    `products|content|categories/<uuid>/<uuid>.webp` paths.
- `MEDIA_DRIVER` selects the driver and defaults to `supabase`, so the current
  deployment behavior is unchanged. `local` is explicit.
- Local writes are atomic (temporary file then rename), create directories as
  needed, use restrictive permissions, and reject absolute paths, `..`,
  backslashes, NUL bytes, percent-encoded input, wrong folders, non-UUID names,
  and non-WebP extensions. Reads and deletes resolve real paths and reject
  symlink escapes outside `MEDIA_DIR`.
- Added the public `GET`/`HEAD /media/*` route, mounted only when
  `MEDIA_DRIVER=local`. It uses the same allow-list, returns 404 for missing or
  invalid paths, never lists directories, and sends fixed
  `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`,
  `Cache-Control: public, max-age=31536000, immutable`, and
  `Cross-Origin-Resource-Policy: cross-origin`. The route is mounted after
  Helmet and CORS so the media headers override Helmet's default CORP. A
  lenient 600 request/minute/IP limiter applies.
- Added a local disk guard. `MEDIA_MIN_FREE_MB` defaults to 500; uploads are
  refused with a 507-style error below that free space. If free space cannot
  be determined, the API logs a warning and allows uploads.
- Added `pnpm --filter @zayn/api media:orphans [--dry-run|--delete]`. The
  default is report-only. It lists unreferenced valid media files and database
  rows whose file is missing.
- `verifyImages.ts` continues to work unchanged because it only exercises the
  in-memory magic-byte and sharp pipeline; it does not touch Storage.
- Environment variables:
  - `MEDIA_DRIVER` (`supabase` default, or `local`)
  - `MEDIA_DIR` (absolute; required for local outside development; development
    default `<repo>/apps/api/media-data`, which is gitignored)
  - `MEDIA_PUBLIC_BASE_URL` (default `http://localhost:4000` in development;
    required for local in staging/production)
  - `MEDIA_MIN_FREE_MB` (default 500)
- Tests cover path validation and traversal, atomic writes and deletes, local
  disk guard, env validation, media route headers and 404/HEAD/405 behavior,
  mount-only-when-local, and the unchanged Supabase driver.
- Phase 6 took the web side: `apps/web/next.config.ts` image host settings.
  Local media URLs now render through the web image pipeline as described in
  Phase 6 below.
- Existing Supabase-hosted development images are disposable. A one-time copy
  script for them is NOT part of this phase.

### Phase 6 - Web image URLs and Next config (done)

- `apps/web/next.config.ts` now allows `next/image` to optimize the API media
  origin from `NEXT_PUBLIC_MEDIA_BASE_URL` (exact protocol, hostname, and port;
  pathname `/media/**`). Development defaults to `http://localhost:4000`.
- The Supabase `remotePatterns` entry remains only when `SUPABASE_URL` (or the
  current web setting `NEXT_PUBLIC_SUPABASE_URL`) is set, so Supabase-hosted
  images keep working until Phase 7.
- A bad or missing media URL never crashes the build. Staging and production
  builds warn when `NEXT_PUBLIC_MEDIA_BASE_URL` is missing.
- `images.dangerouslyAllowLocalIP` is enabled only when
  `NODE_ENV !== "production"`, so local development can optimize
  `http://localhost:4000/media/...` without enabling loopback access in
  production or staging builds.
- Added `apps/api/src/lib/mediaUrls.ts` (`resolveMediaUrl`). When
  `MEDIA_DRIVER=local` and a valid `storage_path` exists, it rebuilds the URL
  from `MEDIA_PUBLIC_BASE_URL`; otherwise it returns the stored URL unchanged.
  It is used by public product, category, content, and search responses and by
  the admin product, category, and content serializers. `storage_path` is not
  added to public responses.
- The storefront and admin keep using the existing `SmartImage`/`next/image`
  components; no layout or styling changed.
- Added `apps/api/tests/mediaUrls.test.ts` and
  `apps/api/tests/publicMediaUrls.test.ts`, plus
  `pnpm --filter web check:media-image`.
- `NEXT_PUBLIC_MEDIA_BASE_URL` is documented in `apps/web/.env.example` and
  `docs/DEPLOYMENT.md`. `render.yaml` is unchanged because this is a web
  (Vercel) variable, not an API service variable.

### Phase 7 - Remove Supabase code, dependencies, and environment variables (done)

- Deleted `apps/api/src/lib/supabase.ts`, the old
  `apps/api/src/routes/adminAuth.ts` OTP route, and both web Supabase client
  files. `GET /admin/me` now lives with the new code-auth router and accepts
  only `x-admin-session`; a bearer token is always rejected.
- Removed `@supabase/supabase-js` and `@supabase/ssr` from package manifests
  and regenerated the lockfile with `pnpm install`.
- Removed `SUPABASE_*` and `MEDIA_DRIVER` from `env.ts`, `.env.example` files,
  `render.yaml`, and the Render production example. Local media storage is the
  only driver; `/media` is always mounted.
- Removed the Supabase `remotePatterns` path from the web config. Only the
  `NEXT_PUBLIC_MEDIA_BASE_URL` `/media/**` pattern remains.
- Updated `README.md` and `docs/DEPLOYMENT.md`. The Render files are now
  explicitly marked as legacy references; the Docker/VPS deployment steps
  remain phases 8-12.
- Added empty owner-folder cleanup after media deletes and empty-folder
  reporting/removal in `media:orphans`.
- Tests: `pnpm install --frozen-lockfile` passes; `pnpm lint` and `pnpm build`
  pass; repository grep for `supabase` only matches migration history, the
  bootstrap role comments, the removal plan, and clearly labelled legacy notes;
  no Supabase runtime configuration is required to boot.

### Phase 8 - Docker images for API and web (done)

- Added root `.dockerignore` and multi-stage `apps/api/Dockerfile` and
  `apps/web/Dockerfile`. Both build from the repository root, use
  `node:24-bookworm-slim`, pnpm `12.4.2` through Corepack, a frozen install,
  and run as non-root uid 1001.
- The API image uses `pnpm deploy --prod` for a production-only dependency
  tree and copies only the compiled `dist`, Drizzle migrations,
  db-bootstrap, package manifest, and production `node_modules`. It uses
  `tini` as PID 1, exposes 4000, has a Node healthcheck, and writes media to
  `/data/media`.
- The web image enables `output: "standalone"` only when
  `NEXT_OUTPUT=standalone` is set (the Docker build sets it), with
  `outputFileTracingRoot` at the repo root. It copies `.next/standalone`,
  `.next/static`, public files, and the built `@zayn/shared` package, then
  runs `node apps/web/server.js`.
- Added `pnpm docker:build:api`, `pnpm docker:build:web`, and
  `pnpm docker:smoke` (`scripts/docker-smoke.mjs`). The smoke test uses a
  throwaway PostgreSQL container, network, and media volume, then removes all
  of its own resources.
- Added `docs/DOCKER.md` with build commands, build args, runtime variables,
  logs, image removal, and the smoke test.
- Tests: both images build; the API migrations run twice successfully and are
  idempotent; the API serves `/health` with `db:true`, public categories, and
  404 for bad media; the API is non-root, writes to `/data/media`, and resizes
  with `sharp`; the web standalone server serves `/`, `/admin/login`, and
  `/robots.txt`; no secret-looking env vars or `.env` files are present in
  either image.

### Phase 9 - Compose stack (done)

- Added `docker-compose.stack.yml` with `postgres`, one-shot `migrate`, `api`,
  `web`, and Caddy 2 `edge` services on one user-defined network. Only
  `127.0.0.1:${EDGE_HOST_PORT:-8080}` is published. API/web ports are exposed
  only inside the network, and PostgreSQL has no published port.
- Added named `pgdata` and `media` volumes, healthchecks, restart policies,
  log rotation (`json-file`, 10 MB, 3 files), `no-new-privileges`, `cap_drop:
  ALL`, and read-only roots for api/web. API uses `/tmp`; web uses `/tmp` and
  `/app/apps/web/.next/cache` tmpfs mounts. Both worked under the smoke test,
  including image upload and serving.
- Added `API_INTERNAL_URL` as a runtime-only server value. `apiBaseUrl()` in
  `apps/web/src/lib/apiBaseUrl.ts` reads it at request time and falls back to
  `NEXT_PUBLIC_API_URL`. It is used by `publicApi.ts`, `storeStatus.ts`,
  `proxy.ts`, `authApi.ts`, `adminAuthApi.ts`, and the admin proxy. Browser
  values remain `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_MEDIA_BASE_URL`.
- Added `deploy/Caddyfile`: plain HTTP on `:80`, 50 MB request body limit,
  compression, security headers without HSTS/CSP, logs to stdout with Cookie
  and code/token query keys removed, `/media/*` and `/webhooks/stripe` to the
  API, and everything else to the web app.
- Added `.env.compose.example`, the ignored `.env.compose`, and
  `pnpm docker:stack:init`, `:up`, `:down`, `:logs`, `:reset -- --yes`, and
  `:smoke`. Init generates alphanumeric Postgres, admin, and storefront
  secrets without printing them.
- The compiled `dist/scripts/createOwner.js` entry exists and is documented
  for owner bootstrap.
- Fixed broken stack images: absolute URLs on the public media origin are
  converted to site-relative `/media/...` paths by one web helper, allowed by
  `images.localPatterns` without query strings, and optimized through a baked
  Next rewrite to `API_INTERNAL_URL` (`http://api:4000` in Compose). Caddy still
  serves `/media/*` directly and the API media route is unchanged. The
  production image does not enable `dangerouslyAllowLocalIP`.
- Added `scripts/check-stack-images.mjs`, wired into the smoke test, which opens
  admin products, the product page, category page, and home page in Playwright
  and asserts real images load and no image request fails.
- Tests: `pnpm docker:stack:smoke` passes through the edge: storefront,
  admin login page, robots, media 404, Stripe webhook 400, admin redirect,
  API public route not exposed, edge-only published port, non-root users,
  migrations, category seed, owner creation, real admin code login, admin
  product/image upload, media 200 `image/webp` with `nosniff`, foreign-origin
  403, image/product delete and empty-folder cleanup, API restart health and
  data persistence, and migrate exit code/count. The smoke project
  (`zayn-smoke`) cleans up all of its containers, networks, volumes, and temp
  env file.

### Phase 10 - Cloudflare Tunnel and edge configuration (done)

- Added the optional `tunnel` and `quicktunnel` Compose profiles using
  `cloudflare/cloudflared:2026.11.2` (tag-pinned). Both connect outbound to
  `http://edge:80`, join the stack network, publish no ports, depend on a
  healthy edge, drop all capabilities, use `no-new-privileges` and a read-only
  root with a `/tmp` tmpfs, and rotate logs. The named profile reads
  `TUNNEL_TOKEN` from the environment and has a one-shot clear-failure guard for
  an empty token; the quick profile is clearly marked testing-only.
- Added `pnpm docker:stack:up:tunnel` and `pnpm docker:stack:up:quick`. The
  quick command waits for and prints the temporary `trycloudflare.com` URL (not
  a secret). `down`, `logs`, and `reset` include both profiles.
- Pinned the edge to Caddy 2.11.9 and configured only private/loopback peers as
  trusted proxies, with `trusted_proxies_strict`, `CF-Connecting-IP` first and
  `X-Forwarded-For` second. Caddy overwrites `X-Forwarded-For` and `X-Real-IP`
  with the single validated client IP, sets `X-Forwarded-Proto` to the original
  scheme, and strips client-supplied `CF-Connecting-IP`, `CF-Visitor`,
  `X-Visitor-IP`, `X-Storefront-Key`, `X-Admin-Session`, and `Forwarded`.
- `requestGuards.getVisitorIp()` already reads `x-forwarded-for` then
  `x-real-ip`; the API's storefront-keyed limiter already uses `x-visitor-ip`.
  No application code change was needed. The web server cannot be tricked by a
  client-supplied `x-visitor-ip`; the API is not published.
- Added conservative HSTS (`max-age=300`, no includeSubDomains, no preload)
  only when the original request was HTTPS, with an `HSTS_MAX_AGE` env knob and
  documented steps to raise it to 1 day, 30 days, then 180 days.
- Documented the trust assumption: the edge is safe only because it publishes
  only `127.0.0.1:${EDGE_HOST_PORT}` and the tunnel is the only ingress. If the
  edge were exposed directly, `CF-Connecting-IP` and the scheme headers could be
  spoofed. `docs/DOCKER.md` and `deploy/Caddyfile` state this prominently.
- The admin `zf_admin_session` and customer `zf_session` cookies remain
  HttpOnly/SameSite=Lax and set Secure when `NODE_ENV=production`; local HTTP
  development uses `NODE_ENV=development`. The admin same-origin guard already
  compares against `NEXT_PUBLIC_SITE_URL`. Public origins are build-time values
  for the web image, so a domain change requires a rebuild; the stack scripts
  warn when a tunnel profile is active while public origins still point at
  localhost, are unset, or are not HTTPS.
- `docs/DOCKER.md` now covers the tunnel in plain words, quick versus named,
  the unverified dashboard labels, the `http://edge:80` service mapping, the
  `https://<domain>/webhooks/stripe` webhook, rebuild steps, HSTS rollout, the
  IPv6-only VPS note (unverified), and the trust model.
- Fixed web prerender cache write failures under the read-only root. Next writes
  at runtime under `.next/server/route-cache` and `.next/cache`; both are now
  tmpfs mounts owned by uid/gid `1001`, mode `0700`, 128 MB each. The root and
  `.next` stay read-only, and the caches are safe to lose on restart because
  pages and images regenerate. The smoke test loads real pages, changes a
  product through the admin proxy, invokes the real `revalidateStorefront`
  server action through the admin content UI, asserts the new name and price on
  the product and category pages within 15 seconds, restarts web, asserts the
  pages still render the changed values, and asserts the web logs contain zero
  `Failed to update prerender cache` / `EROFS` / `ENOENT` / `EACCES` lines.
- Trimmed the Caddy access log to timestamp, level, message, method, host,
  path-only `uri`, protocol, status, duration, size, remote IP, and client IP.
  All request and response headers and the query string are dropped, loopback
  healthchecks are skipped, and docs note that visitor IPs are personal data
  retained by the Docker 3 x 10 MB log rotation.
- Tests: `pnpm docker:stack:smoke` asserts the Docker gateway peer is private,
  Caddy derives the visitor IP from `CF-Connecting-IP` (a client-supplied
  `X-Forwarded-For`/`X-Real-IP`/`x-visitor-ip` does not change it), separate
  rate-limit buckets for two `CF-Connecting-IP` values, forged
  `x-admin-session`/`x-storefront-key` headers do not authenticate, HSTS is
  present only on simulated HTTPS with `max-age=300`, the edge is still the only
  published port on `127.0.0.1`, and both tunnel profiles validate while staying
  out of the default service list. It also validates the tmpfs ownership/mode,
  the headless-browser content revalidation flow and web-restart persistence,
  the clean web logs, and the compact access log with no leaked fake
  User-Agent/Cookie/Referer/query or loopback healthcheck lines. The optional
  live quick-tunnel round trip is not part of the offline smoke test.


### Phase 11 - Backups and restore drill

- Add nightly `pg_dump -Fc` with retention, plus media backup, off-server
  encrypted copy, and failure alerting.
- Add a restore script and document the monthly restore test.
- Tests: a dump restores into a scratch PostgreSQL 16 container; key table row
  counts match; a sample media file restores and serves; a deliberately broken
  dump triggers an alert; retention deletes only old files.

### Phase 12 - Legacy cleanup and VPS runbook

- Drop `admin_users.auth_user_id` and `customers.auth_user_id` after grep and
  runtime checks confirm they are unused.
- Optionally squash the migration baseline and remove the inert Supabase role
  bootstrap and revoke statements.
- Add the VPS setup runbook: Docker installation, deploy user, firewall,
  fail2ban, unattended upgrades, swap, disk alerts, secrets file permissions,
  systemd unit for compose, backup timers, and restore steps.
- Remove Render/Vercel deployment notes if those platforms are retired.
- Tests: fresh and existing database migration paths both pass; no
  `auth_user_id` references remain; admin login and image upload still work;
  runbook commands are copy-paste safe.

## 6. Risks

1. Admin lockout and email deliverability. Passwordless admin login depends on
   Resend, DNS/domain verification, and correct rate-limit settings. A Resend
   outage or a misconfigured sender can lock the owner out. Mitigation: test
   the Resend sender and the log-only fallback, add a break-glass CLI that
   creates a short-lived admin session or resets the code flow from the VPS,
   monitor failed sends, and keep the owner email current.

2. Cookie auth and CSRF/XSS. Moving the token into an HttpOnly cookie protects
   it from JavaScript reads, but the BFF becomes a state-changing proxy and
   must reject cross-origin requests. Any XSS can still act as the admin.
   Mitigation: SameSite=Lax, strict Origin checks on mutations, no token in
   browser storage, output escaping, a restrictive Content Security Policy,
   and Cloudflare WAF rules for the admin paths.

3. Image loss and disk exhaustion. Self-hosted media is a single volume on one
   VPS. Disk full stops uploads and can affect PostgreSQL; a lost volume loses
   every product image. Path traversal or a malicious image can damage files
   or consume memory. Mitigation: include media in backups, alert on disk
   usage, validate paths and magic bytes, cap file size and pixel count,
   process images before writing, run as non-root, and keep the volume on a
   reliable disk.

4. Migration and rollback risk. Plain-Postgres role errors, RLS behavior,
   edited migration history, or a bad migration can block deployment. There is
   no managed Supabase restore button anymore. Mitigation: test migrations on
   a fresh `postgres:16` in CI, use the inert-role bootstrap or a clean
   baseline, run migrations as a separate job with a backup first, never
   auto-migrate on every API start, and document the restore procedure.

5. Single-VPS operational failure. Postgres, API, web, media, and the tunnel
   all share one machine. A host failure, Docker upgrade, or accidental
   `compose down -v` can take the store offline. Mitigation: off-server
   backups, a tested restore, restart policies, healthchecks, disk and memory
   alerts, a documented VPS rebuild runbook, and a maintenance window for
   upgrades.

Additional risks worth tracking: old Supabase image URLs and order snapshots
break when the project is deleted (acceptable for disposable dev data);
`next/image` behavior with relative versus absolute media URLs; and Docker
builds on Windows/WSL taking longer than expected because native dependencies
such as `sharp` are rebuilt for the container platform.

## 7. Unverified / Could Not Verify

- Docker engine start: Docker Desktop and WSL2 are installed but the engine is
  stopped, and `docker info` failed. Docker container startup was not tested.
  Starting Docker Desktop was intentionally not attempted.
- PostgreSQL 16 migration run: not executed in this phase. The failure analysis
  for `anon` and `authenticated` is based on PostgreSQL role semantics, but no
  container was run.
- Exact `@supabase/ssr` cookie names and flags: inferred from the code and
  adapters; not inspected at runtime. No `.env` file was read.
- Whether any real data exists in the current database: not queried. Per the
  project instruction, the dev data is treated as disposable.
- Whether `admin_users.auth_user_id` currently contains values: not queried.
- Resend domain verification, deliverability, and the current sender identity:
  not tested; only the sender implementation was read.
- Cloudflare Tunnel, DNS, VPS operating system, firewall, and provider
  specifics: no account or server access. Treat the edge/VPS steps as design
  guidance to confirm during implementation.
- `drizzle-kit` transaction and hash behavior when an already-applied migration
  file is edited: not tested. The inert-role bootstrap avoids editing applied
  migrations.
- Next.js standalone Docker output with this pnpm workspace: not built.
- Windows bind-mount performance for PostgreSQL: not measured. Use a named
  volume for the database; a host bind mount for media is reasonable on Linux
  but not recommended for the database on Windows.
- Whether the current API database role truly owns every table on Supabase:
  likely, based on the connection model, but not verified. The plain-Postgres
  design makes this explicit by running migrations as the app owner.
- Production `psql` client availability on the VPS: unknown. The compose
  database container can provide `psql` regardless.

## 8. Verification Record

This phase is read-only for application code. The checks that must pass after
this document is written:

- `pnpm check:encoding` passes.
- `git diff --stat` shows only `docs/SUPABASE_REMOVAL_PLAN.md`.
- `git status` shows no `.env` file staged and no `.env` contents read.
- No dev server or Docker container is started or left running.
- Commit message: `Add Supabase removal audit and phased plan`.
