import { escapeHtml, safeHeader } from "./escape";
import { formatEmailMoney } from "./format";
import { renderEmailLayout } from "./layout";

const INK = "#2A1D14";
const GOLD = "#B8893B";
const MUTED = "#6B5A4E";
const BORDER = "#E5D9CC";

export type OwnerNewOrderData = {
  orderNumber: string;
  customerName: string | null;
  itemCount: number;
  totalCents: number;
  webOrigin: string;
  storeName: string;
};

export type OwnerNewOrderEmail = {
  subject: string;
  html: string;
  text: string;
};

export function renderOwnerNewOrder(
  data: OwnerNewOrderData,
): OwnerNewOrderEmail {
  const orderUrl = `${data.webOrigin}/admin/orders/${encodeURIComponent(
    data.orderNumber,
  )}`;
  const customerName = data.customerName?.trim() || "Customer";
  const total = formatEmailMoney(data.totalCents);

  const bodyHtml = `
    <h1 style="margin:0 0 12px 0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.3;color:${INK};">
      New paid order
    </h1>
    <p style="margin:0 0 20px 0;color:${MUTED};">
      Order <strong style="color:${INK};">${escapeHtml(data.orderNumber)}</strong>
      has been paid.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
      <tr>
        <td style="padding:6px 0;border-bottom:1px solid ${BORDER};color:${MUTED};">Customer</td>
        <td align="right" style="padding:6px 0;border-bottom:1px solid ${BORDER};color:${INK};">${escapeHtml(customerName)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;border-bottom:1px solid ${BORDER};color:${MUTED};">Items</td>
        <td align="right" style="padding:6px 0;border-bottom:1px solid ${BORDER};color:${INK};">${escapeHtml(data.itemCount)}</td>
      </tr>
      <tr>
        <td style="padding:10px 0 0 0;color:${INK};font-weight:bold;">Total</td>
        <td align="right" style="padding:10px 0 0 0;color:${INK};font-weight:bold;">${escapeHtml(total)}</td>
      </tr>
    </table>

    <p style="margin:0;">
      <a href="${escapeHtml(orderUrl)}" style="display:inline-block;padding:12px 20px;background:${GOLD};color:#FFFFFF;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;">
        Open the order
      </a>
    </p>`;

  return {
    subject: safeHeader(
      `New order ${data.orderNumber} (${total})`,
    ),
    html: renderEmailLayout({
      title: `New order ${data.orderNumber}`,
      storeName: data.storeName,
      bodyHtml,
    }),
    text: `${data.storeName}

New paid order ${data.orderNumber}

Customer: ${customerName}
Items: ${data.itemCount}
Total: ${total}

Open the order: ${orderUrl}
`,
  };
}
