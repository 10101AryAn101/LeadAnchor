/** A visit as the customer's calendar gets it from "Add to my calendar". */
export type CalendarVisit = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** Booked or done; a cancelled visit or a no-show shows as cancelled. */
  happening: boolean;
  /** The business's number and the link to change or cancel, one per line. */
  details: string;
  /** Only when the customer goes to the business; a plumber comes to them. */
  location: string | null;
  /** The customer's page to change or cancel the visit. */
  link: string;
};

/** A standard calendar file (.ics, RFC 5545) that phones and calendar apps open as one event. */
export function calendarFile(visit: CalendarVisit, now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LeadAnchor//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${visit.id}@leadanchor`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(visit.startsAt)}`,
    `DTEND:${stamp(visit.endsAt)}`,
    `SUMMARY:${text(visit.title)}`,
    `DESCRIPTION:${text(visit.details)}`,
    ...(visit.location ? [`LOCATION:${text(visit.location)}`] : []),
    `URL:${visit.link}`,
    `STATUS:${visit.happening ? "CONFIRMED" : "CANCELLED"}`,
    // A nudge an hour before, for the calendars that keep an imported event's own reminder.
    ...(visit.happening
      ? [
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          `DESCRIPTION:${text(visit.title)}`,
          "TRIGGER:-PT1H",
          "END:VALARM",
        ]
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n");
}

const stamp = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/** Text escapes backslashes, commas, semicolons and line breaks (RFC 5545 §3.3.11). */
const text = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/[,;]/g, (char) => `\\${char}`)
    .replace(/\r?\n/g, "\\n");

/**
 * Lines over 75 bytes carry on after a line break and a space (RFC 5545 §3.1). A split never lands
 * inside a letter or an escape like "\n": the standard allows the latter, but looser calendar apps misread it.
 */
function fold(line: string) {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const piece of line.match(/\\.|./gsu) ?? []) {
    const size = Buffer.byteLength(piece);
    // Each carried-on line starts with a space, which counts toward its 75 bytes.
    if (bytes + size > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += piece;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}
