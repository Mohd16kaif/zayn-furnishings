import {
  canonicalOrderIdempotencyFingerprint,
  isUuidV4,
  type OrderIdempotencyFingerprintInput,
} from "@zayn/shared";

export const ORDER_IDEMPOTENCY_STORAGE_KEY = "zf-checkout-idempotency-v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredAttempt = {
  key: string;
  fingerprint: string;
};

let memoryAttempt: StoredAttempt | null = null;

function sessionStorageOrNull(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readAttempt(storage: StorageLike | null): StoredAttempt | null {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(ORDER_IDEMPOTENCY_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as StoredAttempt).key !== "string" ||
      typeof (parsed as StoredAttempt).fingerprint !== "string"
    ) {
      return null;
    }

    return {
      key: (parsed as StoredAttempt).key,
      fingerprint: (parsed as StoredAttempt).fingerprint,
    };
  } catch {
    return null;
  }
}

function writeAttempt(storage: StorageLike | null, attempt: StoredAttempt): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(ORDER_IDEMPOTENCY_STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    // Storage can be unavailable; the in-memory attempt still protects the
    // current page from a double submit.
  }
}

function createUuidV4(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16,
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error("This browser cannot create a secure checkout key.");
}

/**
 * Reuse one UUID for the same checkout inputs, including after a refresh.
 * A changed fingerprint starts a new attempt. Never put this key in a URL.
 */
export function getOrCreateOrderIdempotencyKey(
  input: OrderIdempotencyFingerprintInput,
  storage: StorageLike | null = sessionStorageOrNull(),
): string {
  const fingerprint = canonicalOrderIdempotencyFingerprint(input);
  const stored = readAttempt(storage);

  if (stored && isUuidV4(stored.key) && stored.fingerprint === fingerprint) {
    memoryAttempt = stored;
    return stored.key;
  }

  if (
    memoryAttempt &&
    isUuidV4(memoryAttempt.key) &&
    memoryAttempt.fingerprint === fingerprint
  ) {
    writeAttempt(storage, memoryAttempt);
    return memoryAttempt.key;
  }

  const attempt = {
    key: createUuidV4(),
    fingerprint,
  };

  memoryAttempt = attempt;
  writeAttempt(storage, attempt);

  return attempt.key;
}

export function clearOrderIdempotencyAttempt(
  storage: StorageLike | null = sessionStorageOrNull(),
): void {
  memoryAttempt = null;

  if (!storage) {
    return;
  }

  try {
    storage.removeItem(ORDER_IDEMPOTENCY_STORAGE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

export function resetOrderIdempotencyMemoryForTests(): void {
  memoryAttempt = null;
}
