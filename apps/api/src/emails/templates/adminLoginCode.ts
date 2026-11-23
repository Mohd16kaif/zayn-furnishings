import { escapeHtml, safeHeader } from "./escape";
import { renderEmailLayout } from "./layout";
import type { RenderedEmail } from "./types";

const INK = "#2A1D14";
const MUTED = "#6B5A4E";
const BORDER = "#E5D9CC";

export type AdminLoginCodeData = {
  code: string;
  expiresMinutes: number;
  storeName: string;
  requestedIp: string | null;
};

export function renderAdminLoginCode(
  data: AdminLoginCodeData,
): RenderedEmail {
  const ipLine = data.requestedIp
    ? `<p style="margin:0 0 20px 0;color:${MUTED};font-size:13px;">
        Requested from IP ${escapeHtml(data.requestedIp)}.
      </p>`
    : "";
  const ipText = data.requestedIp
    ? `Requested from IP ${data.requestedIp}.\n`
    : "";

  const bodyHtml = `
    <h1 style="margin:0 0 12px 0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.3;color:${INK};">
      Admin sign-in code
    </h1>
    <p style="margin:0 0 20px 0;color:${MUTED};">
      Use this code to sign in to the ${escapeHtml(data.storeName)} admin.
      It expires in ${escapeHtml(data.expiresMinutes)} minutes.
    </p>
    <p style="margin:0 0 20px 0;padding:16px 0;border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};font-family:Consolas,'Courier New',monospace;font-size:32px;letter-spacing:0.3em;font-weight:bold;color:${INK};text-align:center;">
      ${escapeHtml(data.code)}
    </p>
    ${ipLine}
    <p style="margin:0;color:${MUTED};font-size:13px;">
      If you did not request this code, you can ignore this email.
      Never share this code with anyone.
    </p>`;

  return {
    subject: safeHeader(`Your ${data.storeName} admin sign-in code`),
    html: renderEmailLayout({
      title: "Admin sign-in code",
      storeName: data.storeName,
      bodyHtml,
    }),
    text: `${data.storeName} admin sign-in code

Use this code to sign in to the admin:

${data.code}

It expires in ${data.expiresMinutes} minutes.
${ipText}
If you did not request this code, you can ignore this email.
Never share this code with anyone.
`,
  };
}
