import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Die Glocke oben rechts im Staff-Portal (#7148): oben `Erinnerungen`, darunter
 * `Hinweise` (der Benachrichtigungs-Feed). Hinweise kommen zur Absage eines
 * Termins, zu Vertretungen, Änderungen im Dienstplan, neuen Hinweisen der
 * Leitung, zum Ausfall im Team, zu Raumänderungen, zum Stundenplan einer
 * Klasse, zu Schließtagen und zu weiteren Mitteilungs-Arten außer Nachrichten
 * (#7136, #7137, #7138, #7141, #7142, #7143, #7144).
 */
export function staffNotificationsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.staffNotifications,
    title: "Hinweise und Erinnerungen in der Glocke",
    question: "Wo sehe ich, was sich für mich geändert hat?",
    summary:
      "Die Glocke oben rechts zeigt deine Erinnerungen und deine Hinweise, zum Beispiel wenn ein Termin von dir ausfällt, du jemanden vertrittst oder sich eine Abholzeit ändert.",
    group: "einstieg",
    audience: ["caregiver", "lead"],
    icon: "Bell",
    steps: [
      "Wähle oben rechts die Glocke. Die Zahl daran zählt neue Hinweise und offene Erinnerungen. Ab 10 steht dort `9+`.",
      "Oben stehen die `Erinnerungen`. `Alle ansehen` öffnet die ganze Liste.",
      "Darunter stehen die `Hinweise`. Neue Hinweise sind mit `Neu` markiert.",
      "Wähle einen Hinweis. moto öffnet die passende Seite, zum Beispiel `Mein Dienstplan` an dem Tag.",
      "Mit `Alle als gelesen markieren` sind alle Hinweise auf einmal gelesen.",
    ],
    result:
      "Ein Hinweis gilt erst als gelesen, wenn du ihn wählst oder alle als gelesen markierst. Das Öffnen der Glocke allein ändert nichts.",
    notes: [
      "Fällt ein Termin aus, bei dem du eingeplant bist, siehst du es hier. Wer den Termin absagt, bekommt keinen Hinweis. Nimmt die Leitung die Absage zurück, steht dort `Termin findet doch statt`.",
      "Findet ein Termin, bei dem du eingeplant bist, in einem anderen Raum statt, siehst du es hier. Im Hinweis stehen der neue und der alte Raum.",
      "Vertrittst du jemanden, wirst du vertreten oder bist du an einem Tag als nicht da eingetragen, siehst du es hier. Eine Vertretung über mehrere Tage ist ein einziger Hinweis. Der Hinweis öffnet `Mein Dienstplan` an dem Tag.",
      "Bist du einer Gruppe zugeordnet, siehst du auch, wer in deiner Gruppe fehlt oder vertritt. Der Hinweis öffnet den `Vertretungsplan` an dem Tag. Einen Grund nennt moto nie, auch keine Krankheit.",
      "Wurde dir eine Gruppe übergeben, siehst du unter `Ausfall im Team`, wer in dieser Gruppe nicht da ist. Der Hinweis öffnet `Heute` an dem Tag.",
      "Wer die Änderung selbst einträgt, bekommt keinen Hinweis.",
      "Ändert sich der Unterrichtsschluss einer Klasse, steht hier `Stundenplan geändert`. Das siehst du, wenn du der Klasse zugeordnet bist oder Kinder der Klasse in deiner Gruppe sind. Der Hinweis öffnet `Heute` an dem Tag.",
      "Trägt die Leitung einen Schließtag ein, ändert oder löscht ihn, bekommen alle im Team einen Hinweis. Ein Klick darauf öffnet den `Kalender`.",
      // #8178: Hinweis zur geänderten Öffnungszeit.
      "Öffnet oder schließt die OGS an einem Tag zu anderen Zeiten, bekommen alle im Team einen Hinweis. Darin stehen der Tag und die Uhrzeit.",
      "Schreibt die Leitung unter `Hinweise der Leitung` etwas Neues für die Betreuung, steht es hier als `Neuer Hinweis der Leitung`. Ein Klick darauf öffnet die Seite `Hinweise der Leitung` mit diesem Text, auch wenn er erst später gilt.",
      "Auch diese Arten kommen als Hinweis: `Geänderte Abholzeit`, `Krankmeldung eines Kindes`, `Notizen für das Team` und `Umfragen der Einrichtung`.",
      "Die Leitung bekommt außerdem `Austritte aus dem Team` und `Ablaufende Nachweise im Team`. Für deine eigenen Nachweise gibt es `Eigene Nachweise`.",
      "Nachrichten stehen nicht in der Glocke. Neue Nachrichten zählt moto bei `Nachrichten` und `Team-Chat`.",
      "Werden zum Schuljahr viele Zeiten einer Klasse nacheinander eingetragen, bleibt es ein Hinweis pro Klasse.",
      "Ändert sich derselbe Termin kurz danach noch einmal, rückt der Hinweis nach oben. Du bekommst dann keine zweite Mitteilung aufs Handy.",
      "Hinweise bleiben 30 Tage nach ihrer letzten Änderung in der Glocke. Danach löscht moto sie.",
      "Was du auf dem Handy gelesen hast, ist auch am Tablet gelesen.",
      "Weiter unten in der Liste lädt moto ältere Hinweise nach. Du kannst auch `Weitere laden` wählen.",
      "Zusätzlich kann moto dir eine Mitteilung aufs Handy schicken. Bei Absagen, Schließtagen und Änderungen im Dienstplan passiert das nur von heute bis in 14 Tagen.",
      "Die Mitteilung aufs Handy stellst du in deinem `Profil` unter `Benachrichtigungen` für jede Art ein. Schaltest du sie aus, kommt der Hinweis in der Glocke trotzdem.",
      "Zu neuen Hinweisen der Leitung kommt keine Mitteilung aufs Handy. Du kannst sie im `Profil` unter `Benachrichtigungen` bei `Hinweise der Leitung` einschalten. Dann kommt sie, wenn der Hinweis schon gilt oder in den nächsten 14 Tagen beginnt.",
      "Die Einstellung für `Absage eines Termins` gilt auch, wenn die Absage zurückgenommen wird.",
      "Bei Raumänderungen gibt es zwei Einstellungen. `Raumänderung heute oder morgen` ist eingeschaltet. `Raumänderung an späteren Tagen` schaltest du selbst ein. Sie gilt bis 14 Tage im Voraus.",
      "Zum Stundenplan einer Klasse kommt eine Mitteilung aufs Handy, wenn die Änderung heute oder morgen gilt. Für Änderungen in 2 bis 14 Tagen schaltest du im `Profil` unter `Benachrichtigungen` den Punkt `Stundenplan deiner Klassen: spätere Tage` ein.",
    ],
    differences: [
      "Auf dem Handy und auf kleinen Tablets fehlt oben die Glocke. Tippe unten auf `Mehr` und dann auf `Benachrichtigungen`. Die Zahl an `Mehr` zählt neue Hinweise mit.",
      "Dort öffnen sich die Benachrichtigungen über den ganzen Bildschirm. Mit dem X schließt du sie wieder.",
      "Du siehst keine `Erinnerungen`? Dann nutzt deine Schule keine Erinnerungen. Die Glocke zeigt dann nur die Hinweise.",
      "Du arbeitest an zwei Schulen? Die Glocke zeigt die Hinweise der Schule, in der du gerade angemeldet bist.",
    ],
    troubleshootingDetails: [
      "Es kommt kein Hinweis zu einer Absage? Deine Schule kann `Hinweis bei Absage eines Termins` ausschalten. Dann gibt es weder einen Hinweis noch eine Mitteilung aufs Handy. Frage deine Leitung.",
      "Es kommt kein Hinweis zu einer Raumänderung? Deine Schule kann `Hinweis bei Raumänderung` ausschalten. Frage deine Leitung.",
      "Es kommt kein Hinweis zu einer Vertretung? Deine Schule kann `Hinweis bei Vertretung und Dienstplanänderung` ausschalten. Frage deine Leitung.",
      "Es kommt kein Hinweis zum Stundenplan einer Klasse? Deine Schule kann `Hinweis bei geändertem Stundenplan einer Klasse` ausschalten. Frage deine Leitung.",
      "Es kommt kein Hinweis zu einem Schließtag? Deine Schule kann `Benachrichtigung bei Schließtagen` ausschalten. Frage deine Leitung.",
      "Es kommt kein Hinweis zu einer geänderten Öffnungszeit? Deine Schule kann `Benachrichtigung bei geänderter Öffnungszeit` ausschalten. Frage deine Leitung.",
      "Es kommt kein Hinweis zu neuen Hinweisen der Leitung? Deine Schule kann `Benachrichtigung bei neuem Hinweis der Leitung` ausschalten. Frage deine Leitung.",
      "Die Seite `Hinweise der Leitung` zeigt `Diesen Hinweis gibt es nicht mehr.`? Dann hat die Leitung ihn gelöscht oder abgeschaltet.",
      "Es kommt kein Hinweis zu einer Krankmeldung? Deine Schule kann `Hinweis bei Krankmeldung` ausschalten. Manche Schulen melden sie auch nur Personen, die gerade im Dienst sind. Frage deine Leitung.",
      "Ein Hinweis öffnet eine Seite mit `Du hast keinen Zugriff auf einen eigenen Dienstplan.`? Dann führt deine Schule für dich keinen eigenen Dienstplan in moto. Frage deine Leitung.",
    ],
    image: "/help/screens/benachrichtigungen-glocke.webp",
    imageAlt:
      "Die geöffnete Glocke oben rechts mit dem Abschnitt Hinweise und einem neuen Hinweis „Termin abgesagt“.",
    related: [HELP_TOPICS.ownShiftPlan],
  };
}
