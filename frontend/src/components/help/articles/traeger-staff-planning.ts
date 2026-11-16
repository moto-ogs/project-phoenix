import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/personal/einsatzplanung` (#4708, ADR 0242): die Woche aller
 * Personen mit Personalakte über alle Einsatzorte, das Planen einer Schicht
 * im Dienstplan einer Schule, die Prüfung der Arbeitszeitregeln und der
 * Schalter `Einsatzplanung in moto` in den Einstellungen.
 */
export function traegerStaffPlanningTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerStaffPlanning,
    title: "Einsatzplanung über alle Schulen",
    question: "Wie plane ich Personal über alle Schulen?",
    summary:
      "Sie sehen die Woche jeder Person an allen ihren Schulen und planen Schichten dort. moto prüft dabei die Arbeitszeitregeln über alle Schulen.",
    group: "personal",
    audience: "traeger",
    icon: "CalendarCheck",
    requirements: [
      "Sie haben die Rolle `Personal`.",
      "Die Person hat eine Personalakte und ist an der Schule beschäftigt.",
    ],
    instructionGroups: [
      {
        title: "Eine Schicht planen",
        steps: [
          "Wählen Sie in der Navigation `Einsatzplanung`.",
          "Wählen Sie mit den Pfeilen die Woche.",
          "Wählen Sie in der Zeile der Person den freien Tag.",
          "Wählen Sie den `Einsatzort` und tragen Sie `Beginn`, `Ende` und `Pause` ein.",
          "Wählen Sie `Planen`.",
        ],
      },
      {
        title: "Eine Schicht ändern oder löschen",
        steps: [
          "Wählen Sie die Schicht in der Woche.",
          "Ändern Sie die Zeiten und wählen Sie `Speichern`.",
          "Zum Löschen wählen Sie `Schicht löschen` und bestätigen.",
        ],
      },
      {
        title: "Wenn moto vor einer Regel warnt",
        steps: [
          "moto zeigt jeden Hinweis in einem Satz, etwa zu wenig Ruhezeit.",
          "Ändern Sie die Zeiten. Oder wählen Sie `Trotzdem planen`.",
          "Wo moto es verlangt, schreiben Sie eine `Begründung`.",
        ],
      },
      {
        title: "Die Woche herunterladen",
        steps: [
          "Wählen Sie die Woche mit den Pfeilen.",
          "Wählen Sie oben `Herunterladen` und dann `PDF`, `Excel` oder `CSV`.",
          "Die Datei hat eine Zeile je Person und eine Spalte je Tag.",
        ],
      },
      {
        title: "Die Regeln ändern",
        steps: [
          "Wählen Sie `Einstellungen` und dort `Einsatzplanung`.",
          "Stellen Sie die Stunden am Tag, die Ruhezeit und die Pausen ein.",
        ],
      },
    ],
    steps: [],
    result:
      "Die Schicht steht sofort im Dienstplan der Schule. Die Schule sieht, dass der Träger sie geplant hat. Eine Begründung steht im Änderungsprotokoll der Schule.",
    notes: [
      "moto zählt alle Schulen der Person zusammen: die Stunden am Tag, die Ruhezeit, die Pausen und das Soll der Woche.",
      "Dieselbe Prüfung läuft, wenn eine Schule selbst eine Schicht plant.",
      "Das Soll kommt aus dem Arbeitsvertrag. Feiertage und Schließtage zählen nicht.",
      "Jedes Anzeigen und jeder Download der Woche steht im Zugriffsprotokoll jeder Schule.",
      "moto prüft die Regeln als Hilfe. Ob eine Planung erlaubt ist, entscheiden Sie.",
    ],
    differences: [
      "Oben steht `Einsatzplanung in moto ist aus`: Ihr Träger plant außerhalb von moto. Neue Schichten sind dann überall gesperrt. Geplante Schichten bleiben.",
      "Eine Schule fehlt in der Woche: moto konnte sie gerade nicht lesen. Laden Sie die Seite später neu.",
    ],
    troubleshootingDetails: [
      "„Die Person arbeitet … schon an einem anderen Einsatzort“: Zur selben Zeit hat die Person eine Schicht an einer anderen Schule. Wählen Sie eine andere Zeit.",
      "Eine Person fehlt: Sie hat keine Personalakte, oder sie ist an keiner Schule mehr beschäftigt.",
    ],
    related: [
      HELP_TOPICS.traegerStaffRecords,
      HELP_TOPICS.traegerStaffContracts,
      HELP_TOPICS.traegerSettings,
    ],
  };
}
