import { UserCheck } from "lucide-react";
import { StudentInfoRow } from "~/components/students/student-card";

/** Wer das Kind an einem Tag abholt (#7655). */
export interface DayPickupPerson {
  readonly name: string;
  /** Keine dauerhaft berechtigte Person: der Ausweis wird geprüft. */
  readonly oneTime: boolean;
}

/**
 * Die Abholperson des Tages auf der Kinderkarte (#7655). Beim Abholen prüft
 * das Personal hier, wer kommen darf; bei einer einmaligen Person den Ausweis.
 */
export function PickupPersonRow({
  person,
}: Readonly<{ person: DayPickupPerson | undefined }>) {
  if (!person) return null;
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
