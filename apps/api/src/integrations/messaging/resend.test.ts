import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendEmail, verifyResendSignature } from "./resend";

const KEY = Buffer.from("leadanchor-test-signing-key");
const SECRET = `whsec_${KEY.toString("base64")}`;
const sign = (id: string, timestamp: string, body: string) =>
  createHmac("sha256", KEY).update(`${id}.${timestamp}.${body}`).digest("base64");

describe("Resend webhook signature", () => {
  const body = JSON.stringify({ type: "email.bounced", data: { email_id: "em_1" } });
  const now = Date.now();
  const timestamp = String(Math.floor(now / 1000));
  const check = (signature: string, at = timestamp) =>
    verifyResendSignature({
      rawBody: body,
      id: "msg_1",
      timestamp: at,
      signature,
      secret: SECRET,
      now,
    });

  it("accepts Resend's signature, including when it sends more than one", () => {
    expect(check(`v1,${sign("msg_1", timestamp, body)}`)).toBe(true);
    expect(check(`v1,bm90LWl0 v1,${sign("msg_1", timestamp, body)}`)).toBe(true);
  });

  it("refuses a changed body, a wrong secret, a missing header or an old delivery", () => {
    expect(check(`v1,${sign("msg_1", timestamp, `${body} `)}`)).toBe(false);
    expect(check(`v1,${createHmac("sha256", "other").update("x").digest("base64")}`)).toBe(false);
    expect(check("")).toBe(false);
    const old = String(Math.floor(now / 1000) - 3600);
    expect(check(`v1,${sign("msg_1", old, body)}`, old)).toBe(false);
  });
});

describe("Resend sending in test mode", () => {
  afterEach(() => vi.unstubAllGlobals());

  const sent = () => {
    const calls: Array<{ to: string[]; subject: string; text: string; html?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ id: "em_123" }), { status: 200 });
      }),
    );
    return calls;
  };
  const email = (to: string) => ({
    id: "11111111-1111-4111-8111-111111111111",
    from: '"Demo Plumbing via LeadAnchor" <onboarding@resend.dev>',
    to,
    subject: "Your receipt",
    body: "Thanks!",
    html: "<p>Thanks!</p>",
  });

  it("sends every email to the test inbox, saying who it was for", async () => {
    const calls = sent();
    const result = await new ResendEmail("re_test", "me@example.com").send(
      email("customer@example.com"),
    );
    expect(result).toEqual({ providerMessageId: "em_123", delivered: false });
    expect(calls[0]!.to).toEqual(["me@example.com"]);
    expect(calls[0]!.subject).toBe("[for customer@example.com] Your receipt");
    expect(calls[0]!.text).toBe("Test mode: this email was for customer@example.com.\n\nThanks!");
    expect(calls[0]!.html).toContain("this email was for customer@example.com");
  });

  it("lets Resend's own test addresses through, and sends normally without a test inbox", async () => {
    const calls = sent();
    await new ResendEmail("re_test", "me@example.com").send(email("bounced@resend.dev"));
    await new ResendEmail("re_test", undefined).send(email("customer@example.com"));
    expect(calls.map((call) => call.to[0])).toEqual(["bounced@resend.dev", "customer@example.com"]);
    expect(calls[1]!.subject).toBe("Your receipt");
  });

  it("fails loudly when Resend refuses, so the send is retried and the reason kept", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ message: "Invalid API key" }), { status: 403 }),
      ),
    );
    await expect(new ResendEmail("bad", undefined).send(email("a@b.co"))).rejects.toThrow(
      "Resend refused the email (403): Invalid API key",
    );
  });
});
