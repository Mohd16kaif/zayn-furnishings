import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  renderDelivered,
  renderDeliveryScheduled,
  renderOutForDelivery,
} from "../emails/templates/deliveryUpdates";
import { renderOrderConfirmation } from "../emails/templates/orderConfirmation";
import { renderOwnerNewOrder } from "../emails/templates/ownerNewOrder";
import { renderRefundIssued } from "../emails/templates/refundIssued";
import type { RenderedEmail } from "../emails/templates/types";

const OUTPUT_DIR = path.resolve(process.cwd(), "tmp-email-preview");

const fixture = {
  storeName: "Zayn Furnishings",
  storeEmail: "orders@example.com",
  webOrigin: "http://localhost:3000",
  orderNumber: "ZF-100030",
  customerName: "Jordan Lee",
  subtotalCents: 124800,
  discountCents: 0,
  deliveryFeeCents: 0,
  taxCents: 0,
  totalCents: 124800,
  shippingAddress: {
    name: "Jordan Lee",
    line1: "123 Example Street",
    line2: "Apt 4B",
    city: "Brooklyn",
    state: "NY",
    zip: "11201",
  },
  items: [
    {
      name: "Oak Dining Chair",
      quantity: 1,
      lineTotalCents: 124800,
    },
  ],
  deliveryCompany: "Zayn Delivery Co.",
  trackingNumber: "1Z999AA10123456784",
  scheduledDate: "2026-11-14",
  timeWindow: "Morning (8am to 12pm)",
};

async function writePreview(
  name: string,
  rendered: RenderedEmail,
): Promise<void> {
  await Promise.all([
    writeFile(
      path.join(OUTPUT_DIR, `${name}.html`),
      rendered.html,
      "utf8",
    ),
    writeFile(
      path.join(OUTPUT_DIR, `${name}.txt`),
      rendered.text,
      "utf8",
    ),
  ]);
}

async function main(): Promise<void> {
  const confirmation = renderOrderConfirmation(fixture);
  const owner = renderOwnerNewOrder({
    storeName: fixture.storeName,
    webOrigin: fixture.webOrigin,
    orderNumber: fixture.orderNumber,
    customerName: fixture.customerName,
    itemCount: fixture.items.reduce(
      (total, item) => total + item.quantity,
      0,
    ),
    totalCents: fixture.totalCents,
  });
  const scheduled = renderDeliveryScheduled({
    orderNumber: fixture.orderNumber,
    scheduledDate: fixture.scheduledDate,
    timeWindow: fixture.timeWindow,
    deliveryCompany: fixture.deliveryCompany,
    storeEmail: fixture.storeEmail,
    webOrigin: fixture.webOrigin,
    storeName: fixture.storeName,
    dateChanged: false,
  });
  const scheduledChanged = renderDeliveryScheduled({
    orderNumber: fixture.orderNumber,
    scheduledDate: "2026-11-20",
    timeWindow: fixture.timeWindow,
    deliveryCompany: fixture.deliveryCompany,
    storeEmail: fixture.storeEmail,
    webOrigin: fixture.webOrigin,
    storeName: fixture.storeName,
    dateChanged: true,
  });
  const outForDelivery = renderOutForDelivery({
    orderNumber: fixture.orderNumber,
    deliveryCompany: fixture.deliveryCompany,
    trackingNumber: fixture.trackingNumber,
    scheduledDate: fixture.scheduledDate,
    timeWindow: fixture.timeWindow,
    webOrigin: fixture.webOrigin,
    storeName: fixture.storeName,
  });
  const delivered = renderDelivered({
    orderNumber: fixture.orderNumber,
    webOrigin: fixture.webOrigin,
    storeName: fixture.storeName,
  });
  const refundIssued = renderRefundIssued({
    orderNumber: fixture.orderNumber,
    amountCents: 25000,
    totalRefundedCents: 25000,
    webOrigin: fixture.webOrigin,
    storeName: fixture.storeName,
  });

  await mkdir(OUTPUT_DIR, { recursive: true });
  await Promise.all([
    writePreview("order-confirmation", confirmation),
    writePreview("owner-new-order", owner),
    writePreview("delivery-scheduled", scheduled),
    writePreview("delivery-scheduled-changed", scheduledChanged),
    writePreview("out-for-delivery", outForDelivery),
    writePreview("delivered", delivered),
    writePreview("refund-issued", refundIssued),
  ]);

  console.log(`Wrote email previews to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(
    "Email preview failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
