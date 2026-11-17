import { describe, expect, it } from "vitest";
import { escapeHtml } from "../src/emails/templates/escape";
import { renderOrderConfirmation } from "../src/emails/templates/orderConfirmation";
import { renderOwnerNewOrder } from "../src/emails/templates/ownerNewOrder";

describe("escapeHtml", () => {
  it("escapes every HTML-sensitive character", () => {
    expect(
      escapeHtml('<script>alert("x") & don\'t</script>'),
    ).toBe(
      "&lt;script&gt;alert(&quot;x&quot;) &amp; don&#39;t&lt;/script&gt;",
    );
  });
});

describe("email templates", () => {
  it("escapes dynamic names and addresses and never includes driver notes", () => {
    const data = {
      orderNumber: "ZF-100030",
      items: [
        {
          name: '<script>alert("chair")</script>',
          quantity: 1,
          lineTotalCents: 124800,
        },
      ],
      subtotalCents: 124800,
      discountCents: 0,
      deliveryFeeCents: 0,
      taxCents: 0,
      totalCents: 124800,
      shippingAddress: {
        name: '<script>alert("name")</script>',
        line1: '<img src=x onerror=alert("address")>',
        line2: null,
        city: "Brooklyn",
        state: "NY",
        zip: "11201",
      },
      webOrigin: "http://localhost:3000",
      storeName: "Zayn Furnishings",
      driverNotes: "Gate code 4821. Call on arrival.",
    };

    const rendered = renderOrderConfirmation(data);

    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).toContain("&lt;img");
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("<img");
    expect(rendered.html).not.toContain("Gate code");
    expect(rendered.text).not.toContain("Gate code");
    expect(rendered.text).toContain("We will email you again");
    expect(rendered.subject).toBe("Your order ZF-100030 is confirmed");
  });

  it("escapes the owner alert and formats its subject total", () => {
    const rendered = renderOwnerNewOrder({
      orderNumber: "ZF-100030",
      customerName: "<script>alert('owner')</script>",
      itemCount: 2,
      totalCents: 124800,
      webOrigin: "http://localhost:3000",
      storeName: "Zayn Furnishings",
    });

    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.subject).toBe("New order ZF-100030 ($1,248.00)");
  });
});
