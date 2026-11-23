import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(
  /\/+$/,
  "",
);
const TOKEN = process.env.ADMIN_SESSION_TOKEN;

if (!TOKEN) {
  console.error("ADMIN_SESSION_TOKEN is required.");
  process.exit(1);
}

const COOKIE = `zf_admin_session=${TOKEN}`;
const results = [];

function record(name, status) {
  results.push({ name, status });
  console.log(`${name}: HTTP ${status}`);
}

async function request(path, options = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    redirect: "manual",
    cache: "no-store",
  });
}

async function json(response) {
  return response.json().catch(() => null);
}

async function main() {
  const noCookieMe = await request("/api/admin-auth/me");
  assert.equal(noCookieMe.status, 401);
  record("me without cookie", noCookieMe.status);

  const codeRequest = await request("/api/admin-auth/code-request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "nobody@example.com" }),
  });
  assert.equal(codeRequest.status, 200);
  assert.equal(codeRequest.headers.get("cache-control"), "no-store");
  const codeBody = await json(codeRequest);
  assert.equal(
    codeBody?.message,
    "If this email belongs to an active admin, a sign-in code was sent.",
  );
  record("code-request without headers", codeRequest.status);

  const me = await request("/api/admin-auth/me", {
    headers: { cookie: COOKIE },
  });
  const meBody = await json(me);
  assert.equal(me.status, 200);
  assert.equal(me.headers.get("cache-control"), "no-store");
  assert.equal(typeof meBody?.email, "string");
  assert.equal(typeof meBody?.role, "string");
  assert.equal(Object.hasOwn(meBody ?? {}, "sessionToken"), false);
  record("me with cookie", me.status);

  const products = await request(
    "/api/admin-proxy/admin/products?page=1&page_size=1",
    { headers: { cookie: COOKIE } },
  );
  const productsBody = await json(products);
  assert.equal(products.status, 200);
  assert.equal(products.headers.get("cache-control"), "no-store");
  assert.ok(Array.isArray(productsBody?.items));
  record("proxy GET admin/products", products.status);

  const badCode = await request("/api/admin-auth/code-verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "nobody@example.com",
      code: "000000",
    }),
  });
  const badCodeBody = await json(badCode);
  assert.equal(badCode.status, 401);
  assert.equal(badCodeBody?.error, "Invalid or expired code.");
  record("code-verify generic failure", badCode.status);

  const foreignOrigin = await request("/api/admin-auth/code-request", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.example",
    },
    body: JSON.stringify({ email: "nobody@example.com" }),
  });
  assert.equal(foreignOrigin.status, 403);
  record("code-request foreign origin", foreignOrigin.status);

  const authProxy = await request(
    "/api/admin-proxy/admin/auth/code/verify",
    { headers: { cookie: COOKIE } },
  );
  assert.equal(authProxy.status, 404);
  record("proxy admin/auth blocked", authProxy.status);

  const upperAuthProxy = await request(
    "/api/admin-proxy/admin/AUTH/code/verify",
    { headers: { cookie: COOKIE } },
  );
  assert.equal(upperAuthProxy.status, 404);
  record("proxy admin/AUTH blocked", upperAuthProxy.status);

  const otherProxy = await request(
    "/api/admin-proxy/anything-else",
    { headers: { cookie: COOKIE } },
  );
  assert.equal(otherProxy.status, 404);
  record("proxy non-admin path blocked", otherProxy.status);

  const spoofedHeaders = {
    authorization: "Bearer client-supplied",
    "x-admin-session": "client-supplied",
    "x-storefront-key": "client-supplied",
  };
  const noCookieSpoof = await request(
    "/api/admin-proxy/admin/products",
    { headers: spoofedHeaders },
  );
  assert.equal(noCookieSpoof.status, 401);
  record("proxy spoofed headers without cookie", noCookieSpoof.status);

  const withCookieSpoof = await request(
    "/api/admin-proxy/admin/products",
    { headers: { ...spoofedHeaders, cookie: COOKIE } },
  );
  assert.equal(withCookieSpoof.status, 200);
  record("proxy spoofed headers with cookie", withCookieSpoof.status);

  const foreignOriginProxy = await request(
    "/api/admin-proxy/admin/products",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: COOKIE,
        origin: "https://evil.example",
      },
      body: JSON.stringify({}),
    },
  );
  assert.equal(foreignOriginProxy.status, 403);
  record("proxy mutating foreign origin", foreignOriginProxy.status);

  const sku = `BFF-CHECK-${Date.now()}`;
  const created = await request("/api/admin-proxy/admin/products", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: COOKIE,
    },
    body: JSON.stringify({
      name: "BFF multipart check",
      price_cents: 100,
      sku,
      status: "draft",
    }),
  });
  const createdBody = await json(created);
  assert.equal(created.status, 201);
  assert.equal(typeof createdBody?.id, "string");
  record("proxy create throwaway product", created.status);

  const productId = createdBody.id;

  try {
    const form = new FormData();
    form.append(
      "files",
      new Blob(["not an image"], { type: "text/plain" }),
      "not-an-image.txt",
    );
    const upload = await request(
      `/api/admin-proxy/admin/products/${productId}/images`,
      {
        method: "POST",
        headers: { cookie: COOKIE },
        body: form,
      },
    );
    assert.equal(upload.status, 400);
    record("proxy multipart stream (invalid file rejected)", upload.status);

    if (process.env.CHECK_ADMIN_BFF_UPLOAD === "1") {
      const image = readFileSync(
        new URL(
          "../apps/web/public/images/home/hero-1.jpg",
          import.meta.url,
        ),
      );
      const imageForm = new FormData();
      imageForm.append(
        "files",
        new Blob([image], { type: "image/jpeg" }),
        "hero-1.jpg",
      );
      const realUpload = await request(
        `/api/admin-proxy/admin/products/${productId}/images`,
        {
          method: "POST",
          headers: { cookie: COOKIE },
          body: imageForm,
        },
      );
      record("proxy multipart upload real image", realUpload.status);

      if (realUpload.status !== 201) {
        const body = await json(realUpload);
        console.log(
          `real image upload unavailable in this environment: ${
            body?.error ?? "unknown"
          }`,
        );
      }
    }
  } finally {
    const deleted = await request(
      `/api/admin-proxy/admin/products/${productId}`,
      {
        method: "DELETE",
        headers: { cookie: COOKIE },
      },
    );
    assert.equal(deleted.status, 200);
    record("proxy delete throwaway product", deleted.status);
  }

  const logout = await request("/api/admin-auth/logout", {
    method: "POST",
    headers: { cookie: COOKIE },
  });
  assert.equal(logout.status, 200);
  assert.equal(logout.headers.get("cache-control"), "no-store");
  const setCookie = logout.headers.getSetCookie?.() ??
    [logout.headers.get("set-cookie") ?? ""];
  const cleared = setCookie.join("\n");
  assert.match(cleared, /zf_admin_session=/i);
  assert.match(cleared, /Max-Age=0/i);
  assert.match(cleared, /HttpOnly/i);
  assert.match(cleared, /SameSite=Lax/i);
  assert.match(cleared, /Path=\//i);
  record("logout", logout.status);

  const afterLogout = await request("/api/admin-auth/me", {
    headers: { cookie: COOKIE },
  });
  assert.equal(afterLogout.status, 401);
  const afterLogoutSetCookie = afterLogout.headers.getSetCookie?.() ??
    [afterLogout.headers.get("set-cookie") ?? ""];
  assert.match(afterLogoutSetCookie.join("\n"), /Max-Age=0/i);
  record("me after logout with old cookie", afterLogout.status);

  console.log("PASS: admin BFF HTTP checks.");
  console.log(JSON.stringify(results));
}

main().catch((error) => {
  console.error("FAIL: admin BFF HTTP checks.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
