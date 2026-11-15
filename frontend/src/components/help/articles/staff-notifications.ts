import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Die Glocke oben rechts im Staff-Portal (#7148): oben `Erinnerungen`, darunter
 * `Hinweise` (der Benachrichtigungs-Feed). Erster Hinweis-Typ ist die Absage
 * eines Termins. Kein Bild, bis die Screenshots der Glocke da sind.
 */
export function staffNotificationsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.staffNotifications,
    title: "Hinweise und Erinnerungen in der Glocke",
    question: "Wo sehe ich, was sich für mich geändert hat?",
    summary:
      "Die Glocke oben rechts zeigt Ihre Erinnerungen und Ihre Hinweise, zum Beispiel wenn ein Termin von Ihnen ausfällt.",
    group: "einstieg",
    audience: ["caregiver", "lead"],
    icon: "Bell",
    steps: [
      "Wählen Sie oben rechts die Glocke. Die Zahl daran zählt neue Hinweise und offene Erinnerungen. Ab 10 steht dort `9+`.",
      "Oben stehen die `Erinnerungen`. `Alle ansehen` öffnet die ganze Liste.",
      "Darunter stehen die `Hinweise`. Neue Hinweise sind mit `Neu` markiert.",
      "Wählen Sie einen Hinweis. moto öffnet die passende Seite, zum Beispiel `Mein Dienstplan` an dem Tag.",
      "Mit `Alle als gelesen markieren` sind alle Hinweise auf einmal gelesen.",
    ],
    result:
      "Ein Hinweis gilt erst als gelesen, wenn Sie ihn wählen oder alle als gelesen markieren. Das Öffnen der Glocke allein ändert nichts.",
    notes: [
      "Der erste Hinweis in moto ist die Absage eines Termins: Fällt ein Termin aus, bei dem Sie eingeplant sind, sehen Sie es hier. Wer den Termin absagt, bekommt keinen Hinweis.",
      "Ändert sich derselbe Termin kurz danach noch einmal, rückt der Hinweis nach oben. Sie bekommen dann keinen zweiten Hinweis.",
      "Hinweise bleiben 30 Tage nach ihrer letzten Änderung in der Glocke. Danach löscht moto sie.",
      "Was Sie auf dem Handy gelesen haben, ist auch am Tablet gelesen.",
      "Weiter unten in der Liste lädt moto ältere Hinweise nach. Sie können auch `Weitere laden` wählen.",
      "Zusätzlich kann moto Ihnen eine Mitteilung aufs Handy schicken. Das passiert nur bei Absagen von heute bis in 14 Tagen.",
      "Die Mitteilung aufs Handy schalten Sie in Ihrem `Profil` unter `Benachrichtigungen` bei `Absage eines Termins` aus. Der Hinweis in der Glocke kommt dann trotzdem.",
    ],
    differences: [
      "Auf dem Handy öffnet die Glocke eine Seite über den ganzen Bildschirm. Mit dem X schließen Sie sie.",
      "Sie sehen keine `Erinnerungen`? Dann nutzt Ihre Schule keine Erinnerungen. Die Glocke zeigt dann nur die Hinweise.",
      "Sie arbeiten an zwei Schulen? Die Glocke zeigt die Hinweise der Schule, in der Sie gerade angemeldet sind.",
    ],
    troubleshootingDetails: [
      "Es kommt kein Hinweis zu einer Absage? Ihre Schule kann `Hinweis bei Absage eines Termins` ausschalten. Dann gibt es weder einen Hinweis noch eine Mitteilung aufs Handy. Fragen Sie Ihre Leitung.",
      "Ein Hinweis öffnet eine Seite mit `Sie haben keinen Zugriff auf einen eigenen Dienstplan.`? Dann führt Ihre Schule für Sie keinen eigenen Dienstplan in moto. Fragen Sie Ihre Leitung.",
    ],
    related: [HELP_TOPICS.ownShiftPlan],
  };
}
