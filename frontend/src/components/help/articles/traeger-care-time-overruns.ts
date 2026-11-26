import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/zeitvergleich` (#4683): wie oft Kinder an den Schulen des Trägers
 * länger da waren als gebucht, je Schule und mit Recht auch je Kind.
 */
export function traegerCareTimeOverrunsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerCareTimeOverruns,
    title: "Länger als gebucht",
    question: "Welche Kinder waren länger da als gebucht?",
    summary:
      "moto vergleicht die Zeiten im Vertrag mit dem Ein- und Auschecken. Du siehst pro Schule, wie oft Kinder länger da waren.",
    group: "auswertung",
    audience: "traeger",
    icon: "Hourglass",
    requirements: [
      "Für die Zahlen pro Schule brauchst du das Recht `Berichte lesen`. Es gehört zu den Rollen `Verwaltung`, `Abrechnung`, `Personal` und `Nur lesen`.",
      "Für die Namen der Kinder brauchst du das Recht `Verträge verwalten`. Es gehört zur Rolle `Verwaltung`.",
    ],
    steps: [
      "Wähle in der Navigation `Länger als gebucht`.",
      "Wähle oben den Monat. Am Anfang ist es der laufende Monat bis heute.",
      "Wähle bei Bedarf eine Schule. Sonst siehst du alle Schulen.",
      "Lies oben die Summen: `Kinder`, `Tage` und `Zusätzliche Zeit`.",
      "Lies unter `Pro Schule` die Zahlen jeder Schule. Tippe auf eine Spalte, um nach ihr zu sortieren.",
      "Mit der Rolle `Verwaltung` siehst du unter `Kinder` jedes Kind mit Namen. Das Kind mit der meisten zusätzlichen Zeit steht oben.",
      "Jede Tabelle hat rechts oben `Herunterladen`. Wähle `PDF`, `Excel` oder `CSV`. Die Datei gilt für den Monat und die gewählte Schule.",
    ],
    result:
      "Rote Zahlen zeigen Überschreitungen. Sprich mit den Eltern, oder ändere die Buchung.",
    notes: [
      "Änderst du die Zeiten eines Zeitmodells? Die neuen Zeiten gelten ab dem Änderungstag. Vergangene gebuchte Tage behalten ihre bisherigen Zeiten. Auch nach Umbuchung oder Archivierung bleiben diese Zeiten erhalten.",
      "Das Soll kommt aus dem versendeten Vertrag: pro Wochentag die Module und die Endzeit. Ohne Vertrag gilt der Betreuungsplan der Schule.",
      "An einem Tag mit bestätigter Ferienbuchung gilt die Ferienbuchung, nicht der Vertrag. Jeder Tag zählt nur einmal.",
      "Das Ist reicht vom ersten Einchecken bis zum letzten Auschecken des Tages.",
      "Eine Überschreitung ist mehr als 15 Minuten früher oder später als gebucht. Ein Tag ohne Buchung zählt ganz.",
      "Krank, entschuldigt, abgemeldet, Schließtage und Feiertage zählen nicht.",
      "Jedes Mal, wenn du Namen siehst oder herunterlädst, steht das im Zugriffsprotokoll der Schule.",
    ],
    differences: [
      "Fehlt der Bereich mit den Namen? Deine Rolle hat das Recht `Verträge verwalten` nicht. Dann siehst du nur die Zahlen pro Schule.",
      "Steht bei einer Schule `Check-ins erst ab` mit einem Datum? Die Schule bewahrt Check-ins nicht so lange auf. Verglichen wird ab diesem Tag.",
      "Steht bei einer Schule `–` und `Keine Check-ins im Zeitraum`? Die Schule hat in diesem Zeitraum keine Check-ins. Dann kann moto nicht vergleichen. Das heißt nicht, dass alle Zeiten passen.",
      "Steht bei einer Schule `Tage nicht verglichen`? An diesen Tagen war ein Kind da, aber es gab keinen Plan oder es ist noch nicht ausgecheckt. Diese Tage zählen nicht mit.",
    ],
    related: [HELP_TOPICS.traegerCareContracts, HELP_TOPICS.traegerAccessLog],
  };
}
