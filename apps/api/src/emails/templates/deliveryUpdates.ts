import { escapeHtml, safeHeader } from "./escape";
import { formatEmailDate } from "./format";
import {
  orderEmailUrl,
  renderEmailButton,
  renderEmailLayout,
} from "./layout";
import type { RenderedEmail } from "./types";

const INK = "#2A1D14";
const MUTED = "#6B5A4E";
const BORDER = "#E5D9CC";

export type DeliveryScheduledEmailData = {
  orderNumber: string;
  scheduledDate: string;
  timeWindow: string | null;
  deliveryCompany: string | null;
  storeEmail: string;
  webOrigin: string;
  storeName: string;
  dateChanged: boolean;
};

export type OutForDeliveryEmailData = {
  orderNumber: string;
  deliveryCompany: string | null;
  trackingNumber: string | null;
  scheduledDate: string | null;
  timeWindow: string | null;
  webOrigin: string;
  storeName: string;
};

export type DeliveredEmailData = {
  orderNumber: string;
  webOrigin: string;
  storeName: string;
};

function detailRow(label: string, value: string): string {
  return `<tr>
        <td style="padding:6px 0;border-bottom:1px solid ${BORDER};color:${MUTED};">${escapeHtml(label)}</td>
        <td align="right" style="padding:6px 0;border-bottom:1px solid ${BORDER};color:${INK};">${escapeHtml(value)}</td>
      </tr>`;
}

export function renderDeliveryScheduled(
  data: DeliveryScheduledEmailData,
): RenderedEmail {
  const orderUrl = orderEmailUrl(data.webOrigin, data.orderNumber);
  const formattedDate = formatEmailDate(data.scheduledDate);
  const timeWindow = data.timeWindow?.trim() || null;
  const deliveryCompany = data.deliveryCompany?.trim() || null;
  const storeEmail = data.storeEmail.trim();
  const heading = data.dateChanged
    ? "Your delivery date has changed"
    : "Your delivery is scheduled";
  const rows = [
    detailRow("Date", formattedDate),
    ...(timeWindow ? [detailRow("Time window", timeWindow)] : []),
    ...(deliveryCompany
      ? [detailRow("Delivery company", deliveryCompany)]
      : []),
  ].join("");

  const bodyHtml = `
    <h1 style="margin:0 0 12px 0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.3;color:${INK};">
      ${escapeHtml(heading)}
    </h1>
    <p style="margin:0 0 20px 0;color:${MUTED};">
      ${
        data.dateChanged
          ? `The delivery date for order <strong style="color:${INK};">${escapeHtml(data.orderNumber)}</strong> has changed.`
          : `Your delivery for order <strong style="color:${INK};">${escapeHtml(data.orderNumber)}</strong> is scheduled.`
      }
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
      ${rows}
    </table>

    ${renderEmailButton(orderUrl, "View your order")}

    ${
      storeEmail
        ? `<p style="margin:0;color:${MUTED};">If you need to change this, reply to this email.</p>`
        : ""
    }`;

  const textLines = [
    data.storeName,
    "",
    heading,
    "",
    data.dateChanged
      ? `The delivery date for order ${data.orderNumber} has changed.`
      : `Your delivery for order ${data.orderNumber} is scheduled.`,
    "",
    `Date: ${formattedDate}`,
    ...(timeWindow ? [`Time window: ${timeWindow}`] : []),
    ...(deliveryCompany
      ? [`Delivery company: ${deliveryCompany}`]
      : []),
    "",
    `View your order: ${orderUrl}`,
    ...(storeEmail
      ? ["", "If you need to change this, reply to this email."]
      : []),
  ];

  return {
    subject: safeHeader(
      data.dateChanged
        ? `The delivery date for order ${data.orderNumber} has changed`
        : `Your delivery for order ${data.orderNumber} is scheduled`,
    ),
    html: renderEmailLayout({
      title: data.dateChanged
        ? `Delivery date changed for ${data.orderNumber}`
        : `Delivery scheduled for ${data.orderNumber}`,
      storeName: data.storeName,
      bodyHtml,
    }),
    text: `${textLines.join("\n")}\n`,
  };
}

export function renderOutForDelivery(
  data: OutForDeliveryEmailData,
): RenderedEmail {
  const orderUrl = orderEmailUrl(data.webOrigin, data.orderNumber);
  const deliveryCompany = data.deliveryCompany?.trim() || null;
  const trackingNumber = data.trackingNumber?.trim() || null;
  const timeWindow = data.timeWindow?.trim() || null;
  const scheduledDate = data.scheduledDate?.trim()
    ? formatEmailDate(data.scheduledDate)
    : null;
  const scheduleLine =
    scheduledDate && timeWindow
      ? `${scheduledDate}, ${timeWindow}`
      : (scheduledDate ?? timeWindow);
  const rows = [
    ...(deliveryCompany
      ? [detailRow("Delivery company", deliveryCompany)]
      : []),
    ...(trackingNumber
      ? [detailRow("Tracking number", trackingNumber)]
      : []),
    ...(scheduleLine ? [detailRow("Delivery", scheduleLine)] : []),
  ].join("");

  const bodyHtml = `
    <h1 style="margin:0 0 12px 0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.3;color:${INK};">
      Your order is on its way
    </h1>
    <p style="margin:0 0 20px 0;color:${MUTED};">
      Your order <strong style="color:${INK};">${escapeHtml(data.orderNumber)}</strong> is on its way.
    </p>

    ${
      rows
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
      ${rows}
    </table>`
        : ""
    }

    ${renderEmailButton(orderUrl, "View your order")}`;

  const textLines = [
    data.storeName,
    "",
    `Your order ${data.orderNumber} is on its way.`,
    "",
    ...(deliveryCompany
      ? [`Delivery company: ${deliveryCompany}`]
      : []),
    ...(trackingNumber ? [`Tracking number: ${trackingNumber}`] : []),
    ...(scheduleLine ? [`Delivery: ${scheduleLine}`] : []),
    ...(deliveryCompany || trackingNumber || scheduleLine ? [""] : []),
    `View your order: ${orderUrl}`,
  ];

  return {
    subject: safeHeader(`Your order ${data.orderNumber} is on its way`),
    html: renderEmailLayout({
      title: `Order ${data.orderNumber} is on its way`,
      storeName: data.storeName,
      bodyHtml,
    }),
    text: `${textLines.join("\n")}\n`,
  };
}

export function renderDelivered(data: DeliveredEmailData): RenderedEmail {
  const orderUrl = orderEmailUrl(data.webOrigin, data.orderNumber);

  const bodyHtml = `
    <h1 style="margin:0 0 12px 0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.3;color:${INK};">
      Your order was delivered
    </h1>
    <p style="margin:0 0 24px 0;color:${MUTED};">
      Your order <strong style="color:${INK};">${escapeHtml(data.orderNumber)}</strong> was delivered.
    </p>

    ${renderEmailButton(orderUrl, "View your order")}`;

  return {
    subject: safeHeader(`Your order ${data.orderNumber} was delivered`),
    html: renderEmailLayout({
      title: `Order ${data.orderNumber} delivered`,
      storeName: data.storeName,
      bodyHtml,
    }),
    text: `${data.storeName}

Your order ${data.orderNumber} was delivered.

View your order: ${orderUrl}
`,
  };
}
