import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Die Glocke oben rechts im Staff-Portal (#7148): oben `Erinnerungen`, darunter
 * `Hinweise` (der Benachrichtigungs-Feed). Hinweis-Typen: die Absage eines
 * Termins und ein neuer Hinweis der Leitung (#7143).
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
      "Fällt ein Termin aus, bei dem Sie eingeplant sind, sehen Sie es hier. Wer den Termin absagt, bekommt keinen Hinweis.",
      "Schreibt die Leitung unter `Hinweise der Leitung` etwas Neues für die Betreuung, steht es hier als `Neuer Hinweis der Leitung`. Ein Klick darauf öffnet die Seite `Hinweise der Leitung` mit diesem Text, auch wenn er erst später gilt.",
      "Ändert sich derselbe Termin kurz danach noch einmal, rückt der Hinweis nach oben. Sie bekommen dann keine zweite Mitteilung aufs Handy.",
      "Hinweise bleiben 30 Tage nach ihrer letzten Änderung in der Glocke. Danach löscht moto sie.",
      "Was Sie auf dem Handy gelesen haben, ist auch am Tablet gelesen.",
      "Weiter unten in der Liste lädt moto ältere Hinweise nach. Sie können auch `Weitere laden` wählen.",
      "Zusätzlich kann moto Ihnen eine Mitteilung aufs Handy schicken. Das passiert nur bei Absagen von heute bis in 14 Tagen.",
      "Die Mitteilung aufs Handy schalten Sie in Ihrem `Profil` unter `Benachrichtigungen` bei `Absage eines Termins` aus. Der Hinweis in der Glocke kommt dann trotzdem.",
      "Zu neuen Hinweisen der Leitung kommt keine Mitteilung aufs Handy. Sie können sie im `Profil` unter `Benachrichtigungen` bei `Hinweise der Leitung` einschalten. Dann kommt sie, wenn der Hinweis schon gilt oder in den nächsten 14 Tagen beginnt.",
    ],
    differences: [
      "Auf dem Handy und auf kleinen Tablets fehlt oben die Glocke. Tippen Sie unten auf `Mehr` und dann auf `Benachrichtigungen`. Die Zahl an `Mehr` zählt neue Hinweise mit.",
      "Dort öffnen sich die Benachrichtigungen über den ganzen Bildschirm. Mit dem X schließen Sie sie wieder.",
      "Sie sehen keine `Erinnerungen`? Dann nutzt Ihre Schule keine Erinnerungen. Die Glocke zeigt dann nur die Hinweise.",
      "Sie arbeiten an zwei Schulen? Die Glocke zeigt die Hinweise der Schule, in der Sie gerade angemeldet sind.",
    ],
    troubleshootingDetails: [
      "Es kommt kein Hinweis zu einer Absage? Ihre Schule kann `Hinweis bei Absage eines Termins` ausschalten. Dann gibt es weder einen Hinweis noch eine Mitteilung aufs Handy. Fragen Sie Ihre Leitung.",
      "Es kommt kein Hinweis zu neuen Hinweisen der Leitung? Ihre Schule kann `Benachrichtigung bei neuem Hinweis der Leitung` ausschalten. Fragen Sie Ihre Leitung.",
      "Die Seite `Hinweise der Leitung` zeigt `Diesen Hinweis gibt es nicht mehr.`? Dann hat die Leitung ihn gelöscht oder abgeschaltet.",
      "Ein Hinweis öffnet eine Seite mit `Sie haben keinen Zugriff auf einen eigenen Dienstplan.`? Dann führt Ihre Schule für Sie keinen eigenen Dienstplan in moto. Fragen Sie Ihre Leitung.",
    ],
    image: "/help/screens/benachrichtigungen-glocke.webp",
    imageAlt:
      "Die geöffnete Glocke oben rechts mit dem Abschnitt Hinweise und einem neuen Hinweis „Termin abgesagt“.",
    related: [HELP_TOPICS.ownShiftPlan],
  };
}
