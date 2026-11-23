const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * C-20: when a booked visit gets its reminder.
 * - Booked at least 12 hours ahead: the day-before reminder, in the 24 hours before the visit
 *   (and not in its last hour).
 * - Booked 3 to 12 hours ahead: a reminder about 2 hours before the visit, so a short-notice
 *   booking is reminded too.
 * - Booked under 3 hours ahead: the confirmation that just went out is the reminder.
 */
export function reminderDue(booking: { startsAt: Date; createdAt: Date }, now: Date): boolean {
  const bookedAhead = booking.startsAt.getTime() - booking.createdAt.getTime();
  const left = booking.startsAt.getTime() - now.getTime();
  if (bookedAhead >= 12 * HOUR) return left > HOUR && left < 24 * HOUR;
  if (bookedAhead >= 3 * HOUR) return left > 30 * MINUTE && left <= 2 * HOUR;
  return false;
}
