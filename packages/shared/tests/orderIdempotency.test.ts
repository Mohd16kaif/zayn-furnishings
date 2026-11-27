import { describe, expect, it } from "vitest";
import {
  canonicalOrderIdempotencyFingerprint,
  isUuidV4,
  type OrderIdempotencyFingerprintInput,
} from "../src/orderIdempotency";

function input(
  overrides: Partial<OrderIdempotencyFingerprintInput> = {},
): OrderIdempotencyFingerprintInput {
  return {
    items: [
      { product_id: "11111111-1111-4111-8111-111111111111", quantity: 1 },
      { product_id: "22222222-2222-4222-8222-222222222222", quantity: 2 },
    ],
    zip: "11201",
    email: "customer@example.com",
    shipping_address: {
      name: "Jordan Lee",
      line1: "1 Main St",
      line2: "",
      city: "Brooklyn",
      state: "ny",
      zip: "11201",
    },
    discount_code: "welcome10",
    ...overrides,
  };
}

describe("canonicalOrderIdempotencyFingerprint", () => {
  it("does not depend on item order", () => {
    const first = input();
    const second = input({
      items: [...first.items].reverse(),
    });

    expect(canonicalOrderIdempotencyFingerprint(first)).toBe(
      canonicalOrderIdempotencyFingerprint(second),
    );
  });

  it("aggregates duplicate product lines deterministically", () => {
    const split = input({
      items: [
        { product_id: "11111111-1111-4111-8111-111111111111", quantity: 1 },
        { product_id: "22222222-2222-4222-8222-222222222222", quantity: 1 },
        { product_id: "11111111-1111-4111-8111-111111111111", quantity: 2 },
      ],
    });
    const combined = input({
      items: [
        { product_id: "22222222-2222-4222-8222-222222222222", quantity: 1 },
        { product_id: "11111111-1111-4111-8111-111111111111", quantity: 3 },
      ],
    });

    expect(canonicalOrderIdempotencyFingerprint(split)).toBe(
      canonicalOrderIdempotencyFingerprint(combined),
    );
  });

  it("normalizes email, state and discount-code case", () => {
    const first = input();
    const second = input({
      email: "  CUSTOMER@EXAMPLE.COM ",
      discount_code: " WeLcOmE10 ",
      shipping_address: {
        ...first.shipping_address,
        state: "NY",
      },
    });

    expect(canonicalOrderIdempotencyFingerprint(first)).toBe(
      canonicalOrderIdempotencyFingerprint(second),
    );
  });

  it("changes when a quantity, ZIP or address changes", () => {
    const base = canonicalOrderIdempotencyFingerprint(input());
    const quantity = canonicalOrderIdempotencyFingerprint(
      input({
        items: [
          { product_id: "11111111-1111-4111-8111-111111111111", quantity: 2 },
          { product_id: "22222222-2222-4222-8222-222222222222", quantity: 2 },
        ],
      }),
    );
    const zip = canonicalOrderIdempotencyFingerprint(
      input({
        zip: "11202",
        shipping_address: {
          ...input().shipping_address,
          zip: "11202",
        },
      }),
    );
    const address = canonicalOrderIdempotencyFingerprint(
      input({
        shipping_address: {
          ...input().shipping_address,
          line1: "2 Main St",
        },
      }),
    );

    expect(new Set([base, quantity, zip, address]).size).toBe(4);
  });
});

describe("isUuidV4", () => {
  it("accepts only UUID v4 strings", () => {
    expect(isUuidV4("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuidV4("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")).toBe(true);
    expect(isUuidV4("11111111-1111-1111-8111-111111111111")).toBe(false);
    expect(isUuidV4("11111111-1111-4111-1111-111111111111")).toBe(false);
    expect(isUuidV4("not-a-uuid")).toBe(false);
    expect(isUuidV4(null)).toBe(false);
    expect(isUuidV4(undefined)).toBe(false);
  });
});
