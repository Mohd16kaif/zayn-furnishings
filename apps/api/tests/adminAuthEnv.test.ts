import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEV_ADMIN_AUTH_SECRET,
  envSchema,
} from "../src/config/envSchema";

function adminSecretIssues(result: {
  success: boolean;
  error?: { issues: Array<{ path: PropertyKey[] }> };
}): number {
  if (result.success) {
    return 0;
  }

  return (
    result.error?.issues.filter(
      (issue) => issue.path[0] === "ADMIN_AUTH_SECRET",
    ).length ?? 0
  );
}

describe("ADMIN_AUTH_SECRET env validation", () => {
  it("allows an unset secret in development and provides a dev fallback", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "development",
    });

    expect(result.success).toBe(true);
    expect(DEV_ADMIN_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it("requires the secret in staging", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "staging",
    });

    expect(result.success).toBe(false);
    expect(adminSecretIssues(result)).toBe(1);
  });

  it("requires the secret in production", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "production",
    });

    expect(result.success).toBe(false);
    expect(adminSecretIssues(result)).toBe(1);
  });

  it("rejects a short secret in development", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "development",
      ADMIN_AUTH_SECRET: "too-short",
    });

    expect(result.success).toBe(false);
    expect(adminSecretIssues(result)).toBe(1);
  });

  it("accepts a 32-character secret in staging", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "staging",
      ADMIN_AUTH_SECRET: "a".repeat(32),
      MEDIA_DIR: path.resolve("media-data"),
      MEDIA_PUBLIC_BASE_URL: "https://api.example.com",
    });

    expect(result.success).toBe(true);
  });
});
