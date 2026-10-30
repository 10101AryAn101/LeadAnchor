import { formatPhone } from "@leadanchor/contracts";
import { escapeHtml } from "../../lib/html";
import { dollars, lineTotal } from "../payments/money";

export interface QuoteDocument {
  business: {
    name: string;
    tradeLabel: string;
    city: string | null;
    state: string | null;
    phone: string | null;
    licenseNumber: string | null;
    insuranceCarrier: string | null;
    yearsInBusiness: number | null;
    googleProfileUrl: string | null;
    profileUrl: string;
  };
  number: string;
  issuedAt: Date;
  validUntil: Date | null;
  /** The owner's preview of a quote that hasn't gone out. */
  draft: boolean;
  customer: {
    name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
  };
  title: string;
  lines: Array<{ description: string; quantity: number; unitPriceCents: number | null }>;
  totalCents: number;
  depositCents: number | null;
  depositCapture: "hold" | "charge";
  notes: string | null;
  acceptUrl: string | null;
  timezone: string;
}

const escape = escapeHtml;

/**
 * The branded quote (C-45): business name, licence and the profile block (C-41), the lines
 * from the owner's price list, the total and how to accept. Self-contained HTML (no scripts,
 * fonts or images from elsewhere) so the PDF renderer needs no network.
 */
export function quoteHtml(doc: QuoteDocument) {
  const date = (value: Date) =>
    new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: doc.timezone }).format(value);
  const b = doc.business;
  const place = [b.city, b.state].filter(Boolean).join(", ");
  const claims = [
    b.licenseNumber && b.insuranceCarrier ? "Licensed &amp; insured" : null,
    b.licenseNumber ? `Licence ${escape(b.licenseNumber)}` : null,
    b.insuranceCarrier ? `Insured by ${escape(b.insuranceCarrier)}` : null,
    b.yearsInBusiness
      ? `${b.yearsInBusiness} ${b.yearsInBusiness === 1 ? "year" : "years"} in business`
      : null,
  ].filter(Boolean);

  const rows = doc.lines
    .map(
      (line) => `
        <tr>
          <td class="desc">${escape(line.description)}</td>
          <td class="num">${line.quantity}</td>
          <td class="num">${line.unitPriceCents == null ? "—" : dollars(line.unitPriceCents)}</td>
          <td class="num strong">${line.unitPriceCents == null ? "—" : dollars(lineTotal(line))}</td>
        </tr>`,
    )
    .join("");

  const deposit =
    doc.depositCents != null
      ? `<tr class="deposit"><td colspan="3">Deposit to book${doc.depositCapture === "hold" ? " <span>(held on your card, charged when the work goes ahead)</span>" : ""}</td><td class="num">${dollars(doc.depositCents)}</td></tr>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escape(b.name)} · Quote ${escape(doc.number)}</title>
<style>
  @page { size: Letter; margin: 0.55in 0.6in; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10.5pt/1.5 "Segoe UI", system-ui, -apple-system, Helvetica, Arial, sans-serif; color: #1c2321; }
  .draft { margin-bottom: 14pt; padding: 7pt 10pt; border-radius: 6pt; background: #fff4d6; color: #7a5300; font-weight: 600; }
  header { display: flex; justify-content: space-between; gap: 24pt; padding-bottom: 14pt; border-bottom: 2.5pt solid #155e63; }
  .brand h1 { margin: 0; font-size: 20pt; line-height: 1.15; letter-spacing: -0.01em; color: #10302f; }
  .brand p { margin: 3pt 0 0; color: #4b5552; }
  .claims { margin-top: 8pt !important; color: #155e63 !important; font-weight: 600; }
  .doc { text-align: right; white-space: nowrap; }
  .doc .kind { font-size: 9pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #155e63; }
  .doc .number { font-size: 16pt; font-weight: 700; }
  .doc p { margin: 2pt 0 0; color: #4b5552; }
  .parties { display: flex; gap: 24pt; margin: 16pt 0 6pt; }
  .parties > div { flex: 1; }
  .label { margin: 0 0 3pt; font-size: 8.5pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #6b7471; }
  .parties p { margin: 0; }
  .job { font-size: 12pt; font-weight: 600; }
  table { width: 100%; margin-top: 14pt; border-collapse: collapse; }
  th { padding: 6pt 0; border-bottom: 1pt solid #c9cfcc; font-size: 8.5pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7471; text-align: left; }
  th.num, td.num { text-align: right; padding-left: 14pt; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td { padding: 8pt 0; border-bottom: 0.75pt solid #e3e7e5; vertical-align: top; }
  td.desc { width: 60%; }
  .strong { font-weight: 600; }
  tr.total td { border-bottom: none; padding-top: 12pt; font-size: 13pt; font-weight: 700; }
  tr.deposit td { border-bottom: none; padding-top: 2pt; color: #4b5552; }
  tr.deposit span { font-size: 9pt; }
  .notes { margin-top: 18pt; padding: 10pt 12pt; border-radius: 6pt; background: #f3f6f5; white-space: pre-wrap; }
  .accept { margin-top: 16pt; padding: 12pt 14pt; border: 1pt solid #155e63; border-radius: 8pt; }
  .accept p { margin: 0; }
  .accept a { color: #155e63; font-weight: 600; word-break: break-all; }
  footer { margin-top: 22pt; padding-top: 10pt; border-top: 0.75pt solid #e3e7e5; font-size: 8.5pt; color: #6b7471; }
  footer p { margin: 0 0 2pt; }
  footer a { color: #155e63; }
</style>
</head>
<body>
  ${doc.draft ? `<div class="draft">Draft: not sent to the customer yet.</div>` : ""}
  <header>
    <div class="brand">
      <h1>${escape(b.name)}</h1>
      <p>${escape(b.tradeLabel)}${place ? ` · ${escape(place)}` : ""}${b.phone ? ` · ${escape(formatPhone(b.phone))}` : ""}</p>
      ${claims.length > 0 ? `<p class="claims">${claims.join(" · ")}</p>` : ""}
    </div>
    <div class="doc">
      <div class="kind">Quote</div>
      <div class="number">${escape(doc.number)}</div>
      <p>${date(doc.issuedAt)}</p>
      ${doc.validUntil ? `<p>Valid until ${date(doc.validUntil)}</p>` : ""}
    </div>
  </header>

  <section class="parties">
    <div>
      <p class="label">Prepared for</p>
      <p class="strong">${escape(doc.customer.name ?? "Customer")}</p>
      ${doc.customer.phone ? `<p>${escape(formatPhone(doc.customer.phone))}</p>` : ""}
      ${doc.customer.email ? `<p>${escape(doc.customer.email)}</p>` : ""}
      ${doc.customer.address ? `<p>${escape(doc.customer.address)}</p>` : ""}
    </div>
    <div>
      <p class="label">Job</p>
      <p class="job">${escape(doc.title)}</p>
    </div>
  </section>

  <table>
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>
    <tbody>
      ${rows}
      <tr class="total"><td colspan="3">Total</td><td class="num">${dollars(doc.totalCents)}</td></tr>
      ${deposit}
    </tbody>
  </table>

  ${doc.notes ? `<div class="notes">${escape(doc.notes)}</div>` : ""}

  ${
    doc.acceptUrl
      ? `<div class="accept"><p class="strong">Accept this quote online</p><p><a href="${escape(doc.acceptUrl)}">${escape(doc.acceptUrl)}</a></p></div>`
      : ""
  }

  <footer>
    <p>Prices come from ${escape(b.name)}'s own price list.${b.licenseNumber || b.insuranceCarrier ? ` Licence and insurance details are as stated by ${escape(b.name)}.` : ""}</p>
    <p>About us: <a href="${escape(b.profileUrl)}">${escape(b.profileUrl)}</a>${b.googleProfileUrl ? ` · Reviews: <a href="${escape(b.googleProfileUrl)}">Google</a>` : ""}</p>
  </footer>
</body>
</html>`;
}
