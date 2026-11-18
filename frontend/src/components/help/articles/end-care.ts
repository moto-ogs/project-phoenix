import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Regulaerer Austritt, Assistent `CareExitModal` in zwei Schritten (#2487).
 * Bewusst getrennt vom Loeschen: hier bleiben alle Daten erhalten.
 */
export function endCareTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadEndCare,
    title: "Die Betreuung eines Kindes beenden",
    question: "Wie beende ich die Betreuung eines Kindes?",
    summary: "Du setzt einen letzten Betreuungstag. Die Daten bleiben.",
    group: "kinderdaten",
    audience: "lead",
    icon: "LogOut",
    steps: [],
    instructionGroups: [
      {
        title: "Ein einzelnes Kind abmelden",
        steps: [
          "Öffne `Datenverwaltung` und danach `Kinderdaten`.",
          "Wähle das Kind aus der Liste.",
          "Wähle oben rechts `Betreuung beenden`.",
          "Trage bei `Letzter Betreuungstag` den Tag ein.",
          "Wähle einen Grund: `Umzug`, `Kein Betreuungsbedarf mehr` oder `Anderer Grund`.",
          "Wähle `Weiter`.",
          "Prüfe die Vorschau und wähle `Betreuung beenden`.",
        ],
      },
      {
        title: "Mehrere Kinder auf einmal abmelden",
        steps: [
          "Öffne oben das Menü mit den drei Punkten.",
          "Wähle `Auswählen`.",
          "Hake die Kinder an.",
          "Wähle `Betreuung beenden`.",
          "Gehe die beiden Schritte wie oben durch.",
        ],
      },
    ],
    result:
      "Ab dem Tag nach dem letzten Betreuungstag ist das Kind nicht mehr in Betreuung.",
    notes: [
      "Bei `Anderer Grund` trägst du zusätzlich eine kurze Erklärung ein.",
      "Beendete Kinder findest du über das Menü mit den drei Punkten unter `Beendete Betreuungen`.",
      "Nach der Löschfrist löscht moto das Kind mit allen Angaben. Die Frist siehst du unter `Einstellungen` und `Datenschutz`.",
      "Erziehungsberechtigte ohne weiteres Kind an der Schule löscht moto nach einer eigenen Frist. Auch sie steht unter `Datenschutz`.",
    ],
    differences: [
      "Ist schon ein Ende geplant, heißt der Knopf `Ende ändern`. Daneben steht `Ende stornieren`.",
      "Ist die Betreuung schon beendet, steht dort `Wieder aufnehmen`.",
    ],
    troubleshootingDetails: [
      "Die Vorschau blockiert das Beenden? Dann sprechen die geprüften Angaben dagegen. Lies den Hinweis in der Vorschau.",
      "Fehlt `Wieder aufnehmen`? Dann lief die Betreuung mit der Anmeldephase aus. Das lässt sich nicht zurücknehmen.",
    ],
    related: [
      HELP_TOPICS.leadDeleteStudent,
      HELP_TOPICS.leadManageStudent,
      HELP_TOPICS.leadGradeTransition,
    ],
  };
}
