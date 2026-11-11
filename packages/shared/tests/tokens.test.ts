import { describe, expect, it } from "vitest";
import { renderTokens } from "../src/tokens";

const settings = (threshold: number | null) => ({
  free_delivery_threshold_cents: threshold,
});

describe("renderTokens", () => {
  it("replaces the token with a formatted threshold", () => {
    expect(
      renderTokens("Free delivery over {{free_delivery_threshold}}", settings(199900)),
    ).toBe("Free delivery over $1,999");
  });

  it("removes a sentence containing the token when the threshold is null", () => {
    const rendered = renderTokens(
      "Free delivery over {{free_delivery_threshold}}.\nShop the collection.",
      settings(null),
    );

    expect(rendered).toBe("Shop the collection.");
    expect(rendered).not.toContain("$null");
    expect(rendered).not.toContain("{{free_delivery_threshold}}");
  });

  it("removes only the token sentence from a mixed line", () => {
    const rendered = renderTokens(
      "Hello. Free delivery over {{free_delivery_threshold}}! Shop today.",
      settings(null),
    );

    expect(rendered).toBe("Hello. Shop today.");
  });

  it("returns text without a token unchanged", () => {
    expect(renderTokens("Plain announcement", settings(null))).toBe(
      "Plain announcement",
    );
  });

  it("replaces every occurrence of the token", () => {
    expect(
      renderTokens(
        "Free over {{free_delivery_threshold}} or {{free_delivery_threshold}}",
        settings(150000),
      ),
    ).toBe("Free over $1,500 or $1,500");
  });

  it("formats a zero threshold as $0", () => {
    expect(
      renderTokens("Free over {{free_delivery_threshold}}", settings(0)),
    ).toBe("Free over $0");
  });
});
