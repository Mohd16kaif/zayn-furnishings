import { escapeHtml, safeHeader } from "./escape";
import { formatEmailMoney } from "./format";
import {
  orderEmailUrl,
  renderEmailButton,
  renderEmailLayout,
} from "./layout";
import type { RenderedEmail } from "./types";

export type { RenderedEmail } from "./types";

const INK = "#2A1D14";
const GOLD = "#B8893B";
const MUTED = "#6B5A4E";
const BORDER = "#E5D9CC";

export type OrderConfirmationItem = {
  name: string;
  quantity: number;
  lineTotalCents: number;
};

export type OrderConfirmationAddress = {
  name: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export type OrderConfirmationData = {
  orderNumber: string;
  items: OrderConfirmationItem[];
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
  shippingAddress: OrderConfirmationAddress;
  webOrigin: string;
  storeName: string;
};

function addressLines(address: OrderConfirmationAddress): string[] {
  const cityState = [address.city, address.state]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(", ");
  const cityStateZip = [cityState, address.zip]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");

  return [
    address.name,
    address.line1,
    address.line2,
    cityStateZip,
  ].filter((value): value is string => Boolean(value?.trim()));
}

export function renderOrderConfirmation(
  data: OrderConfirmationData,
): RenderedEmail {
  const orderUrl = orderEmailUrl(data.webOrigin, data.orderNumber);
  const itemRows = data.items
    .map(
      (item) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid ${BORDER};color:${INK};">
          ${escapeHtml(item.name)}
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid ${BORDER};color:${MUTED};text-align:center;white-space:nowrap;">
          ${escapeHtml(item.quantity)}
        </td>
        <td style="padding:10px 0;border-bottom:1px solid ${BORDER};color:${INK};text-align:right;white-space:nowrap;">
          ${escapeHtml(formatEmailMoney(item.lineTotalCents))}
        </td>
      </tr>`,
    )
    .join("");
  const addressHtml = addressLines(data.shippingAddress)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join("");
  const addressText = addressLines(data.shippingAddress).join("\n");

  const bodyHtml = `
    <h1 style="margin:0 0 12px 0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.3;color:${INK};">
      Your order is confirmed
    </h1>
    <p style="margin:0 0 20px 0;color:${MUTED};">
      Thank you for your order. Your order number is
      <strong style="color:${INK};">${escapeHtml(data.orderNumber)}</strong>.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;border-collapse:collapse;">
      <tr>
        <th align="left" style="padding:0 0 8px 0;border-bottom:1px solid ${BORDER};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">Item</th>
        <th align="center" style="padding:0 8px 8px 8px;border-bottom:1px solid ${BORDER};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">Qty</th>
        <th align="right" style="padding:0 0 8px 0;border-bottom:1px solid ${BORDER};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">Total</th>
      </tr>
      ${itemRows}
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
      <tr>
        <td style="padding:3px 0;color:${MUTED};">Subtotal</td>
        <td align="right" style="padding:3px 0;color:${INK};">${escapeHtml(formatEmailMoney(data.subtotalCents))}</td>
      </tr>
      ${
        data.discountCents > 0
          ? `<tr>
        <td style="padding:3px 0;color:${MUTED};">Discount</td>
        <td align="right" style="padding:3px 0;color:${INK};">${escapeHtml(formatEmailMoney(data.discountCents))}</td>
      </tr>`
          : ""
      }
      <tr>
        <td style="padding:3px 0;color:${MUTED};">Delivery</td>
        <td align="right" style="padding:3px 0;color:${INK};">${escapeHtml(formatEmailMoney(data.deliveryFeeCents))}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;color:${MUTED};">Tax</td>
        <td align="right" style="padding:3px 0;color:${INK};">${escapeHtml(formatEmailMoney(data.taxCents))}</td>
      </tr>
      <tr>
        <td style="padding:10px 0 0 0;border-top:1px solid ${BORDER};color:${INK};font-weight:bold;">Total</td>
        <td align="right" style="padding:10px 0 0 0;border-top:1px solid ${BORDER};color:${INK};font-weight:bold;">${escapeHtml(formatEmailMoney(data.totalCents))}</td>
      </tr>
    </table>

    <h2 style="margin:0 0 8px 0;font-family:Georgia,'Times New Roman',serif;font-size:18px;color:${INK};">
      Delivery address
    </h2>
    <div style="margin:0 0 24px 0;color:${MUTED};line-height:1.7;">
      ${addressHtml}
    </div>

    ${renderEmailButton(orderUrl, "View your order")}

    <p style="margin:0;color:${MUTED};">
      We will email you again when your delivery is scheduled.
    </p>`;

  const textItems = data.items
    .map(
      (item) =>
        `- ${item.name} x ${item.quantity} — ${formatEmailMoney(
          item.lineTotalCents,
        )}`,
    )
    .join("\n");

  return {
    subject: safeHeader(`Your order ${data.orderNumber} is confirmed`),
    html: renderEmailLayout({
      title: `Order ${data.orderNumber} confirmed`,
      storeName: data.storeName,
      bodyHtml,
    }),
    text: `${data.storeName}

Your order ${data.orderNumber} is confirmed.

Items:
${textItems}

Subtotal: ${formatEmailMoney(data.subtotalCents)}
${
  data.discountCents > 0
    ? `Discount: ${formatEmailMoney(data.discountCents)}\n`
    : ""
}Delivery: ${formatEmailMoney(data.deliveryFeeCents)}
Tax: ${formatEmailMoney(data.taxCents)}
Total: ${formatEmailMoney(data.totalCents)}

Delivery address:
${addressText}

View your order: ${orderUrl}

We will email you again when your delivery is scheduled.
`,
  };
}
