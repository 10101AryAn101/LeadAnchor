import { format as formatDate, isToday, isTomorrow, isYesterday } from "date-fns";

export { formatPhone } from "@leadanchor/contracts";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** "$4,820" — whole dollars; owners think in job prices. "$12.9K" from $10k up when space is tight. */
export const money = (cents: number | null | undefined) => (cents == null ? "—" : usd.format(cents / 100));
/** Money that was actually charged: "$42" or "$42.50", never rounded. */
export const amount = (cents: number) => (cents % 100 === 0 ? usd.format(cents / 100) : usdCents.format(cents / 100));
export const moneyCompact = (cents: number) => (cents >= 1_000_000 ? usdCompact.format(cents / 100) : money(cents));

const minutesSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));

/** True while `iso` is less than `ms` old (e.g. to animate a card that just arrived). */
export const isWithin = (iso: string, ms: number) => Date.now() - new Date(iso).getTime() < ms;

/** "just now", "12 min ago", "3 hr ago", "Yesterday 3:14 PM", "Mar 4". */
export function timeAgo(iso: string) {
  const date = new Date(iso);
  const mins = minutesSince(iso);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 6 * 60) return `${Math.floor(mins / 60)} hr ago`;
  if (isToday(date)) return formatDate(date, "h:mm a");
  if (isYesterday(date)) return `Yesterday ${formatDate(date, "h:mm a")}`;
  if (mins < 180 * 1440) return formatDate(date, "MMM d");
  return formatDate(date, "MMM d, yyyy");
}

/** "Waiting 12 min" / "Waiting 2 hr" / "Waiting 3 days" — how long a customer has waited for a reply. */
export function waitingFor(iso: string) {
  const mins = minutesSince(iso);
  if (mins < 60) return `Waiting ${Math.max(1, mins)} min`;
  if (mins < 48 * 60) return `Waiting ${Math.floor(mins / 60)} hr`;
  return `Waiting ${Math.floor(mins / 1440)} days`;
}

export const clockTime = (iso: string) => formatDate(new Date(iso), "h:mm a");
export const clockTimeSeconds = (iso: string) => formatDate(new Date(iso), "h:mm:ss a");
export const fullDate = (iso: string) => formatDate(new Date(iso), "EEE, MMM d, h:mm a");

/** A booked visit: "Today, 3:30 PM", "Tomorrow, 9:00 AM" or "Thu, Oct 30, 9:00 AM". */
export function visitTime(iso: string) {
  const date = new Date(iso);
  if (isToday(date)) return `Today, ${formatDate(date, "h:mm a")}`;
  if (isTomorrow(date)) return `Tomorrow, ${formatDate(date, "h:mm a")}`;
  return fullDate(iso);
}

/** Value for an <input type="datetime-local"> in the browser's time zone. */
export const toDateTimeLocal = (iso: string) => formatDate(new Date(iso), "yyyy-MM-dd'T'HH:mm");

export function dayLabel(iso: string) {
  const date = new Date(iso);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return formatDate(date, "EEEE, MMM d");
}

export function duration(secs: number | null | undefined) {
  if (secs == null) return "—";
  if (secs < 60) return `0:${String(secs).padStart(2, "0")}`;
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export const percent = (value: number) => `${Math.round(value * 100)}%`;

/** How long a job takes: "45 min", "1 hr", "2 hr 30 min". */
export function jobLength(mins: number | null | undefined) {
  if (mins == null) return null;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export const initials = (name: string | null | undefined) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

export const telHref = (e164: string | null | undefined) => (e164 ? `tel:${e164}` : undefined);
export const smsHref = (e164: string | null | undefined) => (e164 ? `sms:${e164}` : undefined);
