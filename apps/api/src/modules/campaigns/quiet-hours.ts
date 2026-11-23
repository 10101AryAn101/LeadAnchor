import { addressTimeZone } from "@leadanchor/contracts";
import { localDate, shiftDate, zonedParts, zonedTime } from "../../lib/zoned";
import { QUIET_END, QUIET_START } from "../messaging/policy";

/** The customer's own clock (C-44 AC 4): from the state in their address, else the business's. */
export function recipientZone(address: string | null | undefined, businessZone: string) {
  return addressTimeZone(address) ?? businessZone;
}

/**
 * Quiet hours are 9 pm to 8 am in the recipient's time zone. When `at` falls inside them, the
 * 8 am it should wait for; otherwise null (it can go at `at`).
 */
export function quietUntil(at: Date, timeZone: string): Date | null {
  const { hour } = zonedParts(at, timeZone);
  if (hour >= QUIET_END && hour < QUIET_START) return null;
  const today = localDate(at, timeZone);
  const morning = hour >= QUIET_START ? shiftDate(today, 1) : today;
  return zonedTime(morning, `${String(QUIET_END).padStart(2, "0")}:00`, timeZone);
}
