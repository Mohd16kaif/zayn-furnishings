import { describe, expect, it } from "vitest";
import {
  BULK_PRICE_MAX_CENTS,
  computeBulkPriceChange,
  describeBulkPriceChange,
  type BulkPriceChangeParams,
  type BulkPriceChangeRounding,
  type BulkPriceProduct,
} from "../src/bulkPriceChange";

function product(
  id: string,
  priceCents: number,
  salePriceCents: number | null = null,
  overrides: Partial<BulkPriceProduct> = {},
): BulkPriceProduct {
  return {
    id,
    name: id,
    priceCents,
    salePriceCents,
    status: "active",
    categoryId: "category-1",
    ...overrides,
  };
}

function params(
  overrides: Partial<BulkPriceChangeParams> = {},
): BulkPriceChangeParams {
  return {
    scope: { type: "all" },
    productStatus: ["active", "draft"],
    mode: "percent_increase",
    value: 10,
    applyTo: "regular",
    rounding: "none",
    ...overrides,
  };
}

function rowFor(
  result: ReturnType<typeof computeBulkPriceChange>,
  id: string,
) {
  const row = result.rows.find((entry) => entry.productId === id);

  if (!row) {
    throw new Error(`Missing row ${id}`);
  }

  return row;
}

describe("computeBulkPriceChange percent and amount math", () => {
  it("increases and decreases percentages with integer rounding", () => {
    const up = computeBulkPriceChange([product("p1", 1055)], params());
    const down = computeBulkPriceChange(
      [product("p1", 1055)],
      params({ mode: "percent_decrease" }),
    );
    const fractional = computeBulkPriceChange(
      [product("p1", 1000)],
      params({ value: 12.34 }),
    );

    expect(rowFor(up, "p1").newPrice).toBe(1161);
    expect(rowFor(down, "p1").newPrice).toBe(949);
    expect(rowFor(fractional, "p1").newPrice).toBe(1123);
  });

  it("increases and decreases fixed amounts in cents", () => {
    const up = computeBulkPriceChange(
      [product("p1", 1000)],
      params({ mode: "amount_increase", value: 250 }),
    );
    const down = computeBulkPriceChange(
      [product("p1", 1000)],
      params({ mode: "amount_decrease", value: 250 }),
    );

    expect(rowFor(up, "p1").newPrice).toBe(1250);
    expect(rowFor(down, "p1").newPrice).toBe(750);
  });

  it("applies each rounding mode after the math", () => {
    const cases: Array<[BulkPriceChangeRounding, number, number]> = [
      ["none", 1149, 1149],
      ["nearest_dollar", 1149, 1100],
      ["nearest_dollar", 1150, 1200],
      ["end_99", 1100, 1199],
      ["end_99", 1199, 1199],
      ["end_99", 1201, 1299],
      ["end_00_up", 1101, 1200],
      ["end_00_up", 1100, 1100],
    ];

    for (const [rounding, oldPrice, expected] of cases) {
      const result = computeBulkPriceChange(
        [product("p1", oldPrice)],
        params({ mode: "percent_increase", value: 0.01, rounding }),
      );

      expect(rowFor(result, "p1").newPrice, `${rounding} ${oldPrice}`).toBe(
        expected,
      );
    }
  });

  it("blocks results below the 100 cent minimum", () => {
    const result = computeBulkPriceChange(
      [product("p1", 100)],
      params({ mode: "percent_decrease", value: 1 }),
    );
    const row = rowFor(result, "p1");

    expect(row.status).toBe("blocked");
    expect(row.reason).toContain("below $1.00");
  });

  it("allows an exact 100 cent price and an unchanged 100 cent price", () => {
    const result = computeBulkPriceChange(
      [product("p1", 100), product("p2", 100)],
      params({ mode: "amount_increase", value: 1 }),
    );

    expect(rowFor(result, "p1").newPrice).toBe(101);
    expect(rowFor(result, "p2").newPrice).toBe(101);
  });
});

describe("computeBulkPriceChange sale rules", () => {
  it("blocks a regular increase when the existing sale would no longer be lower", () => {
    const result = computeBulkPriceChange(
      [product("p1", 1000, 950)],
      params({ mode: "percent_decrease", value: 10 }),
    );
    const row = rowFor(result, "p1");

    expect(row.status).toBe("blocked");
    expect(row.newPrice).toBe(900);
    expect(row.newSale).toBe(950);
    expect(row.reason).toContain("no longer be below");
  });

  it("skips products with no sale price for sale-only changes", () => {
    const result = computeBulkPriceChange(
      [product("p1", 1000, null)],
      params({ applyTo: "sale" }),
    );
    const row = rowFor(result, "p1");

    expect(row.status).toBe("unchanged");
    expect(row.newSale).toBeNull();
    expect(row.reason).toContain("no sale price");
  });

  it("skips products with no sale price for both-price changes", () => {
    const result = computeBulkPriceChange(
      [product("p1", 1000, null)],
      params({ applyTo: "both" }),
    );
    const row = rowFor(result, "p1");

    expect(row.status).toBe("unchanged");
    expect(row.newPrice).toBe(1000);
    expect(row.newSale).toBeNull();
  });

  it("changes both prices and keeps the sale below the regular price", () => {
    const result = computeBulkPriceChange(
      [product("p1", 1000, 800)],
      params({ applyTo: "both" }),
    );
    const row = rowFor(result, "p1");

    expect(row.status).toBe("ok");
    expect(row.newPrice).toBe(1100);
    expect(row.newSale).toBe(880);
  });

  it("blocks a sale change that reaches or exceeds the regular price", () => {
    const result = computeBulkPriceChange(
      [product("p1", 1000, 900)],
      params({ mode: "amount_increase", value: 100, applyTo: "sale" }),
    );
    const row = rowFor(result, "p1");

    expect(row.status).toBe("blocked");
    expect(row.newSale).toBe(1000);
    expect(row.reason).toContain("must stay below");
  });

  it("does not round the sale price during a regular-only change", () => {
    const result = computeBulkPriceChange(
      [product("p1", 1000, 900)],
      params({
        mode: "amount_increase",
        value: 100,
        applyTo: "regular",
        rounding: "end_99",
      }),
    );
    const row = rowFor(result, "p1");

    expect(row.status).toBe("ok");
    expect(row.newPrice).toBe(1199);
    expect(row.newSale).toBe(900);
  });

  it("does not round the regular price during a sale-only change", () => {
    const result = computeBulkPriceChange(
      [product("p1", 1055, 1000)],
      params({
        mode: "amount_decrease",
        value: 100,
        applyTo: "sale",
        rounding: "end_99",
      }),
    );
    const row = rowFor(result, "p1");

    expect(row.status).toBe("ok");
    expect(row.newPrice).toBe(1055);
    expect(row.newSale).toBe(999);
  });
});

describe("computeBulkPriceChange rule violations", () => {
  it("blocks every matching product when an amount decrease pushes all below the minimum", () => {
    const result = computeBulkPriceChange(
      [product("p1", 100), product("p2", 150), product("p3", 199)],
      params({ mode: "amount_decrease", value: 200 }),
    );

    expect(result.counts).toEqual({ ok: 0, unchanged: 0, blocked: 3 });
    expect(result.totals.okCount).toBe(0);
    expect(result.totals.regularDifferenceCents).toBe(0);
    expect(result.rows.every((row) => row.status === "blocked")).toBe(true);

    for (const row of result.rows) {
      expect(row.reason).toContain("below $1.00");
      expect(row.newPrice).toBeLessThan(100);
    }

    expect(rowFor(result, "p1").oldPrice).toBe(100);
    expect(rowFor(result, "p2").oldPrice).toBe(150);
    expect(rowFor(result, "p3").oldPrice).toBe(199);
  });

  it("blocks every matching product when a percent decrease pushes all below the minimum", () => {
    const result = computeBulkPriceChange(
      [product("p1", 100), product("p2", 150)],
      params({ mode: "percent_decrease", value: 90 }),
    );

    expect(result.counts).toEqual({ ok: 0, unchanged: 0, blocked: 2 });
    expect(result.rows.every((row) => row.status === "blocked")).toBe(true);
    expect(rowFor(result, "p1").reason).toContain("below $1.00");
    expect(rowFor(result, "p2").reason).toContain("below $1.00");
  });

  it("applies only the ok rows when some products would fall below the minimum", () => {
    const result = computeBulkPriceChange(
      [product("ok", 1000), product("low1", 100), product("low2", 150)],
      params({ mode: "amount_decrease", value: 100 }),
    );

    expect(result.counts).toEqual({ ok: 1, unchanged: 0, blocked: 2 });
    expect(rowFor(result, "ok").status).toBe("ok");
    expect(rowFor(result, "ok").newPrice).toBe(900);
    expect(rowFor(result, "low1").status).toBe("blocked");
    expect(rowFor(result, "low1").oldPrice).toBe(100);
    expect(rowFor(result, "low2").status).toBe("blocked");
    expect(rowFor(result, "low2").oldPrice).toBe(150);
    expect(result.totals).toMatchObject({
      okCount: 1,
      oldRegularCents: 1000,
      newRegularCents: 900,
      regularDifferenceCents: -100,
    });
  });

  it("blocks every regular decrease that conflicts with an existing sale price", () => {
    const result = computeBulkPriceChange(
      [product("p1", 1000, 900), product("p2", 2000, 1500)],
      params({ mode: "percent_decrease", value: 50 }),
    );

    expect(result.counts).toEqual({ ok: 0, unchanged: 0, blocked: 2 });
    expect(rowFor(result, "p1").reason).toContain("no longer be below");
    expect(rowFor(result, "p2").reason).toContain("no longer be below");
    expect(rowFor(result, "p1").newSale).toBe(900);
    expect(rowFor(result, "p2").newSale).toBe(1500);
  });

  it("blocks every increase that would exceed the maximum price", () => {
    const result = computeBulkPriceChange(
      [
        product("p1", BULK_PRICE_MAX_CENTS),
        product("p2", BULK_PRICE_MAX_CENTS),
      ],
      params({ mode: "amount_increase", value: 1 }),
    );

    expect(result.counts).toEqual({ ok: 0, unchanged: 0, blocked: 2 });
    expect(rowFor(result, "p1").reason).toContain("above $1,000,000.00");
    expect(rowFor(result, "p2").reason).toContain("above $1,000,000.00");
  });
});

describe("computeBulkPriceChange filters and boundaries", () => {
  it("excludes archived products unless they are selected", () => {
    const products = [
      product("active", 1000),
      product("draft", 1000, null, { status: "draft" }),
      product("archived", 1000, null, { status: "archived" }),
    ];
    const defaultResult = computeBulkPriceChange(products, params());
    const archivedResult = computeBulkPriceChange(
      products,
      params({ productStatus: ["archived"] }),
    );

    expect(defaultResult.rows.map((row) => row.productId)).toEqual([
      "active",
      "draft",
    ]);
    expect(archivedResult.rows.map((row) => row.productId)).toEqual([
      "archived",
    ]);
  });

  it("filters by category and includes child category ids", () => {
    const products = [
      product("parent", 1000, null, { categoryId: "parent" }),
      product("child", 1000, null, { categoryId: "child" }),
      product("other", 1000, null, { categoryId: "other" }),
    ];
    const result = computeBulkPriceChange(
      products,
      params({
        scope: {
          type: "category",
          categoryId: "parent",
          includeChildren: true,
          categoryIds: ["parent", "child"],
        },
      }),
    );

    expect(result.rows.map((row) => row.productId)).toEqual([
      "parent",
      "child",
    ]);
  });

  it("blocks huge results above the maximum price", () => {
    const result = computeBulkPriceChange(
      [product("p1", BULK_PRICE_MAX_CENTS)],
      params({ mode: "amount_increase", value: 1 }),
    );
    const row = rowFor(result, "p1");

    expect(row.status).toBe("blocked");
    expect(row.reason).toContain("above $1,000,000.00");
  });

  it("keeps repeated applications as integer cents", () => {
    const first = computeBulkPriceChange(
      [product("p1", 999)],
      params({ mode: "percent_increase", value: 7.77 }),
    );
    const firstPrice = rowFor(first, "p1").newPrice;
    const second = computeBulkPriceChange(
      [product("p1", firstPrice)],
      params({ mode: "percent_decrease", value: 3.33 }),
    );
    const secondPrice = rowFor(second, "p1").newPrice;

    expect(Number.isInteger(firstPrice)).toBe(true);
    expect(Number.isInteger(secondPrice)).toBe(true);
  });

  it("returns counts and totals for only ok rows", () => {
    const result = computeBulkPriceChange(
      [
        product("ok1", 1000),
        product("ok2", 2000),
        product("blocked", 100, null),
      ],
      params({ mode: "amount_decrease", value: 50 }),
    );

    expect(result.counts).toEqual({ ok: 2, unchanged: 0, blocked: 1 });
    expect(result.totals).toMatchObject({
      okCount: 2,
      oldRegularCents: 3000,
      newRegularCents: 2900,
      regularDifferenceCents: -100,
    });
  });
});

describe("describeBulkPriceChange", () => {
  it("describes a category change in plain words", () => {
    const text = describeBulkPriceChange(
      params({
        scope: {
          type: "category",
          categoryId: "category-1",
          includeChildren: true,
          categoryName: "Living room",
        },
        mode: "amount_increase",
        value: 500,
        applyTo: "both",
        rounding: "end_99",
      }),
    );

    expect(text).toContain("Living room");
    expect(text).toContain("including subcategories");
    expect(text).toContain("$5.00 increase");
    expect(text).toContain("regular and sale prices");
    expect(text).toContain("99 cents");
  });
});
