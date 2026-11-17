import { describe, expect, it } from "vitest";
import {
  renderDelivered,
  renderDeliveryScheduled,
  renderOutForDelivery,
} from "../src/emails/templates/deliveryUpdates";
import { escapeHtml } from "../src/emails/templates/escape";
import { formatEmailDate } from "../src/emails/templates/format";
import { renderOrderConfirmation } from "../src/emails/templates/orderConfirmation";
import { renderOwnerNewOrder } from "../src/emails/templates/ownerNewOrder";
import { renderRefundIssued } from "../src/emails/templates/refundIssued";

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

  it("hides the discount row when the discount is zero", () => {
    const base = {
      orderNumber: "ZF-100030",
      items: [
        { name: "Oak Chair", quantity: 1, lineTotalCents: 10000 },
      ],
      subtotalCents: 10000,
      deliveryFeeCents: 0,
      taxCents: 0,
      totalCents: 10000,
      shippingAddress: {
        name: "Jordan Lee",
        line1: "1 Main St",
        line2: null,
        city: "Brooklyn",
        state: "NY",
        zip: "11201",
      },
      webOrigin: "http://localhost:3000",
      storeName: "Zayn Furnishings",
    };
    const withoutDiscount = renderOrderConfirmation({
      ...base,
      discountCents: 0,
    });
    const withDiscount = renderOrderConfirmation({
      ...base,
      discountCents: 500,
      totalCents: 9500,
    });

    expect(withoutDiscount.html).not.toContain(">Discount<");
    expect(withoutDiscount.text).not.toContain("Discount:");
    expect(withDiscount.html).toContain(">Discount<");
    expect(withDiscount.text).toContain("Discount: $5.00");
  });
});

describe("email date formatting", () => {
  it("formats YYYY-MM-DD without timezone conversion", () => {
    expect(formatEmailDate("2025-11-14")).toBe("Friday, Nov 14");
    expect(formatEmailDate("2026-11-30")).toBe("Monday, Nov 30");
    expect(formatEmailDate("2026-12-01")).toBe("Tuesday, Dec 1");
    expect(formatEmailDate("2025-12-31")).toBe("Wednesday, Dec 31");
    expect(formatEmailDate("2024-02-29")).toBe("Thursday, Feb 29");
    expect(formatEmailDate("2024-03-31")).toBe("Sunday, Mar 31");
    expect(formatEmailDate("2024-01-01")).toBe("Monday, Jan 1");
  });
});

describe("delivery and refund templates", () => {
  it("escapes delivery details and uses the date-changed subject", () => {
    const rendered = renderDeliveryScheduled({
      orderNumber: "ZF-100030",
      scheduledDate: "2025-11-14",
      timeWindow: '<script>alert("window")</script>',
      deliveryCompany: "<b>Fast Co.</b>",
      storeEmail: "orders@example.com",
      webOrigin: "http://localhost:3000",
      storeName: "Zayn Furnishings",
      dateChanged: true,
    });

    expect(rendered.subject).toBe(
      "The delivery date for order ZF-100030 has changed",
    );
    expect(rendered.html).toContain("Friday, Nov 14");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).toContain("&lt;b&gt;");
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("<b>");
    expect(rendered.html).toContain(
      "If you need to change this, reply to this email.",
    );
    expect(rendered.text).toContain("If you need to change this");
  });

  it("omits the store reply line when no store email is set", () => {
    const rendered = renderDeliveryScheduled({
      orderNumber: "ZF-100030",
      scheduledDate: "2025-11-14",
      timeWindow: null,
      deliveryCompany: null,
      storeEmail: "",
      webOrigin: "http://localhost:3000",
      storeName: "Zayn Furnishings",
      dateChanged: false,
    });

    expect(rendered.subject).toBe(
      "Your delivery for order ZF-100030 is scheduled",
    );
    expect(rendered.html).not.toContain(
      "If you need to change this, reply to this email.",
    );
  });

  it("includes delivery company, tracking, date and window when set", () => {
    const rendered = renderOutForDelivery({
      orderNumber: "ZF-100030",
      deliveryCompany: "Zayn Delivery Co.",
      trackingNumber: "1Z999",
      scheduledDate: "2025-11-14",
      timeWindow: "Morning",
      webOrigin: "http://localhost:3000",
      storeName: "Zayn Furnishings",
    });

    expect(rendered.subject).toBe(
      "Your order ZF-100030 is on its way",
    );
    expect(rendered.html).toContain("Zayn Delivery Co.");
    expect(rendered.html).toContain("1Z999");
    expect(rendered.html).toContain("Friday, Nov 14, Morning");
    expect(rendered.text).toContain("Tracking number: 1Z999");
  });

  it("renders the delivered email without internal data", () => {
    const rendered = renderDelivered({
      orderNumber: "ZF-100030",
      webOrigin: "http://localhost:3000",
      storeName: "Zayn Furnishings",
      driverNotes: "Gate code 4821. Call on arrival.",
    } as Parameters<typeof renderDelivered>[0]);

    expect(rendered.subject).toBe(
      "Your order ZF-100030 was delivered",
    );
    expect(rendered.html).not.toContain("Gate code");
    expect(rendered.text).not.toContain("Gate code");
  });

  it("renders the refund amounts without a reason or note", () => {
    const rendered = renderRefundIssued({
      orderNumber: "ZF-100030",
      amountCents: 2500,
      totalRefundedCents: 5000,
      webOrigin: "http://localhost:3000",
      storeName: "Zayn Furnishings",
      reason: "damaged",
      note: "Chair arrived with a broken leg.",
    } as Parameters<typeof renderRefundIssued>[0]);

    expect(rendered.subject).toBe("Your refund for order ZF-100030");
    expect(rendered.html).toContain("$25.00");
    expect(rendered.html).toContain("$50.00");
    expect(rendered.html).toContain(
      "It was sent to your original payment method.",
    );
    expect(rendered.html).not.toContain("damaged");
    expect(rendered.html).not.toContain("broken leg");
    expect(rendered.text).not.toContain("damaged");
    expect(rendered.text).not.toContain("broken leg");
  });
});
