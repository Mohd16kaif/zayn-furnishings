import { escapeHtml } from "./escape";

const BACKGROUND = "#FAF7F2";
const INK = "#2A1D14";
const GOLD = "#B8893B";
const MUTED = "#6B5A4E";
const BORDER = "#E5D9CC";

export function renderEmailLayout({
  title,
  storeName,
  bodyHtml,
}: {
  title: string;
  storeName: string;
  bodyHtml: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${BACKGROUND};color:${INK};font-family:Georgia,'Times New Roman',serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BACKGROUND};margin:0;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#FFFFFF;border:1px solid ${BORDER};">
            <tr>
              <td style="padding:28px 28px 18px 28px;border-bottom:1px solid ${BORDER};">
                <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:20px;letter-spacing:0.08em;text-transform:uppercase;color:${INK};">
                  ${escapeHtml(storeName)}
                </p>
                <p style="margin:8px 0 0 0;height:3px;width:56px;background:${GOLD};font-size:0;line-height:0;">&nbsp;</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:${INK};">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 26px 28px;border-top:1px solid ${BORDER};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${MUTED};">
                This message was sent by ${escapeHtml(storeName)}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
