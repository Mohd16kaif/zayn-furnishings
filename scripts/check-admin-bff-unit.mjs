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
import {
  getOrCreateOrderIdempotencyKey,
  resetOrderIdempotencyMemoryForTests,
} from "../apps/web/src/lib/orderIdempotency.ts";
import { isUuidV4 } from "../packages/shared/src/orderIdempotency.ts";
import { apiBaseUrl } from "../apps/web/src/lib/apiBaseUrl.ts";
import { isSameOriginRequest } from "../apps/web/src/lib/requestGuards.ts";

const SITE = "http://localhost:3000";
process.env.NEXT_PUBLIC_SITE_URL = SITE;

const originalPublicApiUrl = process.env.NEXT_PUBLIC_API_URL;
const originalInternalApiUrl = process.env.API_INTERNAL_URL;

try {
  delete process.env.NEXT_PUBLIC_API_URL;
  delete process.env.API_INTERNAL_URL;
  assert.equal(apiBaseUrl(), "http://localhost:4000");

  process.env.NEXT_PUBLIC_API_URL = "http://public-api.example.test";
  assert.equal(apiBaseUrl(), "http://public-api.example.test");

  process.env.API_INTERNAL_URL = "  http://api:4000  ";
  assert.equal(apiBaseUrl(), "http://api:4000");

  process.env.API_INTERNAL_URL = "";
  assert.equal(apiBaseUrl(), "http://public-api.example.test");

  process.env.API_INTERNAL_URL = "http://api-after-start:4000";
  assert.equal(apiBaseUrl(), "http://api-after-start:4000");
} finally {
  if (originalPublicApiUrl === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = originalPublicApiUrl;
  }

  if (originalInternalApiUrl === undefined) {
    delete process.env.API_INTERNAL_URL;
  } else {
    process.env.API_INTERNAL_URL = originalInternalApiUrl;
  }
}

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

function checkoutFingerprintInput(overrides = {}) {
  return {
    items: [
      { product_id: "11111111-1111-4111-8111-111111111111", quantity: 1 },
    ],
    zip: "11201",
    email: "customer@example.com",
    shipping_address: {
      name: "Jordan Lee",
      line1: "1 Main St",
      city: "Brooklyn",
      state: "NY",
      zip: "11201",
    },
    discount_code: "WELCOME10",
    ...overrides,
  };
}

function memoryStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const blockedStorage = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
  removeItem() {
    throw new Error("blocked");
  },
};

resetOrderIdempotencyMemoryForTests();
const storage = memoryStorage();
const firstKey = getOrCreateOrderIdempotencyKey(
  checkoutFingerprintInput(),
  storage,
);
const sameKey = getOrCreateOrderIdempotencyKey(
  checkoutFingerprintInput({
    email: "CUSTOMER@EXAMPLE.COM",
    discount_code: "welcome10",
  }),
  storage,
);
const changedKey = getOrCreateOrderIdempotencyKey(
  checkoutFingerprintInput({
    items: [
      { product_id: "11111111-1111-4111-8111-111111111111", quantity: 2 },
    ],
  }),
  storage,
);

assert.equal(isUuidV4(firstKey), true);
assert.equal(firstKey, sameKey);
assert.notEqual(firstKey, changedKey);
assert.equal(isUuidV4(changedKey), true);

resetOrderIdempotencyMemoryForTests();
const emptyStorageKey = getOrCreateOrderIdempotencyKey(
  checkoutFingerprintInput(),
  null,
);
assert.equal(isUuidV4(emptyStorageKey), true);

resetOrderIdempotencyMemoryForTests();
const blockedKey = getOrCreateOrderIdempotencyKey(
  checkoutFingerprintInput(),
  blockedStorage,
);
const blockedKeyAgain = getOrCreateOrderIdempotencyKey(
  checkoutFingerprintInput(),
  blockedStorage,
);
assert.equal(isUuidV4(blockedKey), true);
assert.equal(blockedKey, blockedKeyAgain);

resetOrderIdempotencyMemoryForTests();
const malformedStorage = memoryStorage();
malformedStorage.setItem("zf-checkout-idempotency-v1", "not-json");
const rotatedKey = getOrCreateOrderIdempotencyKey(
  checkoutFingerprintInput(),
  malformedStorage,
);
assert.equal(isUuidV4(rotatedKey), true);
assert.notEqual(rotatedKey, blockedKey);

console.log("PASS: admin BFF unit checks (cookie flags, origin guard, path validation, header stripping, internal API URL, order idempotency keys).");
