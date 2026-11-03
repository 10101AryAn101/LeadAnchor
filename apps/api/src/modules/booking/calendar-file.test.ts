import { describe, expect, it } from "vitest";
import { type CalendarVisit, calendarFile } from "./calendar-file";

const link = "http://172.26.214.152:3000/b/manage/qJSkC5Wilt7_qGP17rnt7zxdXZc6olhf";
const visit: CalendarVisit = {
  id: "01a19c6f-f967-7249-b75a-b223bccde1dc",
  title: "Leak repair with Aryan Test Plumbing",
  startsAt: new Date("2026-11-02T15:30:00Z"),
  endsAt: new Date("2026-11-02T16:30:00Z"),
  happening: true,
  details: `Questions? Call or text Aryan Test Plumbing at (512) 555-0181.\nTo change or cancel: ${link}`,
  location: null,
  link,
};

/** Joins folded lines back up, as a calendar app reads them. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe("the calendar file a customer adds", () => {
  it("carries the time, the business's number, the change link and a reminder", () => {
    const ics = unfold(calendarFile(visit, new Date("2026-11-02T13:32:51Z")));
    expect(ics).toContain("DTSTAMP:20261102T133251Z");
    expect(ics).toContain("DTSTART:20261102T153000Z");
    expect(ics).toContain("DTEND:20261102T163000Z");
    expect(ics).toContain(
      `DESCRIPTION:Questions? Call or text Aryan Test Plumbing at (512) 555-0181.\\nTo change or cancel: ${link}`,
    );
    expect(ics).toContain(`URL:${link}`);
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain("TRIGGER:-PT1H");
    expect(ics).not.toContain("LOCATION:");
  });

  it("keeps every line within 75 bytes without splitting a letter or an escape", () => {
    const title =
      "Corte y peinado con Estética Peña, salón de belleza en San Antonio, Texas — cita de prueba";
    const ics = calendarFile({ ...visit, title });
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(unfold(ics)).toContain(
      "SUMMARY:Corte y peinado con Estética Peña\\, salón de belleza en San Antonio\\, Texas — cita de prueba",
    );
    expect(ics).not.toMatch(/\\\r\n /);
    expect(calendarFile(visit)).not.toMatch(/\\\r\n /);
  });

  it("escapes commas and semicolons, and names the place when customers come in", () => {
    const ics = unfold(
      calendarFile({
        ...visit,
        title: "Cut, color; style",
        location: "123 Main St, Austin, TX 78701",
      }),
    );
    expect(ics).toContain("SUMMARY:Cut\\, color\\; style");
    expect(ics).toContain("LOCATION:123 Main St\\, Austin\\, TX 78701");
  });

  it("shows a cancelled visit as cancelled, without a reminder", () => {
    const ics = calendarFile({ ...visit, happening: false });
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).not.toContain("VALARM");
  });
});
