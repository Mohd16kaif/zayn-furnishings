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

describe("media env validation", () => {
  it("defaults to the Supabase driver and 500 MB free-space guard", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "development",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.MEDIA_DRIVER).toBe("supabase");
      expect(result.data.MEDIA_MIN_FREE_MB).toBe(500);
    }
  });

  it("allows the local driver in development without MEDIA_DIR or base URL", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "development",
      MEDIA_DRIVER: "local",
    });

    expect(result.success).toBe(true);
  });

  it("requires MEDIA_DIR and MEDIA_PUBLIC_BASE_URL for local in staging", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "staging",
      ADMIN_AUTH_SECRET: ADMIN_SECRET,
      MEDIA_DRIVER: "local",
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(
      expect.arrayContaining([
        "MEDIA_DIR",
        "MEDIA_PUBLIC_BASE_URL",
      ]),
    );
  });

  it("requires MEDIA_DIR and MEDIA_PUBLIC_BASE_URL for local in production", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "production",
      ADMIN_AUTH_SECRET: ADMIN_SECRET,
      MEDIA_DRIVER: "local",
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(
      expect.arrayContaining([
        "MEDIA_DIR",
        "MEDIA_PUBLIC_BASE_URL",
      ]),
    );
  });

  it("accepts local in staging with an absolute dir and base URL", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "staging",
      ADMIN_AUTH_SECRET: ADMIN_SECRET,
      MEDIA_DRIVER: "local",
      MEDIA_DIR: path.resolve("media-data"),
      MEDIA_PUBLIC_BASE_URL: "https://api.example.com",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a relative MEDIA_DIR", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "development",
      MEDIA_DRIVER: "local",
      MEDIA_DIR: "media-data",
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("MEDIA_DIR");
  });

  it("rejects a non-http media public base URL", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "development",
      MEDIA_DRIVER: "local",
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

  it("treats an empty MEDIA_DRIVER as the default", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "development",
      APP_ENV: "development",
      MEDIA_DRIVER: "",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.MEDIA_DRIVER).toBe("supabase");
    }
  });
});
