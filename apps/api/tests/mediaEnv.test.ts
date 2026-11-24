import path from "node:path";
import { describe, expect, it } from "vitest";
import { envSchema } from "../src/config/envSchema";

function issuePaths(result: {
  success: boolean;
  error?: { issues: Array<{ path: PropertyKey[] }> };
}): string[] {
  if (result.success) {
    return [];
  }

  return (
    result.error?.issues.map((issue) => String(issue.path[0])) ?? []
  );
}

const ADMIN_SECRET = "a".repeat(32);
const MEDIA_DIR = path.resolve("media-data");
const MEDIA_BASE_URL = "https://api.example.com";
const PRODUCTION_CORE = {
  ADMIN_AUTH_SECRET: ADMIN_SECRET,
  DATABASE_URL: "postgres://user:pass@localhost:5432/store",
  MEDIA_DIR,
  MEDIA_PUBLIC_BASE_URL: MEDIA_BASE_URL,
  STRIPE_SECRET_KEY: "sk_test_example",
  STRIPE_WEBHOOK_SECRET: "whsec_example",
};

describe("core env validation", () => {
  it("defaults the media free-space guard in development", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "development",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.MEDIA_MIN_FREE_MB).toBe(500);
    }
  });

  it("allows development without media location settings", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "development",
    });

    expect(result.success).toBe(true);
  });

  it("parses staging with only the core service settings", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "staging",
      ADMIN_AUTH_SECRET: ADMIN_SECRET,
      MEDIA_DIR,
      MEDIA_PUBLIC_BASE_URL: MEDIA_BASE_URL,
    });

    expect(result.success).toBe(true);
  });

  it("parses production with only the core service settings", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "production",
      APP_ENV: "production",
      ...PRODUCTION_CORE,
    });

    expect(result.success).toBe(true);
  });

  it("ignores unused legacy variables instead of rejecting startup", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "development",
      UNUSED_LEGACY_URL: "https://old.example.com",
      UNUSED_LEGACY_KEY: "unused",
    });

    expect(result.success).toBe(true);
  });

  it("requires media settings in staging", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "staging",
      ADMIN_AUTH_SECRET: ADMIN_SECRET,
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(
      expect.arrayContaining([
        "MEDIA_DIR",
        "MEDIA_PUBLIC_BASE_URL",
      ]),
    );
  });

  it("requires media settings in production", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "production",
      APP_ENV: "production",
      ADMIN_AUTH_SECRET: ADMIN_SECRET,
      DATABASE_URL: PRODUCTION_CORE.DATABASE_URL,
      STRIPE_SECRET_KEY: PRODUCTION_CORE.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: PRODUCTION_CORE.STRIPE_WEBHOOK_SECRET,
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(
      expect.arrayContaining([
        "MEDIA_DIR",
        "MEDIA_PUBLIC_BASE_URL",
      ]),
    );
  });

  it("rejects a relative MEDIA_DIR", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "development",
      MEDIA_DIR: "media-data",
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("MEDIA_DIR");
  });

  it("rejects a non-http media public base URL", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "development",
      MEDIA_PUBLIC_BASE_URL: "ftp://example.com",
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("MEDIA_PUBLIC_BASE_URL");
  });

  it("rejects an invalid MEDIA_MIN_FREE_MB", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "development",
      MEDIA_MIN_FREE_MB: "-1",
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("MEDIA_MIN_FREE_MB");
  });
});
