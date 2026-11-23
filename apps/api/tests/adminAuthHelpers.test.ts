import { describe, expect, it } from "vitest";
import {
  ADMIN_LOGIN_CODE_LENGTH,
  ADMIN_LOGIN_CODE_TTL_MS,
  ADMIN_SESSION_TTL_MS,
  adminLoginCodeExpiry,
  adminLoginCodeMatches,
  adminSessionExpiry,
  generateAdminLoginCode,
  generateAdminSessionToken,
  hashAdminLoginCode,
  hashAdminSessionToken,
  normalizeAdminEmail,
} from "../src/lib/adminAuth";

const SECRET = "test-admin-auth-secret-at-least-32-chars";

describe("admin login code helpers", () => {
  it("generates a zero-padded six-digit code", () => {
    for (let index = 0; index < 200; index += 1) {
      const code = generateAdminLoginCode();

      expect(code).toMatch(/^\d{6}$/);
      expect(code).toHaveLength(ADMIN_LOGIN_CODE_LENGTH);
    }
  });

  it("stores only a deterministic HMAC-SHA256 hash, never the code", () => {
    const code = "012345";
    const hash = hashAdminLoginCode("Owner@Example.com", code, SECRET);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(code);
    expect(
      hashAdminLoginCode("owner@example.com", code, SECRET),
    ).toBe(hash);
    expect(
      hashAdminLoginCode("owner@example.com", "654321", SECRET),
    ).not.toBe(hash);
    expect(
      hashAdminLoginCode("owner@example.com", code, `${SECRET}-other`),
    ).not.toBe(hash);
  });

  it("compares hashes safely and rejects wrong or malformed hashes", () => {
    const hash = hashAdminLoginCode("owner@example.com", "123456", SECRET);

    expect(
      adminLoginCodeMatches("owner@example.com", "123456", SECRET, hash),
    ).toBe(true);
    expect(
      adminLoginCodeMatches("owner@example.com", "123457", SECRET, hash),
    ).toBe(false);
    expect(
      adminLoginCodeMatches("owner@example.com", "123456", SECRET, "abc"),
    ).toBe(false);
  });

  it("expires codes after ten minutes and sessions after seven days", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    expect(adminLoginCodeExpiry(now).getTime()).toBe(
      now.getTime() + ADMIN_LOGIN_CODE_TTL_MS,
    );
    expect(adminSessionExpiry(now).getTime()).toBe(
      now.getTime() + ADMIN_SESSION_TTL_MS,
    );
  });

  it("normalizes emails for lookup and hashing", () => {
    expect(normalizeAdminEmail("  Owner@Example.COM  ")).toBe(
      "owner@example.com",
    );
    expect(normalizeAdminEmail("")).toBeNull();
    expect(normalizeAdminEmail(null)).toBeNull();
    expect(normalizeAdminEmail(42)).toBeNull();
  });
});

describe("admin session token helpers", () => {
  it("generates a 32-byte base64url token and stores only its SHA-256 hash", () => {
    const token = generateAdminSessionToken();
    const hash = hashAdminSessionToken(token);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    expect(hashAdminSessionToken(token)).toBe(hash);
    expect(hashAdminSessionToken(`${token}x`)).not.toBe(hash);
  });
});
