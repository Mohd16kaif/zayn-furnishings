import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appEnv: "development" as string,
  resendApiKey: undefined as string | undefined,
  emailFrom: undefined as string | undefined,
  storefrontKey: "test-storefront-key",
  requestResult: {
    sent: false,
    code: null,
    admin: null,
  } as Record<string, unknown>,
  verifyResult: {
    ok: false,
    reason: "invalid",
  } as Record<string, unknown>,
  revokeResult: false,
  requestCalls: [] as unknown[][],
  verifyCalls: [] as unknown[][],
  revokeCalls: [] as unknown[][],
  send: vi.fn(async () => ({ providerMessageId: "pm_test" })),
}));

vi.mock("../src/config/env", () => ({
  env: {
    get APP_ENV() {
      return state.appEnv;
    },
    get RESEND_API_KEY() {
      return state.resendApiKey;
    },
    get EMAIL_FROM() {
      return state.emailFrom;
    },
    get STOREFRONT_API_KEY() {
      return state.storefrontKey;
    },
  },
  adminAuthSecretIsDevFallback: false,
}));

vi.mock("../src/db/client", () => ({
  db: {},
  connection: null,
}));

vi.mock("../src/lib/storeSettings", () => ({
  readStoreSettings: async () => ({
    store_name: "Test Store",
  }),
}));

vi.mock("../src/emails/sender", () => ({
  getEmailSender: () => ({
    name: "log",
    send: state.send,
  }),
}));

vi.mock("../src/emails/outbox", () => ({
  maskEmailAddress: (email: string) => {
    const [local, domain] = email.split("@");
    return `${local.slice(0, 1)}***@${domain}`;
  },
}));

vi.mock("../src/lib/adminAuthService", () => ({
  requestAdminLoginCode: vi.fn(async (...args: unknown[]) => {
    state.requestCalls.push(args);
    return state.requestResult;
  }),
  verifyAdminLoginCode: vi.fn(async (...args: unknown[]) => {
    state.verifyCalls.push(args);
    return state.verifyResult;
  }),
  revokeAdminSession: vi.fn(async (...args: unknown[]) => {
    state.revokeCalls.push(args);
    return state.revokeResult;
  }),
}));

import { adminCodeAuthRouter } from "../src/routes/adminCodeAuth";

let server: Server;
let baseUrl: string;
let counter = 0;

function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

async function post(
  path: string,
  body: unknown,
  options: {
    key?: string | null;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `203.0.113.${counter % 250}`,
    ...options.headers,
  };
  const key = options.key === undefined ? state.storefrontKey : options.key;

  if (key) {
    headers["x-storefront-key"] = key;
  }

  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  state.appEnv = "development";
  state.resendApiKey = undefined;
  state.emailFrom = undefined;
  state.requestResult = { sent: false, code: null, admin: null };
  state.verifyResult = { ok: false, reason: "invalid" };
  state.revokeResult = false;
  state.requestCalls = [];
  state.verifyCalls = [];
  state.revokeCalls = [];
  state.send.mockReset();
  state.send.mockResolvedValue({ providerMessageId: "pm_test" });

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/admin", adminCodeAuthRouter);

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
  vi.restoreAllMocks();
});

describe("POST /admin/auth/code/request", () => {
  it("rejects requests without a storefront key", async () => {
    const response = await post(
      "/admin/auth/code/request",
      { email: uniqueEmail("nokey") },
      { key: null },
    );

    expect(response.status).toBe(401);
    expect(state.requestCalls).toHaveLength(0);
  });

  it("returns the same generic body and sends nothing for unknown email", async () => {
    const email = uniqueEmail("unknown");
    const response = await post("/admin/auth/code/request", { email });
    const firstBody = await response.json();

    expect(response.status).toBe(200);
    expect(firstBody).toEqual({
      message:
        "If this email belongs to an active admin, a sign-in code was sent.",
    });
    expect(state.send).not.toHaveBeenCalled();
    expect(state.requestCalls).toHaveLength(1);
    expect(state.requestCalls[0]?.[1]).toMatchObject({ email });

    state.requestResult = {
      sent: false,
      code: null,
      admin: null,
    };
    const inactive = await post("/admin/auth/code/request", {
      email: uniqueEmail("inactive"),
    });

    expect(await inactive.json()).toEqual(firstBody);
  });

  it("sends a code email and prints DEV ONLY only in development without a provider", async () => {
    const email = uniqueEmail("active");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    state.requestResult = {
      sent: true,
      code: "123456",
      admin: {
        id: "admin-1",
        email,
        name: "Owner",
        role: "owner",
      },
    };

    const response = await post("/admin/auth/code/request", { email });

    expect(response.status).toBe(200);
    expect(state.send).toHaveBeenCalledTimes(1);
    const message = (state.send.mock.calls[0] as unknown[])[0] as {
      to: string;
      subject: string;
      text: string;
    };
    expect(message.to).toBe(email);
    expect(message.subject).toContain("admin sign-in code");
    expect(message.text).toContain("123456");
    expect(
      log.mock.calls.some(
        ([line]) =>
          typeof line === "string" &&
          line.includes("DEV ONLY") &&
          line.includes("123456"),
      ),
    ).toBe(true);
  });

  it("never prints the code in staging or when a provider is configured", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    state.requestResult = {
      sent: true,
      code: "654321",
      admin: {
        id: "admin-1",
        email: "owner@example.com",
        name: "Owner",
        role: "owner",
      },
    };

    state.appEnv = "staging";
    state.resendApiKey = "re_test";
    state.emailFrom = "orders@example.com";

    expect(
      (
        await post("/admin/auth/code/request", {
          email: uniqueEmail("staging"),
        })
      ).status,
    ).toBe(200);
    expect(log).not.toHaveBeenCalled();

    state.appEnv = "development";
    expect(
      (
        await post("/admin/auth/code/request", {
          email: uniqueEmail("provider"),
        })
      ).status,
    ).toBe(200);
    expect(log).not.toHaveBeenCalled();
  });

  it("does not log the code when email delivery fails", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    state.appEnv = "staging";
    state.resendApiKey = "re_test";
    state.emailFrom = "orders@example.com";
    state.requestResult = {
      sent: true,
      code: "987654",
      admin: {
        id: "admin-1",
        email: "owner@example.com",
        name: "Owner",
        role: "owner",
      },
    };
    state.send.mockRejectedValueOnce(new Error("provider unavailable"));

    const response = await post("/admin/auth/code/request", {
      email: uniqueEmail("failure"),
    });

    expect(response.status).toBe(200);
    expect(error).toHaveBeenCalled();
    const serialized = JSON.stringify(error.mock.calls);
    expect(serialized).not.toContain("987654");
  });
});

describe("POST /admin/auth/code/verify", () => {
  it("returns the session and admin on success", async () => {
    const email = uniqueEmail("verify");
    state.verifyResult = {
      ok: true,
      sessionToken: "session-token",
      expiresAt: new Date("2026-01-08T00:00:00.000Z"),
      admin: {
        id: "admin-1",
        email,
        name: "Staffer",
        role: "staff",
      },
    };

    const response = await post("/admin/auth/code/verify", {
      email,
      code: "123456",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sessionToken: "session-token",
      expiresAt: "2026-01-08T00:00:00.000Z",
      admin: {
        email,
        name: "Staffer",
        role: "staff",
      },
    });
    expect(state.verifyCalls).toHaveLength(1);
    expect(state.verifyCalls[0]?.[1]).toMatchObject({
      email,
      code: "123456",
    });
  });

  it("returns one identical generic failure for invalid and locked codes", async () => {
    state.verifyResult = { ok: false, reason: "invalid" };
    const invalid = await post("/admin/auth/code/verify", {
      email: uniqueEmail("invalid"),
      code: "123456",
    });

    state.verifyResult = { ok: false, reason: "locked" };
    const locked = await post("/admin/auth/code/verify", {
      email: uniqueEmail("locked"),
      code: "123456",
    });
    const invalidBody = await invalid.json();
    const lockedBody = await locked.json();

    expect(invalid.status).toBe(401);
    expect(locked.status).toBe(401);
    expect(invalidBody).toEqual(lockedBody);
    expect(invalidBody).toEqual({
      error: "Invalid or expired code.",
    });
  });

  it("rejects malformed bodies with the same failure and no lookup", async () => {
    const response = await post("/admin/auth/code/verify", {
      email: "not-an-email",
      code: "abc",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Invalid or expired code.",
    });
    expect(state.verifyCalls).toHaveLength(0);
  });

  it("rejects requests without a storefront key", async () => {
    const response = await post(
      "/admin/auth/code/verify",
      { email: uniqueEmail("nokey"), code: "123456" },
      { key: null },
    );

    expect(response.status).toBe(401);
    expect(state.verifyCalls).toHaveLength(0);
  });
});

describe("POST /admin/auth/logout", () => {
  it("revokes the presented session", async () => {
    state.revokeResult = true;

    const response = await post(
      "/admin/auth/logout",
      {},
      { headers: { "x-admin-session": "session-token" } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(state.revokeCalls[0]?.[1]).toBe("session-token");
  });

  it("rejects missing or already-revoked sessions", async () => {
    const missing = await post("/admin/auth/logout", {});

    expect(missing.status).toBe(401);
    expect(state.revokeCalls).toHaveLength(0);

    state.revokeResult = false;
    const revoked = await post(
      "/admin/auth/logout",
      {},
      { headers: { "x-admin-session": "old-token" } },
    );

    expect(revoked.status).toBe(401);
  });

  it("rejects requests without a storefront key", async () => {
    const response = await post(
      "/admin/auth/logout",
      {},
      {
        key: null,
        headers: { "x-admin-session": "session-token" },
      },
    );

    expect(response.status).toBe(401);
    expect(state.revokeCalls).toHaveLength(0);
  });
});
