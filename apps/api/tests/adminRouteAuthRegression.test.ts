import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  admin: {
    id: "admin-1",
    authUserId: "supabase-user-1",
    email: "admin@example.com",
    name: "Admin",
    role: "owner" as "owner" | "staff",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  } as Record<string, unknown> | null,
  sessionLookup: null as Record<string, unknown> | null,
  signInWithOtp: vi.fn(),
  getUser: vi.fn(),
  findAdminByAdminSession: vi.fn(),
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

vi.mock("../src/lib/supabase", () => ({
  getSupabaseAnon: () => ({
    auth: {
      signInWithOtp: state.signInWithOtp,
    },
  }),
  getSupabaseAdmin: () => ({
    auth: {
      getUser: state.getUser,
    },
  }),
}));

vi.mock("../src/lib/adminAuthService", () => ({
  findAdminByAdminSession: state.findAdminByAdminSession,
  requestAdminLoginCode: vi.fn(),
  verifyAdminLoginCode: vi.fn(),
  revokeAdminSession: vi.fn(),
}));

vi.mock("../src/db/client", async () => {
  const { adminUsers } = await import("../src/db/schema");

  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () =>
              table === adminUsers && state.admin ? [state.admin] : [],
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
      insert: () => ({
        values: async () => undefined,
      }),
    },
    connection: null,
  };
});

import { adminAuthRouter } from "../src/routes/adminAuth";
import { adminCodeAuthRouter } from "../src/routes/adminCodeAuth";
import { adminProductsRouter } from "../src/routes/adminProducts";

let server: Server;
let baseUrl: string;

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

async function get(
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers });
}

beforeEach(async () => {
  state.admin = {
    id: "admin-1",
    authUserId: "supabase-user-1",
    email: "admin@example.com",
    name: "Admin",
    role: "owner",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  state.sessionLookup = null;
  state.signInWithOtp.mockReset();
  state.signInWithOtp.mockResolvedValue({ error: null });
  state.getUser.mockReset();
  state.getUser.mockResolvedValue({
    data: {
      user: {
        id: "supabase-user-1",
        email: "admin@example.com",
        email_confirmed_at: "2026-01-01T00:00:00.000Z",
      },
    },
    error: null,
  });
  state.findAdminByAdminSession.mockReset();
  state.findAdminByAdminSession.mockResolvedValue(null);

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  // Keep the same mounting order as apps/api/src/index.ts.
  app.use("/admin", adminCodeAuthRouter);
  app.use("/admin", adminAuthRouter);
  app.use("/admin", adminProductsRouter);

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
  it("keeps the old Supabase OTP request public for a known email", async () => {
    const response = await post("/admin/auth/otp/request", {
      email: "admin@example.com",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "If this email is registered, a code was sent",
    });
    expect(state.signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it("keeps the old Supabase OTP request public for an unknown email", async () => {
    state.admin = null;

    const response = await post("/admin/auth/otp/request", {
      email: "nobody@example.com",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "If this email is registered, a code was sent",
    });
    expect(state.signInWithOtp).not.toHaveBeenCalled();
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

  it("requires credentials for GET /admin/me", async () => {
    const response = await get("/admin/me");

    expect(response.status).toBe(401);
  });

  it("accepts a valid Supabase bearer token for GET /admin/me", async () => {
    const response = await get("/admin/me", {
      authorization: "Bearer supabase-token",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      email: "admin@example.com",
      role: "owner",
    });
  });

  it("accepts a valid new admin session for GET /admin/me", async () => {
    state.findAdminByAdminSession.mockResolvedValue({
      admin: {
        id: "new-admin",
        email: "new@example.com",
        name: "New",
        role: "staff",
      },
      sessionId: "session-1",
    });

    const response = await get("/admin/me", {
      "x-admin-session": "session-token",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      email: "new@example.com",
      role: "staff",
    });
  });

  it("keeps protected admin routes protected", async () => {
    const response = await get("/admin/products");

    expect(response.status).toBe(401);
  });
});
