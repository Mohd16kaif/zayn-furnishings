import { createHash } from "node:crypto";
import {
  canonicalOrderIdempotencyFingerprint,
  type OrderIdempotencyFingerprintInput,
} from "@zayn/shared";

export function computeOrderIdempotencyFingerprint(
  input: OrderIdempotencyFingerprintInput,
): string {
  return createHash("sha256")
    .update(canonicalOrderIdempotencyFingerprint(input))
    .digest("hex");
}

export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }

    const candidate = current as {
      code?: unknown;
      cause?: unknown;
    };

    if (candidate.code === "23505") {
      return true;
    }

    current = candidate.cause;
  }

  return false;
}
