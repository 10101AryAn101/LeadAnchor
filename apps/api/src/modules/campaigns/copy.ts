import type { CampaignKind, Trade } from "@leadanchor/contracts";
import type { Holiday, HolidayKey } from "../../integrations/holidays/types";

/** What a business offers, in a phrase: "if you'd like {pitch} before then". */
export const TRADE_PITCH: Record<Trade, string> = {
  plumbing: "a plumbing check (drains, disposal and water heater)",
  electrical: "an electrical safety check",
  hvac: "a heating and cooling check",
  roofing: "a roof inspection",
  handyman: "those small repairs on your list",
  landscaping: "a yard tidy-up",
  salon: "a fresh look",
  grooming: "a groom for your pet",
  spa: "some time to relax",
  auto: "a vehicle check",
  other: "anything on your list",
};

export interface CopyContext {
  business: string;
  ownerFirstName: string | null;
  trade: Trade;
}

export interface Copy {
  name: string;
  subject: string;
  body: string;
}

const signoff = (ctx: CopyContext) =>
  ctx.ownerFirstName
    ? `Thanks,\n${ctx.ownerFirstName}\n${ctx.business}`
    : `Thanks,\nThe team at ${ctx.business}`;

/** The first draft of a new campaign; the owner edits it, or asks the AI for another. */
export function starterCopy(kind: CampaignKind, ctx: CopyContext): Copy {
  switch (kind) {
    case "winback":
      return {
        name: "Win back quiet customers",
        subject: "It's been a while, {first_name}",
        body: `Hi {first_name},\n\nIt's been a while since we last worked for you, and we wanted to say thank you for choosing ${ctx.business}.\n\nIf anything needs looking at, we'd be glad to help again. Pick a time that suits you below.\n\n${signoff(ctx)}`,
      };
    case "promotion":
      return {
        name: "Special offer",
        subject: `A special offer from ${ctx.business}`,
        body: `Hi {first_name},\n\nWe're running a special offer for our customers. Book below and we'll take it from there.\n\n${signoff(ctx)}`,
      };
    case "seasonal":
      return {
        name: "Seasonal check-up",
        subject: "Get ready for the new season",
        body: `Hi {first_name},\n\nThe seasons are changing, which makes now a good time for ${TRADE_PITCH[ctx.trade]}. Book a visit below while there's plenty of choice.\n\n${signoff(ctx)}`,
      };
  }
}

interface Pitch {
  subject: string;
  line: string;
}

/** Trades a freeze sends customers to (C-30). */
const FREEZE: Partial<Record<Trade, Pitch>> = {
  plumbing: {
    subject: "Protect your pipes before the freeze",
    line: "A hard freeze can burst pipes. We can check exposed pipes, outdoor faucets and your water heater before it arrives.",
  },
  hvac: {
    subject: "Is your heating ready for the freeze?",
    line: "Nobody wants the heat to quit on the coldest night. A quick furnace check now can save a no-heat emergency.",
  },
  handyman: {
    subject: "Get your home ready for the freeze",
    line: "We can wrap outdoor pipes, seal drafts and handle the small jobs that keep the cold out.",
  },
  landscaping: {
    subject: "Protect your yard before the freeze",
    line: "We can winterize your sprinklers and protect tender plants before the temperature drops.",
  },
};

/** Trades a heat wave sends customers to. */
const HEAT: Partial<Record<Trade, Pitch>> = {
  hvac: {
    subject: "Is your AC ready for the heat?",
    line: "An AC tune-up now helps it keep up, and keeps you out of the emergency queue when everyone's unit is working hardest.",
  },
  landscaping: {
    subject: "Help your yard through the heat",
    line: "An irrigation check makes sure your lawn and plants get the water they need through the hot spell.",
  },
  auto: {
    subject: "Beat the heat on the road",
    line: "Heat is hard on batteries, coolant and AC. A quick check keeps you cool and moving.",
  },
  grooming: {
    subject: "A cool summer cut for your pet",
    line: "A trim helps pets stay comfortable when the heat arrives.",
  },
};

/** The draft for a forecast freeze or heat wave, or null when it doesn't matter to this trade. */
export function weatherCopy(
  kind: "freeze" | "heat",
  ctx: CopyContext,
  day: string,
  degrees: number,
): Copy | null {
  const pitch = (kind === "freeze" ? FREEZE : HEAT)[ctx.trade];
  if (!pitch) return null;
  const forecast = kind === "freeze" ? `a low of ${degrees}°F` : `a high of ${degrees}°F`;
  return {
    name: pitch.subject,
    subject: pitch.subject,
    body: `Hi {first_name},\n\nThe forecast shows ${forecast} on ${day}. ${pitch.line}\n\nBook a time below.\n\n${signoff(ctx)}`,
  };
}

/** Which holidays bring customers to which trades. */
const HOLIDAY_TRADES: Record<HolidayKey, Trade[]> = {
  new_year: ["salon", "spa"],
  valentines: ["salon", "spa"],
  mothers_day: ["salon", "spa"],
  memorial_day: ["hvac", "landscaping", "auto"],
  fathers_day: ["salon", "spa", "auto"],
  independence_day: ["hvac", "landscaping", "auto"],
  labor_day: ["hvac", "landscaping", "auto"],
  thanksgiving: ["plumbing", "hvac", "electrical", "handyman", "salon", "grooming", "spa"],
  christmas: ["plumbing", "hvac", "electrical", "handyman", "salon", "grooming", "spa"],
};

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The draft before a holiday ("Book before Thanksgiving"), or null when it doesn't matter to this trade. */
export function holidayCopy(holiday: Holiday, ctx: CopyContext, day: string): Copy | null {
  if (!HOLIDAY_TRADES[holiday.key].includes(ctx.trade)) return null;
  return {
    name: `Book before ${holiday.name}`,
    subject: `Book before ${holiday.name}`,
    body: `Hi {first_name},\n\n${capitalized(holiday.name)} is on ${day}, and our calendar fills up fast beforehand. If you'd like ${TRADE_PITCH[ctx.trade]} before then, book a time below.\n\n${signoff(ctx)}`,
  };
}
