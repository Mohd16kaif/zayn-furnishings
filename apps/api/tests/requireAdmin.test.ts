import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  findAdminByAdminSession: vi.fn(),
}));

vi.mock("../src/lib/adminAuthService", () => ({
  findAdminByAdminSession: state.findAdminByAdminSession,
}));

vi.mock("../src/db/client", () => ({
  db: {},
  connection: null,
}));

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
  state.findAdminByAdminSession.mockReset();
});

describe("requireAdmin session authentication", () => {
  it("accepts a valid x-admin-session header", async () => {
    state.findAdminByAdminSession.mockResolvedValue({
      admin: {
        id: "admin-1",
        email: "admin@example.com",
        name: "Admin",
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
      email: "admin@example.com",
      role: "staff",
    });
    expect(state.findAdminByAdminSession).toHaveBeenCalledWith(
      expect.anything(),
      "session-token",
    );
  });

  it("rejects a bearer token without x-admin-session", async () => {
    const req = request({
      authorization: "Bearer any-token",
    });
    const res = response();
    const next = vi.fn();

    await requireAdmin(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(state.findAdminByAdminSession).not.toHaveBeenCalled();
  });

  it("does not fall back to a bearer token when the session is invalid", async () => {
    state.findAdminByAdminSession.mockResolvedValue(null);
    const req = request({
      "x-admin-session": "bad-session",
      authorization: "Bearer any-token",
    });
    const res = response();
    const next = vi.fn();

    await requireAdmin(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
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
