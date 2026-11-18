import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Nachweise (#4808): Eintrag im Reiter `Stammdaten` der Personalakte, die
 * Liste `/database/qualifications`, die Arten unter
 * `/database/qualification-types` und die Erinnerung vor Ablauf. Sichtbar mit
 * `staff:stammdaten`; die eigenen Nachweise sieht jede Person im Profil.
 */
export function staffQualificationsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadStaffQualifications,
    title: "Nachweise wie Erste Hilfe im Blick behalten",
    question: "Wie sehe ich, wessen Nachweis bald abläuft?",
    summary:
      "moto zeigt jeden Nachweis mit Ablaufdatum und erinnert vor dem Ablauf.",
    group: "personal",
    audience: "lead",
    icon: "FirstAid",
    requirements: ["Das Recht, Personaldaten zu pflegen (`Stammdaten`)."],
    steps: [],
    instructionGroups: [
      {
        title: "Einen Nachweis eintragen",
        steps: [
          "Öffne die Personalakte der Person und den Reiter `Stammdaten`.",
          "Wähle oben `Bearbeiten`.",
          "Wähle unter `Qualifikationen` den Knopf `Qualifikation hinzufügen`.",
          "Wähle die `Art`, zum Beispiel `Erste Hilfe am Kind`. Für alles andere wähle `Sonstiges` und trage einen Namen ein.",
          "Trage `Erworben am` ein. moto schlägt `Gültig bis` aus der Gültigkeit der Art vor. Prüfe das Datum.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Alle Nachweise sehen",
        steps: [
          "Öffne `Datenverwaltung` und danach `Nachweise`.",
          "Filtere oben nach `Status` oder `Art`.",
          "Öffne oben das Menü mit den drei Punkten.",
          "Wähle `Für Excel herunterladen`, um die Liste als Datei zu speichern. Ohne Treffer gibt es den Eintrag nicht.",
        ],
      },
      {
        title: "Nachweisarten einstellen",
        steps: [
          "Öffne `Datenverwaltung` und danach `Nachweisarten`.",
          "Wähle eine Art oder lege eine eigene an.",
          "Stelle `Gültig für (Monate)` und `Erinnerung vor Ablauf (Wochen)` ein.",
          "Setze bei Bedarf `Pflicht für alle Mitarbeitenden`.",
          "Wähle `Speichern`.",
        ],
      },
    ],
    result:
      "Läuft ein Nachweis bald ab, bekommen alle mit dem Recht `Stammdaten` und die Person selbst eine E-Mail. Am Ablauftag kommt eine zweite. In moto kommt dazu eine Nachricht, wenn sie im Profil eingeschaltet ist.",
    differences: [
      "Ein alter Eintrag ohne Art steht als `Sonstiges` da. moto ordnet ihn nicht selbst zu. Wähle die Art im Reiter `Stammdaten` aus.",
      "Status `Fehlt` heißt: Die Art ist Pflicht, und die Person hat noch keinen Nachweis davon.",
      "Bei einer Person steht `Vom Träger geführt`: Dein Träger führt die Nachweise der Person in seiner Personalakte. Du siehst dort nur den Stand. Eintragen kann die Personalverwaltung des Trägers. Vor dem Ablauf bekommst du trotzdem eine Erinnerung.",
    ],
    notes: [
      "moto speichert nur Art und Datum, keine Inhalte. Beim Führungszeugnis hältst du so fest, dass du es eingesehen hast.",
      "Ihre eigenen Nachweise sehen alle Mitarbeitenden im `Profil` unter `Meine Nachweise`.",
    ],
    related: [HELP_TOPICS.leadStaffRecord],
  };
}
