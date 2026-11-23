/** A US ZIP code written anywhere in a free-text address. */
export const zipOf = (address: string | null | undefined) => address?.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? null;

/** Where a passed job is, as precisely as the pros need before accepting: never the street (C-24, guardrail 2). */
export function areaOf(place: { city: string | null; state: string | null }, zip: string | null) {
  const town = [place.city, place.state].filter(Boolean).join(", ");
  return zip ? `${town ? `${town} ` : ""}${zip}` : town;
}
