import { describe, expect, it } from "vitest";
import {
  defaultStoreOpen,
  resolveAppEnv,
  type AppEnv,
} from "../src/appEnv";

describe("resolveAppEnv", () => {
  it("accepts explicit development, staging, and production values", () => {
    const matrix: Array<[string, string, AppEnv]> = [
      ["development", "development", "development"],
      ["development", "production", "development"],
      ["staging", "development", "staging"],
      ["staging", "production", "staging"],
      ["production", "development", "production"],
      ["production", "production", "production"],
    ];

    for (const [value, nodeEnv, expected] of matrix) {
      expect(resolveAppEnv(value, nodeEnv)).toBe(expected);
    }
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(resolveAppEnv(" STAGING ", "production")).toBe("staging");
    expect(resolveAppEnv("Production", "development")).toBe("production");
    expect(resolveAppEnv("\tDevelopment\n", "production")).toBe(
      "development",
    );
  });

  it("falls back to development outside a production Node environment", () => {
    const matrix: Array<string | undefined> = [
      undefined,
      "",
      "   ",
      "test",
      "stagin",
      "live",
    ];

    for (const value of matrix) {
      expect(resolveAppEnv(value, "development")).toBe("development");
      expect(resolveAppEnv(value, "test")).toBe("development");
    }
  });

  it("falls back to production when NODE_ENV is production", () => {
    expect(resolveAppEnv(undefined, "production")).toBe("production");
    expect(resolveAppEnv("", "production")).toBe("production");
    expect(resolveAppEnv("unknown", "production")).toBe("production");
    expect(resolveAppEnv(null, "production")).toBe("production");
  });
});

describe("defaultStoreOpen", () => {
  it("keeps the store closed by default in production", () => {
    expect(defaultStoreOpen("production")).toBe(false);
  });

  it("keeps the store open by default in development and staging", () => {
    expect(defaultStoreOpen("development")).toBe(true);
    expect(defaultStoreOpen("staging")).toBe(true);
  });
});
