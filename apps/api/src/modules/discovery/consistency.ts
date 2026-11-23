/**
 * C-42 point 5: the services check in "details match everywhere". A service on the owner's price
 * list should show up on their website and on Google too, or AI answers can't connect them.
 */

/** Words that don't make a service recognisable on their own. */
const GENERIC = new Set([
  "a",
  "an",
  "and",
  "for",
  "install",
  "installation",
  "installs",
  "new",
  "of",
  "or",
  "repair",
  "repairs",
  "replace",
  "replacement",
  "service",
  "services",
  "the",
]);

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** "Water heater repair or replacement" is recognised by "water heater". */
function coreOf(service: string) {
  const words = normalize(service)
    .split(" ")
    .filter((word) => word && !GENERIC.has(word));
  return words.length > 0 ? words.join(" ") : normalize(service);
}

/** The price-list services a text (the owner's site, or Google's service list) never mentions. */
export function missingServices(services: string[], text: string): string[] {
  const haystack = ` ${normalize(text)} `;
  return services.filter((service) => !haystack.includes(` ${coreOf(service)} `));
}

/** "Drain cleaning, Leak repair and 2 more". */
export function serviceList(names: string[]) {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  return shown.length > 1
    ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`
    : (shown[0] ?? "");
}
