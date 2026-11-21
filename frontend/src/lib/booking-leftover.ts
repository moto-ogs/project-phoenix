import type { bookingLeftoversResponse } from "./contract/timetable.generated";

/**
 * A child a hand-maintained Regeltermin keeps after a booking change (#5102):
 * the booking of these weekdays ended and no other booking carries the
 * Regeltermin. The save response of the change names it once; this hint
 * finds it again from the stored bookings.
 */
export interface BookingLeftover {
  templateId: string;
  templateName: string;
  studentId: string;
  studentName: string;
  /** ISO weekdays, 1 = Monday, ascending. */
  weekdays: number[];
  /**
   * Latest day a booking of these weekdays ended without a carrying one
   * (exclusive end, YYYY-MM-DD); „Bleibt so“ records it.
   */
  bookingEndedOn: string;
  /**
   * First planned day without a carrying booking, tomorrow at the earliest;
   * the row shows it and „Entfernen“ starts there.
   */
  from: string;
  /**
   * Day a later booking carries the Regeltermin again (exclusive end of the
   * gap, YYYY-MM-DD, #5497); null when none does. „Entfernen“ ends there.
   */
  until: string | null;
  /** The school decided: the child stays planned. */
  kept: boolean;
}

export function mapBookingLeftovers(
  raw: bookingLeftoversResponse,
): BookingLeftover[] {
  return (raw.leftovers ?? []).map((leftover) => ({
    templateId: leftover.template_id,
    templateName: leftover.template_name,
    studentId: leftover.student_id,
    studentName: leftover.student_name,
    weekdays: leftover.weekdays ?? [],
    bookingEndedOn: leftover.booking_ended_on,
    from: leftover.from,
    until: leftover.until,
    kept: leftover.kept,
  }));
}

/** One row per child, Regeltermin, start and end; stable across reloads. */
export function bookingLeftoverKey(leftover: BookingLeftover): string {
  return `${leftover.templateId}-${leftover.studentId}-${leftover.from}-${leftover.until ?? "open"}`;
}
