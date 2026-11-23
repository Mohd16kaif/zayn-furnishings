import assert from "node:assert/strict";
import process from "node:process";
import {
  ADMIN_SESSION_MAX_AGE_SECONDS,
  adminSessionCookieOptions,
} from "../apps/web/src/lib/adminSessionOptions.ts";
import {
  ADMIN_PROXY_MAX_BODY_BYTES,
  buildAdminProxyRequestHeaders,
  declaredBodyTooLarge,
  validateAdminProxyPath,
} from "../apps/web/src/lib/adminProxy.ts";
import { isSameOriginRequest } from "../apps/web/src/lib/requestGuards.ts";

const SITE = "http://localhost:3000";
process.env.NEXT_PUBLIC_SITE_URL = SITE;

function request(path, options = {}) {
  return new Request(`${SITE}${path}`, options);
}

const expectedCookie = {
  httpOnly: true,
  sameSite: "lax",
  secure: false,
  path: "/",
  maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
};

assert.deepEqual(adminSessionCookieOptions("development"), expectedCookie);
assert.equal(adminSessionCookieOptions("production").secure, true);
assert.equal(ADMIN_SESSION_MAX_AGE_SECONDS, 7 * 24 * 60 * 60);

assert.equal(
  isSameOriginRequest(
    request("/api/admin-auth/code-request", {
      method: "POST",
      headers: { origin: SITE },
    }),
  ),
  true,
);
assert.equal(
  isSameOriginRequest(
    request("/api/admin-auth/code-request", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    }),
  ),
  false,
);
assert.equal(
  isSameOriginRequest(
    request("/api/admin-auth/code-request", { method: "POST" }),
  ),
  true,
);
assert.equal(
  isSameOriginRequest(
    request("/api/admin-auth/code-request", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
    }),
  ),
  true,
);
assert.equal(
  isSameOriginRequest(
    request("/api/admin-auth/code-request", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    }),
  ),
  false,
);
assert.equal(
  isSameOriginRequest(
    request("/api/admin-auth/code-request", {
      method: "POST",
      headers: { "sec-fetch-site": "none" },
    }),
  ),
  false,
);
assert.equal(
  isSameOriginRequest(
    request("/api/admin-auth/code-request", {
      method: "POST",
      headers: { origin: "https://localhost:3000" },
    }),
  ),
  false,
);
assert.equal(
  isSameOriginRequest(
    request("/api/admin-auth/code-request", {
      method: "POST",
      headers: { origin: "http://localhost:3001" },
    }),
  ),
  false,
);
assert.equal(
  isSameOriginRequest(
    request("/api/admin-auth/code-request", {
      method: "POST",
      headers: { origin: "not-a-url" },
    }),
  ),
  false,
);

assert.deepEqual(
  validateAdminProxyPath(["admin", "products"], "/api/admin-proxy/admin/products"),
  { ok: true, segments: ["admin", "products"] },
);
assert.deepEqual(
  validateAdminProxyPath(
    ["admin", "products", "uuid", "images"],
    "/api/admin-proxy/admin/products/uuid/images",
  ),
  { ok: true, segments: ["admin", "products", "uuid", "images"] },
);
assert.equal(
  validateAdminProxyPath(
    ["admin", "auth", "code", "verify"],
    "/api/admin-proxy/admin/auth/code/verify",
  ).ok,
  false,
);
assert.equal(
  validateAdminProxyPath(["anything-else"], "/api/admin-proxy/anything-else")
    .ok,
  false,
);
assert.equal(validateAdminProxyPath(["admin"], "/api/admin-proxy/admin").ok, false);
assert.equal(
  validateAdminProxyPath(["admin", "..", "products"], "/api/admin-proxy/admin/../products")
    .ok,
  false,
);
assert.equal(
  validateAdminProxyPath(
    ["admin", "%2e%2e", "products"],
    "/api/admin-proxy/admin/%2e%2e/products",
  ).ok,
  false,
);
assert.equal(
  validateAdminProxyPath(
    ["admin", "products"],
    "/api/admin-proxy/admin/%2e%2e/products",
  ).ok,
  false,
);
assert.equal(
  validateAdminProxyPath(["admin", "", "products"], "/api/admin-proxy/admin//products")
    .ok,
  false,
);
assert.equal(
  validateAdminProxyPath(
    ["admin", "auth", "code", "verify"],
    "/api/admin-proxy/admin/AUTH/code/verify",
  ).ok,
  false,
);
assert.equal(
  validateAdminProxyPath(
    ["admin", "Auth"],
    "/api/admin-proxy/admin/Auth",
  ).ok,
  false,
);
assert.equal(
  validateAdminProxyPath(
    ["admin", "products%2Fimages"],
    "/api/admin-proxy/admin/products%2Fimages",
  ).ok,
  false,
);
assert.equal(
  validateAdminProxyPath(
    ["admin", "products%5Cimages"],
    "/api/admin-proxy/admin/products%5Cimages",
  ).ok,
  false,
);
assert.equal(
  validateAdminProxyPath(
    ["admin", "products", "..", "..", "auth"],
    "/api/admin-proxy/admin/products/../../auth",
  ).ok,
  false,
);

const headers = buildAdminProxyRequestHeaders({
  contentType: "multipart/form-data; boundary=test-boundary",
  sessionToken: "server-session-token",
  storefrontKey: "server-storefront-key",
  visitorIp: "203.0.113.10",
});

assert.equal(headers.get("content-type"), "multipart/form-data; boundary=test-boundary");
assert.equal(headers.get("x-admin-session"), "server-session-token");
assert.equal(headers.get("x-storefront-key"), "server-storefront-key");
assert.equal(headers.get("x-visitor-ip"), "203.0.113.10");
assert.equal(headers.get("authorization"), null);
assert.equal(headers.get("cookie"), null);
assert.equal(headers.get("connection"), null);
assert.equal(headers.get("keep-alive"), null);
assert.equal(headers.get("transfer-encoding"), null);
assert.equal(headers.get("te"), null);
assert.equal(headers.get("trailer"), null);
assert.equal(headers.get("upgrade"), null);
assert.equal(headers.get("proxy-authorization"), null);

assert.equal(
  declaredBodyTooLarge(
    request("/api/admin-proxy/admin/products", {
      method: "POST",
      headers: { "content-length": String(ADMIN_PROXY_MAX_BODY_BYTES + 1) },
    }),
  ),
  true,
);
assert.equal(
  declaredBodyTooLarge(
    request("/api/admin-proxy/admin/products", {
      method: "POST",
      headers: { "content-length": String(ADMIN_PROXY_MAX_BODY_BYTES) },
    }),
  ),
  false,
);
assert.equal(
  declaredBodyTooLarge(
    request("/api/admin-proxy/admin/products", { method: "POST" }),
  ),
  false,
);

console.log("PASS: admin BFF unit checks (cookie flags, origin guard, path validation, header stripping).");
