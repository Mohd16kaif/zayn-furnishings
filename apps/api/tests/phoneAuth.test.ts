import { describe, expect, it } from "vitest";
import {
  DevStubVerifier,
  selectPhoneVerifierName,
} from "../src/lib/phoneVerifier";
import {
  decideStartLimit,
  decideVerifyLock,
  type VerificationAttempt,
} from "../src/lib/verificationLimits";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function startAttempt(
  phone: string,
  minutesAgo: number,
  ip: string | null = "203.0.113.10",
): VerificationAttempt {
  return {
    phone,
    ip,
    kind: "start",
    success: true,
    createdAt: new Date(NOW.getTime() - minutesAgo * 60 * 1000),
  };
}

function failedCheck(phone: string, minutesAgo: number): VerificationAttempt {
  return {
    phone,
    ip: "203.0.113.10",
    kind: "check",
    success: false,
    createdAt: new Date(NOW.getTime() - minutesAgo * 60 * 1000),
  };
}

describe("DevStubVerifier", () => {
  it("throws when constructed in production", () => {
    expect(() => new DevStubVerifier("production")).toThrow(
      /cannot be used in production/i,
    );
  });

  it("accepts only the fixed code for a valid US number", async () => {
    const verifier = new DevStubVerifier("development");

    await expect(verifier.start("+14155550123")).resolves.toBeUndefined();
    await expect(verifier.check("+14155550123", "123456")).resolves.toBe(
      true,
    );
    await expect(verifier.check("+14155550123", "000000")).resolves.toBe(
      false,
    );
  });
});

describe("selectPhoneVerifierName", () => {
  const credentials = {
    accountSid: "AC_test",
    authToken: "token",
    verifyServiceSid: "VA_test",
  };

  it("selects Twilio when all credentials are present", () => {
    expect(selectPhoneVerifierName(credentials, "development")).toBe(
      "twilio",
    );
    expect(selectPhoneVerifierName(credentials, "production")).toBe(
      "twilio",
    );
  });

  it("selects the dev stub outside production when credentials are incomplete", () => {
    expect(
      selectPhoneVerifierName(
        { accountSid: "AC_test", authToken: "token" },
        "development",
      ),
    ).toBe("dev-stub");
    expect(selectPhoneVerifierName({}, "test")).toBe("dev-stub");
  });

  it("returns unavailable in production without Twilio", () => {
    expect(selectPhoneVerifierName({}, "production")).toBe("unavailable");
  });
});

describe("decideStartLimit", () => {
  it("allows a phone with fewer than three recent starts", () => {
    const decision = decideStartLimit(
      [startAttempt("+14155550123", 1), startAttempt("+14155550123", 2)],
      "+14155550123",
      "203.0.113.10",
      NOW,
    );

    expect(decision.allowed).toBe(true);
  });

  it("blocks the fourth start within ten minutes", () => {
    const attempts = [
      startAttempt("+14155550123", 1),
      startAttempt("+14155550123", 2),
      startAttempt("+14155550123", 3),
    ];
    const decision = decideStartLimit(
      attempts,
      "+14155550123",
      "203.0.113.10",
      NOW,
    );

    expect(decision.allowed).toBe(false);

    if (!decision.allowed) {
      expect(decision.retryAfterSeconds).toBeGreaterThan(0);
      expect(decision.retryAfterSeconds).toBeLessThanOrEqual(10 * 60);
    }
  });

  it("allows the phone again after the ten-minute window", () => {
    const attempts = [
      startAttempt("+14155550123", 11),
      startAttempt("+14155550123", 12),
      startAttempt("+14155550123", 13),
    ];
    const decision = decideStartLimit(
      attempts,
      "+14155550123",
      "203.0.113.10",
      NOW,
    );

    expect(decision.allowed).toBe(true);
  });
});

describe("decideVerifyLock", () => {
  it("does not lock after four failed checks", () => {
    const attempts = [
      failedCheck("+14155550123", 1),
      failedCheck("+14155550123", 2),
      failedCheck("+14155550123", 3),
      failedCheck("+14155550123", 4),
    ];
    const decision = decideVerifyLock(attempts, "+14155550123", NOW);

    expect(decision.allowed).toBe(true);
  });

  it("locks for fifteen minutes after five failed checks", () => {
    const attempts = [
      failedCheck("+14155550123", 1),
      failedCheck("+14155550123", 2),
      failedCheck("+14155550123", 3),
      failedCheck("+14155550123", 4),
      failedCheck("+14155550123", 5),
    ];
    const decision = decideVerifyLock(attempts, "+14155550123", NOW);

    expect(decision.allowed).toBe(false);

    if (!decision.allowed) {
      expect(decision.retryAfterSeconds).toBeGreaterThan(10 * 60);
      expect(decision.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    }
  });

  it("releases the lock after fifteen minutes", () => {
    const attempts = [
      failedCheck("+14155550123", 16),
      failedCheck("+14155550123", 16.5),
      failedCheck("+14155550123", 17),
      failedCheck("+14155550123", 17.5),
      failedCheck("+14155550123", 18),
    ];
    const decision = decideVerifyLock(attempts, "+14155550123", NOW);

    expect(decision.allowed).toBe(true);
  });
});
