import type { MessageChannel } from "@leadanchor/contracts";

/** Carrier-standard opt-out keywords (C-27: STOP → REVOKED within 10 business days; we do it instantly). */
const OPT_OUT = /^\s*(stop|stop\s*all|unsubscribe|cancel|end|quit|revoke|opt[\s-]?out)\s*[.!]*\s*$/i;
/** Carrier-standard opt back in. */
const OPT_IN = /^\s*(start|unstop)\s*[.!]*\s*$/i;
/** Carrier-standard help request. */
const HELP = /^\s*(help|info)\s*[.!?]*\s*$/i;

/**
 * C-27 "clear intent": a plain request to stop texts counts as much as the keyword (the FCC's
 * "any reasonable means"). Only phrases about texts, messages or lists, so "stop the leak" or
 * "I can't stop the water" aren't opt-outs. "Cancel" stays keyword-only: on its own it's the
 * carrier keyword, but in a sentence it usually means a booking (C-20).
 */
const OPT_OUT_PHRASES = [
  /^\s*(please\s+)?(stop|unsubscribe|quit|end)(\s+(please|now|all|it|this|them|thanks|thank\s+you))+\s*[.!]*\s*$/i,
  /\b(stop|quit|cease)\s+(texting|messaging|sending|contacting|spamming)\b/i,
  /\b(don'?t|don’t|do\s+not|never)\s+(text|message)\b/i,
  /\bno\s+more\s+(texts|messages|msgs)\b/i,
  /\b(unsubscribe|opt[\s-]?out)\b/i,
  /\b(take|remove)\s+(me|my\s+number)\s+(off|from)\b/i,
];

/** The exact carrier keyword (STOP, CANCEL…), as opposed to a request in plain words. */
export const isStopKeyword = (text: string) => OPT_OUT.test(text);

/** The customer withdrew permission to text: by keyword anywhere, or in plain words on a text or WhatsApp. */
export const optsOut = (text: string, channel: MessageChannel) =>
  OPT_OUT.test(text) || (channel !== "email" && OPT_OUT_PHRASES.some((phrase) => phrase.test(text)));

export const optsIn = (text: string) => OPT_IN.test(text);
export const asksForHelp = (text: string) => HELP.test(text);
