import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Bankverbindungen unter `/eltern/bankverbindungen`. Reine Leseansicht mit
 * Export; die IBAN pflegen die Eltern selbst im Portal. Sichtbar nur mit
 * `guardians:financial` (sidebar.tsx, PARENT_SUB_PAGES-Filter).
 */
export function bankDetailsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadBankDetails,
    title: "Bankverbindungen einsehen",
    question: "Wo finde ich die Bankverbindungen der Familien?",
    summary: "Du siehst je Kind die hinterlegte IBAN und kannst sie ausgeben.",
    group: "elternarbeit",
    audience: "lead",
    icon: "Landmark",
    image: "/help/screens/bankverbindungen-export.webp",
    imageAlt:
      "Das Fenster zum Exportieren der Bankverbindungen mit der Auswahl des Formats.",
    steps: [
      "Klappe in der Seitenleiste `Eltern` auf.",
      "Öffne `Bankverbindungen`.",
      "Wähle `Alle Kinder` oder `Ohne IBAN`.",
      "Öffne oben rechts das Menü mit den drei Punkten.",
      "Wähle `Exportieren`.",
      "Wähle unter `Format` `Excel`, `PDF` oder `Word`.",
      "Wähle `Herunterladen`.",
    ],
    result:
      "Die Liste wird als Datei erstellt und heruntergeladen. Sie enthält immer alle Kinder, auch wenn die Liste gerade gefiltert ist.",
    notes: [
      "Die IBAN trägst du beim Kind ein, im Reiter `Erziehungsberechtigte`.",
      "Die Datei enthält die vollständigen IBANs und wird protokolliert. Gib sie nicht per E-Mail weiter.",
      "`Ohne IBAN` zeigt, bei welchen Kindern noch etwas fehlt.",
    ],
    differences: [
      "Fehlt bei einem Kind die IBAN, steht dort `Fehlt`.",
      "Steht beim Kontoinhaber `Nicht zugeordnet`, ist beim Kind noch niemand als Kontoinhaber eingetragen.",
    ],
    troubleshootingDetails: [
      "Fehlt `Bankverbindungen` in der Seitenleiste? Dafür braucht es ein eigenes Recht. Frage deine Leitung.",
      "`Exportieren` bleibt grau? Dann ist die Liste leer.",
    ],
    related: [
      HELP_TOPICS.leadInviteGuardians,
      HELP_TOPICS.leadExports,
      HELP_TOPICS.leadManageStudent,
    ],
  };
}
