import { formatDate } from "~/lib/date-helpers";
import { fetchStudentPickupData } from "~/lib/pickup-schedule-api";

/**
 * Die Abholtage eines Kontakts ab heute (#8206). Entzieht das Personal die
 * Abholerlaubnis, entfernt moto diese Tage; die Meldung nennt sie.
 */
export async function upcomingPickupDaysOf(
  studentId: string,
  guardianId: string,
): Promise<string[]> {
  const data = await fetchStudentPickupData(studentId);
  return (data.pickupPersons ?? [])
    .filter(
      (person) =>
        person.guardianProfileId === guardianId && !person.permissionWithdrawn,
    )
    .map((person) => person.exceptionDate);
}

/** Die Meldung nach dem Entzug: welche Abholtage moto entfernt hat. */
export function pickupWithdrawalMessage(
  name: string,
  days: readonly string[],
): string {
  const list = days.map((day) => formatDate(day)).join(", ");
  return days.length === 1
    ? `Die Angaben von ${name} sind gespeichert. ${name} darf nicht mehr abholen. Dieser Abholtag ist entfernt: ${list}.`
    : `Die Angaben von ${name} sind gespeichert. ${name} darf nicht mehr abholen. Diese Abholtage sind entfernt: ${list}.`;
}
