import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Die Glocke oben rechts in moto schule (#7139): die `Hinweise` der Lehrkraft,
 * zuerst die Absage eines Termins, für den sie eingeplant ist.
 */
export function teacherNotificationFeedTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherNotificationFeed,
    title: "Hinweise in der Glocke",
    question: "Wo sehe ich, was sich für mich geändert hat?",
    summary:
      "Die Glocke oben rechts zeigt Ihre Hinweise, zum Beispiel wenn ein Termin von Ihnen ausfällt.",
    group: "einstieg",
    audience: "teacher",
    icon: "Bell",
    steps: [
      "Wählen Sie oben rechts die Glocke. Die Zahl daran zählt neue Hinweise. Ab 10 steht dort `9+`.",
      "Neue Hinweise sind mit `Neu` markiert.",
      "Wählen Sie einen Hinweis. moto öffnet die passende Seite, zum Beispiel `Meine Aufsichten`.",
      "Mit `Alle als gelesen markieren` sind alle Hinweise auf einmal gelesen.",
    ],
    result:
      "Erst Ihr Klick macht einen Hinweis zu „gelesen“. Das Öffnen der Glocke allein ändert nichts.",
    notes: [
      "Fällt ein Termin aus, bei dem Sie eingeplant sind, sehen Sie es hier. Wer den Termin absagt, bekommt keinen Hinweis.",
      "Nimmt die Leitung die Absage zurück, steht dort `Termin findet doch statt`.",
      "`Meine Aufsichten` zeigt den heutigen Tag. Liegt der Termin später, steht der Tag im Hinweis.",
      "Hinweise bleiben 30 Tage nach ihrer letzten Änderung in der Glocke. Danach löscht moto sie.",
      "Was Sie auf dem Handy gelesen haben, ist auch am Computer gelesen.",
      "Zusätzlich kann moto Ihnen eine Mitteilung aufs Handy schicken. Das passiert nur bei Absagen von heute bis in 14 Tagen.",
      "Die Mitteilung aufs Handy schalten Sie unter `Einstellungen` bei `Absage eines Termins` aus. Der Hinweis in der Glocke kommt dann trotzdem.",
      "Die Einstellung gilt auch, wenn eine Absage zurückgenommen wird.",
    ],
    differences: [
      "Auf dem Handy öffnen sich die Hinweise über den ganzen Bildschirm. Mit dem X schließen Sie sie wieder.",
      "Sie arbeiten auch in der OGS mit moto? Dort sehen Sie dieselben Hinweise. Was Sie hier lesen, ist dort auch gelesen.",
    ],
    troubleshootingDetails: [
      "Es kommt kein Hinweis zu einer Absage? Die OGS-Leitung kann `Hinweis bei Absage eines Termins` ausschalten. Dann gibt es weder Hinweis noch Mitteilung aufs Handy. Fragen Sie dort nach.",
    ],
    related: [HELP_TOPICS.teacherSettings, HELP_TOPICS.teacherSupervision],
  };
}
