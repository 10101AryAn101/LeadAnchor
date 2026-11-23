import { ApiError } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "./gemini";
import type { ChatTurnInput } from "./types";

const input: ChatTurnInput = {
  business: {
    name: "Demo Plumbing & Heating",
    trade: "plumbing",
    area: "Austin, TX",
    phone: "(512) 555-0177",
    hours: ["Monday 8 AM–5 PM"],
    services: [
      { ref: "s1", name: "Drain cleaning", description: null, fromPrice: "$150", length: null },
    ],
    claims: [],
    canBookOnline: true,
    notes: null,
  },
  channel: "whatsapp",
  customer: { name: null, hasPhone: true, openJob: null },
  history: [{ from: "customer", text: "My sink is draining slowly." }],
  timeoutMs: 25_000,
};

const answer = {
  text: JSON.stringify({ reply: "We can help with that.", action: "ask", urgency: "normal" }),
};

/** A provider whose Gemini calls go to `generateContent` instead of Google. */
function provider(
  generateContent: (request: { model: string }) => Promise<unknown>,
  fallback?: string,
) {
  const ai = new GeminiProvider("test-key", "main-model", 60_000, fallback);
  Object.assign(ai, { client: { models: { generateContent } } });
  return ai;
}

describe("Gemini retries (the chat assistant can't keep a customer waiting)", () => {
  it("moves to the fallback model when the main one is out of quota", async () => {
    const generateContent = vi.fn(async ({ model }: { model: string }) => {
      if (model === "main-model") throw new ApiError({ message: "quota", status: 429 });
      return answer;
    });
    const turn = await provider(generateContent, "lite-model").chatTurn(input);
    expect(turn.reply).toBe("We can help with that.");
    expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      "main-model",
      "lite-model",
    ]);
  });

  it("gives up at once on a quota error with no fallback set", async () => {
    const generateContent = vi.fn(async () => {
      throw new ApiError({ message: "quota", status: 429 });
    });
    await expect(provider(generateContent).chatTurn(input)).rejects.toThrow("quota");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("asks the fallback, not the busy model, on a chat reply's second try", async () => {
    const generateContent = vi.fn(async ({ model }: { model: string }) => {
      if (model === "main-model") throw new ApiError({ message: "busy", status: 503 });
      return answer;
    });
    await provider(generateContent, "lite-model").chatTurn(input);
    expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      "main-model",
      "lite-model",
    ]);
  });
});
