import { describe, expect, it } from "vitest";
import {
  liveStripeKeyOutsideProductionError,
  stripeKeyKind,
  testStripeKeyInProductionWarning,
} from "../src/lib/stripeKeyGuard";

const LIVE_KEYS = ["sk_live_abc123", "rk_live_abc123"];
const TEST_KEYS = ["sk_test_abc123", "rk_test_abc123"];

describe("stripeKeyKind", () => {
  it("classifies live, test, missing, and unknown keys", () => {
    for (const key of LIVE_KEYS) {
      expect(stripeKeyKind(key)).toBe("live");
    }

    for (const key of TEST_KEYS) {
      expect(stripeKeyKind(key)).toBe("test");
    }

    expect(stripeKeyKind(undefined)).toBe("missing");
    expect(stripeKeyKind(null)).toBe("missing");
    expect(stripeKeyKind("")).toBe("missing");
    expect(stripeKeyKind("   ")).toBe("missing");
    expect(stripeKeyKind("pk_test_abc123")).toBe("unknown");
  });
});

describe("liveStripeKeyOutsideProductionError", () => {
  it("refuses live keys in development and staging", () => {
    for (const appEnv of ["development", "staging"] as const) {
      for (const key of LIVE_KEYS) {
        const message = liveStripeKeyOutsideProductionError(appEnv, key);

        expect(message).toContain("Refusing to start");
        expect(message).toContain(appEnv);
        expect(message).not.toContain(key);
      }
    }
  });

  it("allows live keys in production", () => {
    for (const key of LIVE_KEYS) {
      expect(liveStripeKeyOutsideProductionError("production", key)).toBe(
        null,
      );
    }
  });

  it("allows test and missing keys outside production", () => {
    for (const appEnv of ["development", "staging"] as const) {
      for (const key of TEST_KEYS) {
        expect(liveStripeKeyOutsideProductionError(appEnv, key)).toBe(null);
      }

      expect(
        liveStripeKeyOutsideProductionError(appEnv, undefined),
      ).toBe(null);
    }
  });
});

describe("testStripeKeyInProductionWarning", () => {
  it("warns once at startup for a test key in production without printing it", () => {
    for (const key of TEST_KEYS) {
      const warning = testStripeKeyInProductionWarning("production", key);

      expect(warning).toContain("WARNING");
      expect(warning).toContain("TEST key");
      expect(warning).not.toContain(key);
    }
  });

  it("does not warn for live keys in production or test keys elsewhere", () => {
    for (const key of LIVE_KEYS) {
      expect(testStripeKeyInProductionWarning("production", key)).toBe(null);
    }

    for (const appEnv of ["development", "staging"] as const) {
      for (const key of TEST_KEYS) {
        expect(testStripeKeyInProductionWarning(appEnv, key)).toBe(null);
      }
    }
  });
});
