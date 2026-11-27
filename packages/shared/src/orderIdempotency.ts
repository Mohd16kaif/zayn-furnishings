export const ORDER_IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OrderIdempotencyItem = {
  product_id: string;
  quantity: number;
};

export type OrderIdempotencyAddress = {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  zip: string;
};

export type OrderIdempotencyFingerprintInput = {
  items: OrderIdempotencyItem[];
  zip: string;
  email: string;
  shipping_address: OrderIdempotencyAddress;
  discount_code?: string | null;
};

export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value.trim());
}

function normalizedText(value: string): string {
  return value.trim();
}

function normalizedOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}

function normalizedItems(items: OrderIdempotencyItem[]): Array<[string, number]> {
  const quantities = new Map<string, number>();

  for (const item of items) {
    const productId = normalizedText(item.product_id);
    const quantity = Number(item.quantity);

    if (!productId || !Number.isFinite(quantity)) {
      continue;
    }

    quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
  }

  return Array.from(quantities.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

/**
 * Deterministic client/server fingerprint for one checkout attempt.
 *
 * It is deliberately not a hash so the client can compare it without
 * asynchronous Web Crypto. The API hashes this string with SHA-256 before it
 * is stored. No customer id, timestamp or other server-owned value is included.
 */
export function canonicalOrderIdempotencyFingerprint(
  input: OrderIdempotencyFingerprintInput,
): string {
  const address = input.shipping_address;

  return JSON.stringify({
    items: normalizedItems(input.items),
    zip: normalizedText(input.zip),
    email: normalizedText(input.email).toLowerCase(),
    shipping_address: {
      name: normalizedText(address.name),
      line1: normalizedText(address.line1),
      line2: normalizedOptionalText(address.line2),
      city: normalizedText(address.city),
      state: normalizedText(address.state).toUpperCase(),
      zip: normalizedText(address.zip),
    },
    discount_code: normalizedOptionalText(input.discount_code)?.toUpperCase() ?? null,
  });
}
