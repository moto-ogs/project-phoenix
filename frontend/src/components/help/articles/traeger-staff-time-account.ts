import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Das Stundenkonto einer Personalakte über alle Schulen und der
 * Monatsabschluss des Trägers (#4711, ADR 0243).
 */
export function traegerStaffTimeAccountTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerStaffTimeAccount,
    title: "Stundenkonto und Monatsabschluss",
    question: "Wie sehe ich das Stundenkonto und schließe einen Monat ab?",
    summary:
      "Das Stundenkonto zählt Soll und Ist an allen Schulen der Person. Mit Ihrem Vertrag schließen Sie den Monat für alle Schulen ab.",
    group: "personal",
    audience: "traeger",
    icon: "Timer",
    requirements: [
      "Sie haben die Rolle `Personal`.",
      "Die Person hat eine Personalakte.",
      "Zum Abschließen: Die Person hat in dem Monat einen Arbeitsvertrag bei Ihnen.",
    ],
    instructionGroups: [
      {
        title: "Stundenkonto ansehen",
        steps: [
          "Öffnen Sie die Akte im Reiter `Akten`.",
          "Gehen Sie zur Karte `Stundenkonto`. Sie zeigt den Vormonat.",
          "Mit den Pfeilen wechseln Sie den Monat.",
          "Oben stehen Soll, Ist, Saldo und Kontostand über alle Schulen. Darunter steht jede Schule in einer Zeile.",
        ],
      },
      {
        title: "Monat abschließen",
        description: "Zum Beispiel, bevor Sie die Löhne abrechnen.",
        steps: [
          "Wählen Sie den Monat. Er muss vorbei sein.",
          "Wählen Sie `Monat abschließen`.",
          "Schreiben Sie einen Grund. Wählen Sie `Monat abschließen`.",
        ],
      },
      {
        title: "Monat wieder öffnen",
        description: "Nur, wenn der Abschluss falsch war.",
        steps: [
          "Wählen Sie den abgeschlossenen Monat.",
          "Wählen Sie `Wieder öffnen`.",
          "Schreiben Sie einen Grund. Wählen Sie `Wieder öffnen`.",
        ],
      },
    ],
    steps: [],
    result:
      "Der Monat ist an jeder Schule mit Ihrem Vertrag abgeschlossen. Die Schulen ändern darin keine Zeiten und Buchungen mehr. Der Kontostand geht in den nächsten Monat.",
    notes: [
      "Personen mit Ihrem Vertrag schließen nur Sie ab. Die Schule lässt sie bei ihrem eigenen Abschluss aus. Sie fehlen auch im Lohnexport der Schule.",
      "Jedes Öffnen des Stundenkontos steht im Zugriffsprotokoll der Schulen.",
      "Monate öffnen Sie vom neuesten an. Ist der Oktober abgeschlossen, öffnen Sie zuerst den Oktober, dann den September.",
    ],
    differences: [
      "Statt `Monat abschließen` steht `Schulen schließen selbst ab`: In dem Monat gilt kein Arbeitsvertrag bei Ihnen. Jede Schule schließt dann selbst ab.",
      "Eine Schule zeigt `Von der Schule abgeschlossen`: Die Schule war vor Ihrem Vertrag schon fertig. Diesen Abschluss öffnet nur die Schule.",
    ],
    troubleshootingDetails: [
      "`Monat abschließen` ist grau: Der Monat läuft noch, oder eine Schule hat einen späteren Monat schon abgeschlossen. Der Hinweis über der Tabelle nennt die Schule.",
      "`Wieder öffnen` ist grau: Ein späterer Monat ist noch abgeschlossen. Öffnen Sie zuerst diesen.",
    ],
    related: [
      HELP_TOPICS.traegerStaffContracts,
      HELP_TOPICS.traegerStaffRecords,
    ],
  };
}
