import { ShieldAlert, UserCheck } from "lucide-react";
import { StudentInfoRow } from "~/components/students/student-card";

/** Wer das Kind an einem Tag abholt (#7655). */
export interface DayPickupPerson {
  readonly name: string;
  /** Keine dauerhaft berechtigte Person: der Ausweis wird geprüft. */
  readonly oneTime: boolean;
  /**
   * Die Abholerlaubnis dieser Person gilt an dem Tag nicht mehr (#8206).
   * Der Name steht dann nie als gültige Abholperson da.
   */
  readonly permissionWithdrawn?: boolean;
}

/**
 * Die Abholperson des Tages auf der Kinderkarte (#7655). Beim Abholen prüft
 * das Personal hier, wer kommen darf; bei einer einmaligen Person den Ausweis.
 * Ist die Abholerlaubnis entzogen, sagt die Zeile das in Worten (#8206).
 */
export function PickupPersonRow({
  person,
}: Readonly<{ person: DayPickupPerson | undefined }>) {
  if (!person) return null;
  if (person.permissionWithdrawn) {
    return (
      <StudentInfoRow
        icon={
          <ShieldAlert
            className="text-moto-red-strong h-3.5 w-3.5"
            aria-hidden
          />
        }
        wrap
      >
        <span className="text-moto-red-strong font-medium">
          Abholerlaubnis entzogen:
        </span>{" "}
        {person.name} darf heute nicht abholen.
      </StudentInfoRow>
    );
  }
  return (
    <StudentInfoRow
      icon={<UserCheck className="h-3.5 w-3.5 text-gray-500" aria-hidden />}
      wrap
    >
      Holt heute ab: {person.name}
      {person.oneTime ? " (Ausweis prüfen)" : ""}
    </StudentInfoRow>
  );
}
