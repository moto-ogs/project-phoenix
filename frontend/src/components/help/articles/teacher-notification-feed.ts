import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Die Glocke oben rechts in moto schule (#7139): die `Hinweise` der Lehrkraft,
 * zuerst die Absage eines Termins, für den sie eingeplant ist, dazu der
 * geänderte Stundenplan ihrer Klassen und Schließtage (#7142, #7144).
 */
export function teacherNotificationFeedTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherNotificationFeed,
    title: "Hinweise in der Glocke",
    question: "Wo sehe ich, was sich für mich geändert hat?",
    summary:
      "Die Glocke oben rechts zeigt deine Hinweise, zum Beispiel wenn ein Termin von dir ausfällt.",
    group: "einstieg",
    audience: "teacher",
    icon: "Bell",
    steps: [
      "Wähle oben rechts die Glocke. Die Zahl daran zählt neue Hinweise. Ab 10 steht dort `9+`.",
      "Neue Hinweise sind mit `Neu` markiert.",
      "Wähle einen Hinweis. moto öffnet die passende Seite, zum Beispiel `Meine Aufsichten`.",
      "Mit `Alle als gelesen markieren` sind alle Hinweise auf einmal gelesen.",
    ],
    result:
      "Erst dein Klick macht einen Hinweis zu „gelesen“. Das Öffnen der Glocke allein ändert nichts.",
    notes: [
      "Fällt ein Termin aus, bei dem du eingeplant bist, siehst du es hier. Wer den Termin absagt, bekommt keinen Hinweis.",
      "Nimmt die Leitung die Absage zurück, steht dort `Termin findet doch statt`.",
      "Findet ein Termin, bei dem du eingeplant bist, in einem anderen Raum statt, siehst du es auch hier. Im Hinweis stehen der neue und der alte Raum.",
      "Trägt die OGS einen Schließtag ein, ändert oder löscht ihn, siehst du es hier. Ein Klick darauf öffnet den `Kalender`.",
      "Ändert sich der Unterrichtsschluss einer deiner Klassen, steht hier `Stundenplan geändert`. Der Hinweis öffnet die Klasse an dem Tag. Werden viele Zeiten einer Klasse nacheinander eingetragen, bleibt es ein Hinweis.",
      "`Meine Aufsichten` zeigt den heutigen Tag. Liegt der Termin später, steht der Tag im Hinweis.",
      "Hinweise bleiben 30 Tage nach ihrer letzten Änderung in der Glocke. Danach löscht moto sie.",
      "Was du auf dem Handy gelesen hast, ist auch am Computer gelesen.",
      "Zusätzlich kann moto dir eine Mitteilung aufs Handy schicken. Das passiert nur bei Absagen und Schließtagen von heute bis in 14 Tagen.",
      "Die Mitteilung aufs Handy schaltest du unter `Einstellungen` bei `Absage eines Termins` oder `Schließtagen` aus. Der Hinweis in der Glocke kommt dann trotzdem.",
      "Die Einstellung gilt auch, wenn eine Absage zurückgenommen wird.",
      "Bei Raumänderungen gibt es zwei Einstellungen. `Raumänderung heute oder morgen` ist eingeschaltet. `Raumänderung an späteren Tagen` schaltest du selbst ein. Sie gilt bis 14 Tage im Voraus.",
      "Zum Stundenplan einer Klasse kommt eine Mitteilung aufs Handy, wenn die Änderung heute oder morgen gilt. Für 2 bis 14 Tage vorher schaltest du unter `Einstellungen` den Punkt `Stundenplan deiner Klassen: spätere Tage` ein.",
    ],
    differences: [
      "Auf dem Handy öffnen sich die Hinweise über den ganzen Bildschirm. Mit dem X schließt du sie wieder.",
      "Du arbeitest auch in der OGS mit moto? Dort siehst du dieselben Hinweise. Was du hier liest, ist dort auch gelesen.",
    ],
    troubleshootingDetails: [
      "Es kommt kein Hinweis zu einer Raumänderung? Die OGS-Leitung kann `Hinweis bei Raumänderung` ausschalten. Frage dort nach.",
      "Es kommt kein Hinweis zu einer Absage? Die OGS-Leitung kann `Hinweis bei Absage eines Termins` ausschalten. Dann gibt es weder Hinweis noch Mitteilung aufs Handy. Frage dort nach.",
      "Es kommt kein Hinweis zum Stundenplan? Die OGS-Leitung kann `Hinweis bei geändertem Stundenplan einer Klasse` ausschalten. Frage dort nach.",
      "Es kommt kein Hinweis zu einem Schließtag? Die OGS-Leitung kann `Benachrichtigung bei Schließtagen` ausschalten. Frage dort nach.",
    ],
    related: [HELP_TOPICS.teacherSettings, HELP_TOPICS.teacherSupervision],
  };
}
