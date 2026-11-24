import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  findAdminByAdminSession: vi.fn(),
  requestAdminLoginCode: vi.fn(),
  verifyAdminLoginCode: vi.fn(),
  revokeAdminSession: vi.fn(),
  readStoreSettings: vi.fn(),
}));

vi.mock("../src/config/env", () => ({
  env: {
    NODE_ENV: "test",
    APP_ENV: "development",
    PORT: 4000,
    DATABASE_URL: "postgres://localhost/test",
    STOREFRONT_API_KEY: "test-storefront-key",
    WEB_ORIGIN: "http://localhost:3000",
  },
}));

vi.mock("../src/lib/adminAuthService", () => ({
  findAdminByAdminSession: state.findAdminByAdminSession,
  requestAdminLoginCode: state.requestAdminLoginCode,
  verifyAdminLoginCode: state.verifyAdminLoginCode,
  revokeAdminSession: state.revokeAdminSession,
}));

vi.mock("../src/lib/storeSettings", () => ({
  readStoreSettings: state.readStoreSettings,
}));

vi.mock("../src/db/client", () => {
  function insertBuilder() {
    const builder = {
      values() {
        return {
          onConflictDoUpdate: async () => undefined,
          then(
            resolve: (value: undefined) => unknown,
            reject: (reason: unknown) => unknown,
          ) {
            return Promise.resolve(undefined).then(resolve, reject);
          },
        };
      },
    };

    return builder;
  }

  return {
    db: {
      transaction: async (
        callback: (tx: { insert: typeof insertBuilder }) => unknown,
      ) => callback({ insert: insertBuilder }),
    },
    connection: null,
  };
});

import { adminCodeAuthRouter } from "../src/routes/adminCodeAuth";
import { adminProductsRouter } from "../src/routes/adminProducts";
import { adminSettingsRouter } from "../src/routes/adminSettings";

let server: Server;
let baseUrl: string;

const ADMIN = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  role: "owner" as const,
};

const STORE_SETTINGS = {
  store_name: "Test Store",
  phone: "",
  email: "",
  free_delivery_threshold_cents: null,
  show_financing: false,
  store_open: true,
};

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function patch(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function get(
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers });
}

beforeEach(async () => {
  state.findAdminByAdminSession.mockReset();
  state.findAdminByAdminSession.mockResolvedValue({
    admin: ADMIN,
    sessionId: "session-1",
  });
  state.requestAdminLoginCode.mockReset();
  state.verifyAdminLoginCode.mockReset();
  state.revokeAdminSession.mockReset();
  state.readStoreSettings.mockReset();
  state.readStoreSettings.mockResolvedValue(STORE_SETTINGS);

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/admin", adminCodeAuthRouter);
  app.use("/admin", adminProductsRouter);
  app.use("/admin", adminSettingsRouter);

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});

describe("admin auth route mounting regression", () => {
  it("returns 404 for the removed OTP request route", async () => {
    const response = await post("/admin/auth/otp/request", {
      email: "admin@example.com",
    });

    expect(response.status).toBe(404);
  });

  it("rejects a bearer token on GET /admin/me", async () => {
    const response = await get("/admin/me", {
      authorization: "Bearer any-token",
    });

    expect(response.status).toBe(401);
  });

  it("rejects a bearer token on GET /admin/products", async () => {
    const response = await get("/admin/products", {
      authorization: "Bearer any-token",
    });

    expect(response.status).toBe(401);
  });

  it("accepts a valid x-admin-session for GET /admin/me", async () => {
    const response = await get("/admin/me", {
      "x-admin-session": "session-token",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      email: "admin@example.com",
      role: "owner",
    });
  });

  it("accepts a valid x-admin-session for a write route", async () => {
    const response = await patch(
      "/admin/settings",
      { store_open: true },
      { "x-admin-session": "session-token" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      store_open: true,
    });
  });

  it("still requires the storefront key on the new code request", async () => {
    const response = await post("/admin/auth/code/request", {
      email: "admin@example.com",
    });

    expect(response.status).toBe(401);
  });

  it("still requires the storefront key on the new code verify", async () => {
    const response = await post("/admin/auth/code/verify", {
      email: "admin@example.com",
      code: "123456",
    });

    expect(response.status).toBe(401);
  });

  it("still requires the storefront key on the new logout", async () => {
    const response = await post(
      "/admin/auth/logout",
      {},
      { "x-admin-session": "session-token" },
    );

    expect(response.status).toBe(401);
  });

  it("keeps protected admin routes protected", async () => {
    const response = await get("/admin/products");

    expect(response.status).toBe(401);
  });
});
