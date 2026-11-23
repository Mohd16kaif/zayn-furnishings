import { describe, expect, it, vi, beforeEach } from "vitest";

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
  findAdminByAdminSession: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("../src/lib/adminAuthService", () => ({
  findAdminByAdminSession: state.findAdminByAdminSession,
}));

vi.mock("../src/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      getUser: state.getUser,
    },
  }),
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

import { requireAdmin } from "../src/middleware/requireAdmin";

type TestRequest = {
  headers: Record<string, string>;
  admin?: Record<string, unknown>;
  get(name: string): string | undefined;
};

function request(headers: Record<string, string> = {}): TestRequest {
  return {
    headers,
    get(name: string) {
      const key = Object.keys(headers).find(
        (candidate) => candidate.toLowerCase() === name.toLowerCase(),
      );

      return key ? headers[key] : undefined;
    },
  };
}

function response() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

beforeEach(() => {
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
  state.findAdminByAdminSession.mockReset();
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
});

describe("requireAdmin dual-mode authentication", () => {
  it("accepts the new admin session header", async () => {
    state.findAdminByAdminSession.mockResolvedValue({
      admin: {
        id: "new-admin",
        email: "new@example.com",
        name: "New",
        role: "staff",
      },
      sessionId: "session-1",
    });
    const req = request({ "x-admin-session": "session-token" });
    const res = response();
    const next = vi.fn();

    await requireAdmin(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.admin).toMatchObject({
      email: "new@example.com",
      role: "staff",
    });
    expect(state.findAdminByAdminSession).toHaveBeenCalledWith(
      expect.anything(),
      "session-token",
    );
    expect(state.getUser).not.toHaveBeenCalled();
  });

  it("prefers the new session when both credentials are present", async () => {
    state.findAdminByAdminSession.mockResolvedValue({
      admin: {
        id: "new-admin",
        email: "new@example.com",
        name: "New",
        role: "owner",
      },
      sessionId: "session-1",
    });
    const req = request({
      "x-admin-session": "session-token",
      authorization: "Bearer supabase-token",
    });
    const res = response();
    const next = vi.fn();

    await requireAdmin(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.admin).toMatchObject({ email: "new@example.com" });
    expect(state.getUser).not.toHaveBeenCalled();
  });

  it("rejects an invalid new session without falling back to Supabase", async () => {
    state.findAdminByAdminSession.mockResolvedValue(null);
    const req = request({
      "x-admin-session": "bad-session",
      authorization: "Bearer supabase-token",
    });
    const res = response();
    const next = vi.fn();

    await requireAdmin(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(state.getUser).not.toHaveBeenCalled();
  });

  it("still accepts the existing Supabase bearer token", async () => {
    const req = request({
      authorization: "Bearer supabase-token",
    });
    const res = response();
    const next = vi.fn();

    await requireAdmin(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.admin).toMatchObject({
      email: "admin@example.com",
      role: "owner",
    });
    expect(state.findAdminByAdminSession).not.toHaveBeenCalled();
    expect(state.getUser).toHaveBeenCalledWith("supabase-token");
  });

  it("rejects requests with no credentials", async () => {
    const req = request();
    const res = response();
    const next = vi.fn();

    await requireAdmin(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
