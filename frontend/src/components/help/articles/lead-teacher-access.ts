import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Lehrkraft-Zugang: Systemrolle `Lehrkraft` plus Klassenzuweisung im Reiter
 * `Klassen` der Personalakte (#1772, staff/[id]/page.tsx:216). Lehrkraefte
 * arbeiten in moto schule, einem eigenen Portal mit eigener Adresse.
 */
export function leadTeacherAccessTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadTeacherAccess,
    title: "Einen Lehrkraft-Zugang vorbereiten",
    question: "Wie bekommt eine Lehrkraft Zugang zu moto schule?",
    summary: "Lehrkräfte sehen ihre Klasse in einem eigenen Bereich.",
    group: "personal",
    audience: "lead",
    icon: "GraduationCap",
    steps: [
      "Öffne `Datenverwaltung` und danach `Personal`.",
      "Wähle oben rechts `+ Personal` und danach `Personal einladen`.",
      "Trage die `E-Mail-Adresse` ein.",
      "Wähle bei `Rolle` die Rolle `Lehrkraft`.",
      "Wähle `Einladung senden`.",
      "Öffne danach `Mitarbeitende` und die Person.",
      "Wähle den Reiter `Klassen`.",
      "Trage die Klassen ein, zum Beispiel `1a`.",
    ],
    result:
      "Die Lehrkraft sieht nach der Anmeldung ihre Klassen und den heutigen Tag.",
    notes: [
      "Schreibe die Klasse genau wie bei den Kindern. Groß- und Kleinschreibung spielt keine Rolle.",
      "Beim Schuljahreswechsel wandern die Klassen automatisch mit. Prüfe danach den Reiter `Klassen`.",
      "Eine Lehrkraft sieht nur ihre Klassen, keine Stammdaten und keine Kontaktdaten.",
    ],
    differences: [
      "Für Sekretariat und Schulleitung wählst du die Rolle `Schulverwaltung`. Sie sieht alle Klassen der Schule. Den Reiter `Klassen` brauchst du dafür nicht.",
      "Neue Klassen sieht die `Schulverwaltung` von selbst.",
      "moto schule hat eine eigene Adresse. Der Link in der Einladung führt dorthin.",
      "Über die Adresse deiner OGS kommt eine Lehrkraft nicht hinein.",
    ],
    troubleshootingDetails: [
      "Die Lehrkraft sieht keine Kinder? Dann fehlt die Klasse im Reiter `Klassen` oder sie ist anders geschrieben.",
      "Soll die Lehrkraft die Ankunftszeit selbst ändern oder ihre Klasse an die OGS übergeben dürfen? Hake das in den `Einstellungen` unter `Was Lehrkräfte in moto schule eintragen dürfen` an.",
    ],
    related: [
      HELP_TOPICS.leadInviteStaff,
      HELP_TOPICS.leadStaffPermissions,
      HELP_TOPICS.settings,
    ],
  };
}
