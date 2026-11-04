import { type PublicProfile, type Trade, WEEKDAY_KEYS, WEEKDAY_LABELS, type WeekdayKey, formatPhone } from "@leadanchor/contracts";

/**
 * C-42: what AI assistants and search engines can read about a business, built only from its
 * real records: jobs it won, what people asked for, its own settings and its Google rating. No
 * invented services, reviews or places (AC d), and nothing about customers below ZIP level (AC g).
 */

/** What a customer would ask an assistant for: "a plumber", "an electrician". */
export const TRADE_NOUN: Record<Trade, string> = {
  plumbing: "plumber",
  electrical: "electrician",
  hvac: "heating and air conditioning company",
  roofing: "roofer",
  handyman: "handyman",
  landscaping: "landscaper",
  salon: "hair salon",
  grooming: "dog groomer",
  spa: "day spa",
  auto: "auto repair shop",
  other: "home services company",
};

/** The closest schema.org type for each trade. */
const SCHEMA_TYPE: Record<Trade, string> = {
  plumbing: "Plumber",
  electrical: "Electrician",
  hvac: "HVACBusiness",
  roofing: "RoofingContractor",
  handyman: "HomeAndConstructionBusiness",
  landscaping: "HomeAndConstructionBusiness",
  salon: "HairSalon",
  grooming: "LocalBusiness",
  spa: "DaySpa",
  auto: "AutoRepair",
  other: "LocalBusiness",
};

const WEEK: WeekdayKey[] = [...WEEKDAY_KEYS.slice(1), "sun"];
const SCHEMA_DAY: Record<WeekdayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export interface AiProfileFacts {
  name: string;
  trade: Trade;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  /** The LeadAnchor line, so calls from AI answers are caught too. */
  phone: string | null;
  pageUrl: string;
  bookingUrl: string | null;
  licenseNumber: string | null;
  insuranceCarrier: string | null;
  yearsInBusiness: number | null;
  googleProfileUrl: string | null;
  website: string | null;
  rating: { average: number; count: number } | null;
  /** Services it really did in the last year, most first; its own price list when it has no jobs yet. */
  services: Array<{ name: string; jobs: number }>;
  /** What people got in touch about in the last year, most first. */
  asks: Array<{ reason: string; count: number }>;
  /** ZIP codes of jobs done in the last year, most first. */
  zips: string[];
  hours: Partial<Record<WeekdayKey, { open: boolean; start: string; end: string }>> | null;
  photoUrls: string[];
  updatedAt: Date;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const place = (facts: AiProfileFacts) => [facts.city, facts.state].filter(Boolean).join(", ");
const zipList = (zips: string[]) => (zips.length > 1 ? `${zips.slice(0, -1).join(", ")} and ${zips.at(-1)}` : (zips[0] ?? ""));

function trustLine(facts: AiProfileFacts) {
  if (facts.licenseNumber && facts.insuranceCarrier) {
    return `The owner states they're licensed (${facts.state ? `${facts.state} ` : ""}#${facts.licenseNumber}) and insured with ${facts.insuranceCarrier}.`;
  }
  if (facts.licenseNumber) return `The owner states they're licensed (${facts.state ? `${facts.state} ` : ""}#${facts.licenseNumber}).`;
  if (facts.insuranceCarrier) return `The owner states they're insured with ${facts.insuranceCarrier}.`;
  return null;
}

function contactLine(facts: AiProfileFacts) {
  const phone = facts.phone ? formatPhone(facts.phone) : null;
  if (facts.bookingUrl && phone) return `Book online at ${facts.bookingUrl} or call ${phone}.`;
  if (facts.bookingUrl) return `Book online at ${facts.bookingUrl}.`;
  if (phone) return `Call or text ${phone}.`;
  return null;
}

/**
 * A 40-60 word direct answer for "who does {service} near me" (C-42 point 3). Optional true
 * sentences are dropped while it's too long, and true filler is added while it's too short.
 */
export function answerFor(facts: AiProfileFacts, service: { name: string; jobs: number }) {
  const where = place(facts);
  const lead =
    service.jobs > 0
      ? `${facts.name} is a ${TRADE_NOUN[facts.trade]}${where ? ` in ${where}` : ""} that did ${service.jobs} ${service.name.toLowerCase()} ${service.jobs === 1 ? "job" : "jobs"} in the last year.`
      : `${facts.name} is a ${TRADE_NOUN[facts.trade]}${where ? ` in ${where}` : ""} offering ${service.name.toLowerCase()}.`;
  const optional = [
    facts.zips.length > 0 ? `Recent jobs were in ZIP ${zipList(facts.zips.slice(0, 3))}.` : null,
    facts.rating ? `Rated ${facts.rating.average.toFixed(1)} out of 5 from ${facts.rating.count} Google ${facts.rating.count === 1 ? "review" : "reviews"}.` : null,
    facts.yearsInBusiness ? `In business for ${facts.yearsInBusiness} ${facts.yearsInBusiness === 1 ? "year" : "years"}.` : null,
  ].filter((line): line is string => line !== null);
  const fixed = [trustLine(facts), contactLine(facts)].filter((line): line is string => line !== null);
  const filler = [
    "Customers can send photos of the job through a short request form for a quicker, more accurate answer.",
    "A missed call gets a text back right away.",
  ];

  const build = (parts: string[]) => [lead, ...parts, ...fixed].join(" ");
  let extra = [...optional];
  // Too long: drop the optional facts from the end, keeping the most useful first.
  while (words(build(extra)) > 60 && extra.length > 0) extra = extra.slice(0, -1);
  // Too short: true statements about how to reach them.
  for (const line of filler) if (words(build(extra)) < 40) extra = [...extra, line];
  return build(extra);
}

/** C-42 point 4: questions people really ask, answered from the business's own records. */
export function faqFor(facts: AiProfileFacts, hours: Array<{ day: string; hours: string }>) {
  const where = place(facts) || "your area";
  const faq: Array<{ question: string; answer: string }> = [];
  for (const ask of facts.asks.slice(0, 3)) {
    faq.push({
      question: `Do you handle ${ask.reason.toLowerCase()} in ${where}?`,
      answer: `Yes. ${facts.name} handled ${ask.count} ${ask.reason.toLowerCase()} ${ask.count === 1 ? "request" : "requests"} in the last year${
        facts.zips.length > 0 ? `, including in ZIP ${zipList(facts.zips.slice(0, 3))}` : ""
      }.`,
    });
  }
  if (facts.zips.length > 0) {
    faq.push({ question: "Which areas do you serve?", answer: `Recent jobs were in ZIP codes ${zipList(facts.zips.slice(0, 8))}.` });
  }
  const trust = trustLine(facts);
  if (trust) faq.push({ question: "Are you licensed and insured?", answer: `${trust} These details are provided by ${facts.name}.` });
  const open = hours.filter((day) => day.hours !== "Closed");
  if (open.length > 0) {
    faq.push({ question: "What are your hours?", answer: hours.map((day) => `${day.day}: ${day.hours}`).join("; ") + "." });
  }
  if (facts.bookingUrl) faq.push({ question: "Can I book online?", answer: `Yes: pick a time at ${facts.bookingUrl}.` });
  return faq;
}

const clock = (value: string) => {
  const [hour, minute] = value.split(":").map(Number) as [number, number];
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
};

export function hoursOf(facts: AiProfileFacts) {
  if (!facts.hours) return [];
  return WEEK.map((day) => {
    const open = facts.hours?.[day];
    return { day: WEEKDAY_LABELS[day], hours: open?.open ? `${clock(open.start)} – ${clock(open.end)}` : "Closed" };
  });
}

/** schema.org JSON-LD (C-42 point 1): LocalBusiness with Service, area, hours, rating, and the FAQ. */
export function jsonLdFor(facts: AiProfileFacts, faq: Array<{ question: string; answer: string }>) {
  const business: Record<string, unknown> = {
    "@type": SCHEMA_TYPE[facts.trade],
    "@id": `${facts.pageUrl}#business`,
    name: facts.name,
    url: facts.pageUrl,
    ...(facts.phone && { telephone: facts.phone }),
    // Town and ZIP only: many trades work from home, so no street.
    ...((facts.city || facts.state || facts.postalCode) && {
      address: {
        "@type": "PostalAddress",
        ...(facts.city && { addressLocality: facts.city }),
        ...(facts.state && { addressRegion: facts.state }),
        ...(facts.postalCode && { postalCode: facts.postalCode }),
        addressCountry: "US",
      },
    }),
    ...(facts.zips.length > 0 && {
      areaServed: facts.zips.map((zip) => ({
        "@type": "Place",
        address: { "@type": "PostalAddress", postalCode: zip, ...(facts.state && { addressRegion: facts.state }), addressCountry: "US" },
      })),
    }),
    ...(facts.services.length > 0 && {
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        name: "Services",
        itemListElement: facts.services.map((service) => ({
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: service.name },
        })),
      },
    }),
    ...(facts.hours && {
      openingHoursSpecification: WEEK.filter((day) => facts.hours?.[day]?.open).map((day) => ({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: `https://schema.org/${SCHEMA_DAY[day]}`,
        opens: facts.hours![day]!.start,
        closes: facts.hours![day]!.end,
      })),
    }),
    ...(facts.rating && {
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: Number(facts.rating.average.toFixed(1)),
        reviewCount: facts.rating.count,
        bestRating: 5,
        worstRating: 1,
      },
    }),
    ...(facts.photoUrls.length > 0 && { image: facts.photoUrls.slice(0, 6) }),
    ...((facts.googleProfileUrl || facts.website) && { sameAs: [facts.googleProfileUrl, facts.website].filter(Boolean) }),
  };
  const graph: Record<string, unknown>[] = [business];
  if (faq.length > 0) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${facts.pageUrl}#faq`,
      mainEntity: faq.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graph, dateModified: facts.updatedAt.toISOString() };
}

/** Everything the public page needs for AI discovery. */
export function aiProfileOf(facts: AiProfileFacts): NonNullable<PublicProfile["discovery"]> {
  const hours = hoursOf(facts);
  const faq = faqFor(facts, hours);
  return {
    jsonLd: jsonLdFor(facts, faq),
    answers: facts.services.slice(0, 4).map((service) => ({ service: service.name, text: answerFor(facts, service) })),
    faq,
    areaServed: facts.zips.slice(0, 12),
    hours,
    updatedAt: facts.updatedAt.toISOString(),
  };
}
