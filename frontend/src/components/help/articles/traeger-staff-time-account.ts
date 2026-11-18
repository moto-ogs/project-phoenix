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
      "Das Stundenkonto zählt Soll und Ist an allen Schulen der Person. Mit deinem Vertrag schließt du den Monat für alle Schulen ab.",
    group: "personal",
    audience: "traeger",
    icon: "Timer",
    requirements: [
      "Du hast die Rolle `Personal`.",
      "Die Person hat eine Personalakte.",
      "Zum Abschließen: Die Person hat in dem Monat einen Arbeitsvertrag bei dir.",
    ],
    instructionGroups: [
      {
        title: "Stundenkonto ansehen",
        steps: [
          "Öffne die Akte im Reiter `Akten`.",
          "Gehe zur Karte `Stundenkonto`. Sie zeigt den Vormonat.",
          "Mit den Pfeilen wechselst du den Monat.",
          "Oben stehen Soll, Ist, Saldo und Kontostand über alle Schulen. Darunter steht jede Schule in einer Zeile.",
        ],
      },
      {
        title: "Monat abschließen",
        description: "Zum Beispiel, bevor du die Löhne abrechnest.",
        steps: [
          "Wähle den Monat. Er muss vorbei sein.",
          "Wähle `Monat abschließen`.",
          "Schreibe einen Grund. Wähle `Monat abschließen`.",
        ],
      },
      {
        title: "Monat wieder öffnen",
        description: "Nur, wenn der Abschluss falsch war.",
        steps: [
          "Wähle den abgeschlossenen Monat.",
          "Wähle `Wieder öffnen`.",
          "Schreibe einen Grund. Wähle `Wieder öffnen`.",
        ],
      },
    ],
    steps: [],
    result:
      "Der Monat ist an jeder Schule mit deinem Vertrag abgeschlossen. Die Schulen ändern darin keine Zeiten und Buchungen mehr. Der Kontostand geht in den nächsten Monat.",
    notes: [
      "Personen mit deinem Vertrag schließt nur du ab. Die Schule lässt sie bei ihrem eigenen Abschluss aus. Sie fehlen auch im Lohnexport der Schule.",
      "Jedes Öffnen des Stundenkontos steht im Zugriffsprotokoll der Schulen.",
      "Monate öffnest du vom neuesten an. Ist der Oktober abgeschlossen, öffnest du zuerst den Oktober, dann den September.",
    ],
    differences: [
      "Statt `Monat abschließen` steht `Schulen schließen selbst ab`: In dem Monat gilt kein Arbeitsvertrag bei dir. Jede Schule schließt dann selbst ab.",
      "Eine Schule zeigt `Von der Schule abgeschlossen`: Die Schule war vor deinem Vertrag schon fertig. Diesen Abschluss öffnet nur die Schule.",
    ],
    troubleshootingDetails: [
      "`Monat abschließen` ist grau: Der Monat läuft noch, oder eine Schule hat einen späteren Monat schon abgeschlossen. Der Hinweis über der Tabelle nennt die Schule.",
      "`Wieder öffnen` ist grau: Ein späterer Monat ist noch abgeschlossen. Öffne zuerst diesen.",
    ],
    related: [
      HELP_TOPICS.traegerStaffContracts,
      HELP_TOPICS.traegerStaffRecords,
    ],
  };
}
