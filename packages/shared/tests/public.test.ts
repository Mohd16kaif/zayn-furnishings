import { describe, expect, it } from "vitest";
import { MAX_ORDER_QTY, maxOrderQty } from "../src/public";

describe("maxOrderQty", () => {
  it("returns zero when the product is sold out", () => {
    expect(maxOrderQty(0)).toBe(0);
  });

  it("returns the stock quantity below the cap", () => {
    expect(maxOrderQty(1)).toBe(1);
    expect(maxOrderQty(5)).toBe(5);
  });

  it("returns the cap at ten", () => {
    expect(maxOrderQty(10)).toBe(MAX_ORDER_QTY);
  });

  it("caps stock above ten", () => {
    expect(maxOrderQty(11)).toBe(MAX_ORDER_QTY);
    expect(maxOrderQty(500)).toBe(MAX_ORDER_QTY);
  });

  it("treats negative stock as zero", () => {
    expect(maxOrderQty(-1)).toBe(0);
    expect(maxOrderQty(-500)).toBe(0);
  });
});
