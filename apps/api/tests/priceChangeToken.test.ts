import { describe, expect, it } from "vitest";
import type { BulkPriceChangeRow } from "@zayn/shared";
import type { PriceChangeParamsInput } from "../src/lib/priceChanges";
import {
  PRICE_CHANGE_PREVIEW_TTL_MS,
  canonicalPriceChangeParams,
  canonicalPriceChangeRows,
  signPriceChangePreview,
  verifyPriceChangePreview,
} from "../src/lib/priceChangeToken";

const SECRET = `test-price-change-secret-${"x".repeat(24)}`;
const NOW = new Date("2026-05-01T12:00:00.000Z");

const PARAMS: PriceChangeParamsInput = {
  scope: { type: "all" },
  statuses: ["active", "draft"],
  mode: "percent_increase",
  value: 10,
  apply_to: "regular",
  rounding: "end_99",
};

function row(
  productId: string,
  oldPrice: number,
  oldSale: number | null = null,
): BulkPriceChangeRow {
  return {
    productId,
    name: productId,
    categoryId: null,
    productStatus: "active",
    oldPrice,
    oldSale,
    newPrice: oldPrice + 100,
    newSale: oldSale,
    status: "ok",
    reason: null,
  };
}

const ROWS = [row("product-b", 2000), row("product-a", 1000, 800)];

describe("price change preview token", () => {
  it("signs and verifies the params and ok rows", () => {
    const token = signPriceChangePreview({
      params: PARAMS,
      okRows: ROWS,
      secret: SECRET,
      now: NOW,
    });

    expect(
      verifyPriceChangePreview({
        token,
        params: PARAMS,
        okRows: ROWS,
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a tampered signature", () => {
    const token = signPriceChangePreview({
      params: PARAMS,
      okRows: ROWS,
      secret: SECRET,
      now: NOW,
    });
    const tampered = `${token.slice(0, -1)}${
      token.endsWith("0") ? "1" : "0"
    }`;

    expect(
      verifyPriceChangePreview({
        token: tampered,
        params: PARAMS,
        okRows: ROWS,
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects changed params and changed old prices", () => {
    const token = signPriceChangePreview({
      params: PARAMS,
      okRows: ROWS,
      secret: SECRET,
      now: NOW,
    });

    expect(
      verifyPriceChangePreview({
        token,
        params: { ...PARAMS, value: 20 },
        okRows: ROWS,
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      verifyPriceChangePreview({
        token,
        params: PARAMS,
        okRows: [row("product-b", 2100), row("product-a", 1000, 800)],
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an expired token", () => {
    const token = signPriceChangePreview({
      params: PARAMS,
      okRows: ROWS,
      secret: SECRET,
      now: NOW,
    });

    expect(
      verifyPriceChangePreview({
        token,
        params: PARAMS,
        okRows: ROWS,
        secret: SECRET,
        now: new Date(NOW.getTime() + PRICE_CHANGE_PREVIEW_TTL_MS + 1),
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("uses a stable canonical form for rows and params", () => {
    expect(canonicalPriceChangeRows(ROWS)).toBe(
      "product-a:1000:800,product-b:2000:",
    );
    expect(canonicalPriceChangeParams(PARAMS)).toBe(
      "all|active,draft|percent_increase|1000|regular|end_99",
    );
  });
});
