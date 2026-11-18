import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Die Glocke oben rechts im Träger-Portal (#7146): die Hinweise aller Schulen
 * des Trägers, jeweils mit dem Namen der Schule. Erster Typ ist der
 * Schließtag einer Schule.
 */
export function traegerNotificationFeedTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerNotificationFeed,
    title: "Hinweise in der Glocke",
    question: "Wo sehe ich, was sich an meinen Schulen geändert hat?",
    summary:
      "Die Glocke oben rechts zeigt Hinweise aus allen Schulen deines Trägers, zum Beispiel einen neuen Schließtag.",
    group: "einstieg",
    audience: "traeger",
    icon: "Bell",
    steps: [
      "Wähle oben rechts die Glocke. Die Zahl daran zählt neue Hinweise. Ab 10 steht dort `9+`.",
      "Neue Hinweise sind mit `Neu` markiert. Daneben steht die Schule.",
      "Wähle einen Hinweis. moto öffnet die Seite dieser Schule.",
      "Mit `Alle als gelesen markieren` sind alle Hinweise auf einmal gelesen.",
    ],
    result:
      "Erst dein Klick macht einen Hinweis zu „gelesen“. Das Öffnen der Glocke allein ändert nichts.",
    notes: [
      "Trägt eine Schule einen Schließtag ein, ändert oder löscht ihn, siehst du es hier.",
      "Die Zahl an der Glocke prüft moto bei jedem Seitenwechsel und jede Minute neu.",
      "Hinweise bleiben 30 Tage nach ihrer letzten Änderung in der Glocke. Danach löscht moto sie.",
      "Im Träger-Portal gibt es keine Mitteilung aufs Handy. Die Hinweise stehen nur in der Glocke.",
    ],
    differences: [
      "Auf dem Handy öffnen sich die Hinweise über den ganzen Bildschirm. Mit dem X schließt du sie wieder.",
    ],
    troubleshootingDetails: [
      "Es kommt kein Hinweis zu einem Schließtag? Die Schule kann `Benachrichtigung bei Schließtagen` ausschalten. Frage dort nach.",
      "Wer den Schließtag selbst einträgt, bekommt keinen Hinweis dazu.",
    ],
    related: [HELP_TOPICS.traegerSchoolView, HELP_TOPICS.traegerClosingDays],
  };
}
