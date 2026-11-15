import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Die Glocke oben rechts im Staff-Portal (#7148): oben `Erinnerungen`, darunter
 * `Hinweise` (der Benachrichtigungs-Feed). Hinweise gibt es zur Absage eines
 * Termins (#7148) und zu Vertretungen und Änderungen im Dienstplan (#7136).
 */
export function staffNotificationsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.staffNotifications,
    title: "Hinweise und Erinnerungen in der Glocke",
    question: "Wo sehe ich, was sich für mich geändert hat?",
    summary:
      "Die Glocke oben rechts zeigt Ihre Erinnerungen und Ihre Hinweise, zum Beispiel wenn ein Termin von Ihnen ausfällt oder Sie jemanden vertreten.",
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
      "Vertreten Sie jemanden, werden Sie vertreten oder sind Sie an einem Tag als nicht da eingetragen, sehen Sie es hier. Eine Vertretung über mehrere Tage ist ein einziger Hinweis. Der Hinweis öffnet `Mein Dienstplan` an dem Tag.",
      "Sind Sie einer Gruppe zugeordnet, sehen Sie auch, wer in Ihrer Gruppe fehlt oder vertritt. Der Hinweis öffnet den `Vertretungsplan` an dem Tag. Einen Grund nennt moto nie, auch keine Krankheit.",
      "Wer die Änderung selbst einträgt, bekommt keinen Hinweis.",
      "Ändert sich derselbe Termin kurz danach noch einmal, rückt der Hinweis nach oben. Sie bekommen dann keine zweite Mitteilung aufs Handy.",
      "Hinweise bleiben 30 Tage nach ihrer letzten Änderung in der Glocke. Danach löscht moto sie.",
      "Was Sie auf dem Handy gelesen haben, ist auch am Tablet gelesen.",
      "Weiter unten in der Liste lädt moto ältere Hinweise nach. Sie können auch `Weitere laden` wählen.",
      "Zusätzlich kann moto Ihnen eine Mitteilung aufs Handy schicken. Das passiert nur bei Änderungen von heute bis in 14 Tagen.",
      "Die Mitteilung aufs Handy schalten Sie in Ihrem `Profil` unter `Benachrichtigungen` aus: bei `Absage eines Termins`, unter `Dienstplan und Vertretung` bei `Eigene Vertretung` und `Vertretung in Ihren Gruppen`. Der Hinweis in der Glocke kommt dann trotzdem.",
    ],
    differences: [
      "Auf dem Handy und auf kleinen Tablets fehlt oben die Glocke. Tippen Sie unten auf `Mehr` und dann auf `Benachrichtigungen`. Die Zahl an `Mehr` zählt neue Hinweise mit.",
      "Dort öffnen sich die Benachrichtigungen über den ganzen Bildschirm. Mit dem X schließen Sie sie wieder.",
      "Sie sehen keine `Erinnerungen`? Dann nutzt Ihre Schule keine Erinnerungen. Die Glocke zeigt dann nur die Hinweise.",
      "Sie arbeiten an zwei Schulen? Die Glocke zeigt die Hinweise der Schule, in der Sie gerade angemeldet sind.",
    ],
    troubleshootingDetails: [
      "Es kommt kein Hinweis zu einer Absage? Ihre Schule kann `Hinweis bei Absage eines Termins` ausschalten. Dann gibt es weder einen Hinweis noch eine Mitteilung aufs Handy. Fragen Sie Ihre Leitung.",
      "Es kommt kein Hinweis zu einer Vertretung? Ihre Schule kann `Hinweis bei Vertretung und Dienstplanänderung` ausschalten. Fragen Sie Ihre Leitung.",
      "Ein Hinweis öffnet eine Seite mit `Sie haben keinen Zugriff auf einen eigenen Dienstplan.`? Dann führt Ihre Schule für Sie keinen eigenen Dienstplan in moto. Fragen Sie Ihre Leitung.",
    ],
    image: "/help/screens/benachrichtigungen-glocke.webp",
    imageAlt:
      "Die geöffnete Glocke oben rechts mit dem Abschnitt Hinweise und einem neuen Hinweis „Termin abgesagt“.",
    related: [HELP_TOPICS.ownShiftPlan],
  };
}
