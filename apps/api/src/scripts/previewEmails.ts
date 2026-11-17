import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderOrderConfirmation } from "../emails/templates/orderConfirmation";
import { renderOwnerNewOrder } from "../emails/templates/ownerNewOrder";

const OUTPUT_DIR = path.resolve(process.cwd(), "tmp-email-preview");

const fixture = {
  storeName: "Zayn Furnishings",
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
};

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

  await mkdir(OUTPUT_DIR, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(OUTPUT_DIR, "order-confirmation.html"),
      confirmation.html,
      "utf8",
    ),
    writeFile(
      path.join(OUTPUT_DIR, "order-confirmation.txt"),
      confirmation.text,
      "utf8",
    ),
    writeFile(
      path.join(OUTPUT_DIR, "owner-new-order.html"),
      owner.html,
      "utf8",
    ),
    writeFile(
      path.join(OUTPUT_DIR, "owner-new-order.txt"),
      owner.text,
      "utf8",
    ),
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
