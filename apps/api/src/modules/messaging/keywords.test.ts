import { describe, expect, it } from "vitest";
import { asksForHelp, isStopKeyword, optsIn, optsOut } from "./keywords";

describe("opting out of texts (C-27)", () => {
  it.each(["STOP", "stop.", "Stop all", "unsubscribe", "CANCEL", "end", "quit", "opt out", "Opt-out!"])("hears the keyword %j", (text) => {
    expect(optsOut(text, "sms")).toBe(true);
    expect(isStopKeyword(text)).toBe(true);
  });

  it.each([
    "Stop texting me",
    "please stop messaging me!",
    "stop sending me these",
    "Don't text me again",
    "don’t message me",
    "do not text this number",
    "No more texts please",
    "please unsubscribe me",
    "I want to opt out",
    "take me off your list",
    "remove my number from this",
    "stop please",
    "STOP NOW",
    "Stop it",
  ])("hears the plain request %j", (text) => {
    expect(optsOut(text, "sms")).toBe(true);
    expect(optsOut(text, "whatsapp")).toBe(true);
  });

  it.each([
    "Can you stop the leak today?",
    "I can't stop the water from running",
    "The toilet won't stop running",
    "please cancel my appointment",
    "Yes",
    "No thanks, I found someone",
    "When can you come?",
    "text me when you're on the way",
  ])("doesn't treat %j as an opt-out", (text) => {
    expect(optsOut(text, "sms")).toBe(false);
  });

  it("only treats exact keywords as opt-outs in email replies", () => {
    expect(optsOut("stop texting me", "email")).toBe(false);
    expect(optsOut("STOP", "email")).toBe(true);
  });

  it("keeps the carrier's START and HELP", () => {
    expect(optsIn("START")).toBe(true);
    expect(optsIn("start the job")).toBe(false);
    expect(asksForHelp("help?")).toBe(true);
  });
});
