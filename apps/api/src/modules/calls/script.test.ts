import { describe, expect, it } from "vitest";
import { CONSENT_QUESTION, greeting, isAffirmative } from "./script";

describe("AI Dispatcher script (C-39)", () => {
  it.each(["Yes", "yes please", "Yeah, go ahead", "sure", "OK", "Sí", "absolutely, text me"])("hears %j as a yes", (answer) => {
    expect(isAffirmative(answer)).toBe(true);
  });

  it.each(["No", "no thanks", "don't text me", "nope", "", "uh, I'm not sure", "stop"])("does not hear %j as a yes", (answer) => {
    expect(isAffirmative(answer)).toBe(false);
  });

  it("treats a clear yes as yes even when 'no' appears too", () => {
    expect(isAffirmative("no problem, yes")).toBe(true);
  });

  it("always names the business and never claims to be a person", () => {
    const line = greeting("Rivera Plumbing");
    expect(line).toContain("Rivera Plumbing");
    expect(line).toMatch(/automated assistant/i);
  });

  it("asks for permission to text in plain words, by voice or keypad (C-06)", () => {
    expect(CONSENT_QUESTION).toMatch(/text you/i);
    expect(CONSENT_QUESTION).toMatch(/say yes or press 1/i);
    expect(CONSENT_QUESTION).toMatch(/say no/i);
  });
});
