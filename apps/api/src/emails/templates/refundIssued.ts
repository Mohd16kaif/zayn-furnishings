import { escapeHtml, safeHeader } from "./escape";
import { formatEmailMoney } from "./format";
import {
  orderEmailUrl,
  renderEmailButton,
  renderEmailLayout,
} from "./layout";
import type { RenderedEmail } from "./types";

const INK = "#2A1D14";
const MUTED = "#6B5A4E";
const BORDER = "#E5D9CC";

export type RefundIssuedEmailData = {
  orderNumber: string;
  amountCents: number;
  totalRefundedCents: number;
  webOrigin: string;
  storeName: string;
};

export function renderRefundIssued(
  data: RefundIssuedEmailData,
): RenderedEmail {
  const orderUrl = orderEmailUrl(data.webOrigin, data.orderNumber);
  const amount = formatEmailMoney(data.amountCents);
  const total = formatEmailMoney(data.totalRefundedCents);

  const bodyHtml = `
    <h1 style="margin:0 0 12px 0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.3;color:${INK};">
      Your refund was issued
    </h1>
    <p style="margin:0 0 20px 0;color:${MUTED};">
      Your refund for order <strong style="color:${INK};">${escapeHtml(data.orderNumber)}</strong> was issued.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
      <tr>
        <td style="padding:6px 0;border-bottom:1px solid ${BORDER};color:${MUTED};">Refunded this time</td>
        <td align="right" style="padding:6px 0;border-bottom:1px solid ${BORDER};color:${INK};">${escapeHtml(amount)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;border-bottom:1px solid ${BORDER};color:${MUTED};">Total refunded so far</td>
        <td align="right" style="padding:6px 0;border-bottom:1px solid ${BORDER};color:${INK};">${escapeHtml(total)}</td>
      </tr>
    </table>

    <p style="margin:0 0 24px 0;color:${MUTED};">
      It was sent to your original payment method. How long it takes to appear depends on your bank.
    </p>

    ${renderEmailButton(orderUrl, "View your order")}`;

  return {
    subject: safeHeader(`Your refund for order ${data.orderNumber}`),
    html: renderEmailLayout({
      title: `Refund for order ${data.orderNumber}`,
      storeName: data.storeName,
      bodyHtml,
    }),
    text: `${data.storeName}

Your refund for order ${data.orderNumber} was issued.

Refunded this time: ${amount}
Total refunded so far: ${total}

It was sent to your original payment method. How long it takes to appear depends on your bank.

View your order: ${orderUrl}
`,
  };
}
