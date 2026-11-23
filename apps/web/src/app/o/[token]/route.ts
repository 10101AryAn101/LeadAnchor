import { NextResponse } from "next/server";

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

const EXPIRED = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Link expired</title></head>
<body style="margin:0;display:grid;min-height:100dvh;place-items:center;background:#f4f2ec;font:16px/1.5 -apple-system,'Segoe UI',Roboto,sans-serif;color:#1f2a28">
<main style="max-width:420px;padding:24px;text-align:center"><h1 style="font-size:22px;margin:0 0 8px">This link has expired</h1>
<p style="margin:0;color:#5f6b68">Please call or reply to the business that emailed you.</p></main></body></html>`;

/**
 * Module 11: the button in a campaign email. The tap is counted, then the customer goes on to
 * the booking page (or the request form) with the offer attached.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (/^[\w-]{20,64}$/.test(token)) {
    try {
      const response = await fetch(
        `${API_URL}/api/public/campaign-links/${encodeURIComponent(token)}/open`,
        { method: "POST", cache: "no-store" },
      );
      if (response.ok) {
        const { url } = (await response.json()) as { url: string };
        return NextResponse.redirect(url, 302);
      }
    } catch {
      // Falls through to the expired page.
    }
  }
  return new NextResponse(EXPIRED, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
