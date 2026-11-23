import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import {
  generateSessionToken,
  hashSessionToken,
} from "./sessionTokens";

export const ADMIN_LOGIN_CODE_LENGTH = 6;
export const ADMIN_LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
export const ADMIN_LOGIN_CODE_MAX_ATTEMPTS = 5;
export const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ADMIN_SESSION_LAST_USED_TOUCH_MS = 5 * 60 * 1000;
export const ADMIN_USER_AGENT_MAX_LENGTH = 255;

export function normalizeAdminEmail(email: unknown): string | null {
  if (typeof email !== "string") {
    return null;
  }

  const normalized = email.trim().toLowerCase();

  return normalized === "" ? null : normalized;
}

export function generateAdminLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(
    ADMIN_LOGIN_CODE_LENGTH,
    "0",
  );
}

export function hashAdminLoginCode(
  email: string,
  code: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${normalizeAdminEmail(email) ?? ""}:${code}`)
    .digest("hex");
}

export function adminLoginCodeMatches(
  email: string,
  code: string,
  secret: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(
    hashAdminLoginCode(email, code, secret),
    "utf8",
  );
  const expected = Buffer.from(expectedHash, "utf8");

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

export function adminLoginCodeExpiry(now: Date): Date {
  return new Date(now.getTime() + ADMIN_LOGIN_CODE_TTL_MS);
}

export function adminSessionExpiry(now: Date): Date {
  return new Date(now.getTime() + ADMIN_SESSION_TTL_MS);
}

export {
  generateSessionToken as generateAdminSessionToken,
  hashSessionToken as hashAdminSessionToken,
};
