import { formatPhone } from "@leadanchor/contracts";
import { escapeHtml } from "../../lib/html";

/** One customer's campaign email, with the merge field already filled in. */
export interface CampaignEmail {
  business: { name: string; phone: string | null };
  subject: string;
  body: string;
  offer: string | null;
  /** "Sunday, November 30" */
  offerEnds: string | null;
  button: { label: string; url: string };
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = "#1f2a28";
const MUTED = "#5f6b68";
const BRAND = "#155e63";

/** The plain-text version. The send path adds the unsubscribe footer. */
export function campaignText(email: CampaignEmail) {
  const parts = [email.body.trim()];
  if (email.offer)
    parts.push(`Your offer: ${email.offer}${email.offerEnds ? ` (until ${email.offerEnds})` : ""}`);
  parts.push(`${email.button.label}: ${email.button.url}`);
  if (email.business.phone) parts.push(`Or call ${formatPhone(email.business.phone)}`);
  return parts.join("\n\n");
}

const paragraphs = (text: string) =>
  text
    .trim()
    .split(/\n{2,}/)
    .map(
      (block) =>
        `<p style="margin:0 0 16px">${block
          .split("\n")
          .map((line) => escapeHtml(line))
          .join("<br>")}</p>`,
    )
    .join("");

/**
 * The designed version: simple tables and inline styles, which every mail app shows the same.
 * "<!--footer-->" is where the send path puts the unsubscribe footer (CAN-SPAM).
 */
export function campaignHtml(email: CampaignEmail) {
  const preview = email.body
    .replace(/^hi [^\n]*\n+/i, "")
    .replace(/\s+/g, " ")
    .slice(0, 110);
  const offer = email.offer
    ? `<tr><td style="padding:4px 28px 8px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8f2f1;border-radius:10px">
    <tr><td style="padding:16px 18px;font:15px/1.5 ${FONT};color:#123f42">
      <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${BRAND}">Your offer</div>
      <div style="font-size:19px;font-weight:700;margin-top:4px">${escapeHtml(email.offer)}</div>
      ${email.offerEnds ? `<div style="margin-top:4px;color:#3d5654">Until ${escapeHtml(email.offerEnds)}</div>` : ""}
    </td></tr>
  </table>
</td></tr>`
    : "";
  const phone = email.business.phone
    ? `<p style="margin:14px 0 0;font:14px/1.5 ${FONT};color:${MUTED}">Or call ${escapeHtml(formatPhone(email.business.phone))}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(email.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f2ec">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ec">
<tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e1d8;border-radius:12px">
    <tr><td style="padding:18px 28px;border-bottom:1px solid #eeeae2;font:700 17px/1.3 ${FONT};color:${BRAND}">${escapeHtml(email.business.name)}</td></tr>
    <tr><td style="padding:24px 28px 4px;font:16px/1.6 ${FONT};color:${INK}">${paragraphs(email.body)}</td></tr>
    ${offer}
    <tr><td style="padding:12px 28px 28px">
      <a href="${escapeHtml(email.button.url)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font:600 16px/1 ${FONT};padding:14px 24px;border-radius:999px">${escapeHtml(email.button.label)}</a>
      ${phone}
    </td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:16px 28px;font:12px/1.5 ${FONT};color:${MUTED}"><!--footer--></td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}
