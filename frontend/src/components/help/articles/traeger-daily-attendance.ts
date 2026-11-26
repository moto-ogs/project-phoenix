import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/tagesmeldung` (#4717): An- und Abwesenheit der Kinder je Tag an
 * den Schulen des Trägers in Mecklenburg-Vorpommern, als Datei für das Land.
 */
export function traegerDailyAttendanceTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerDailyAttendance,
    title: "Tagesmeldung Mecklenburg-Vorpommern",
    question: "Wie melde ich die tägliche An- und Abwesenheit an das Land?",
    summary:
      "Für Schulen in Mecklenburg-Vorpommern zeigt moto pro Tag, wer da war und wer gefehlt hat. Die Datei für das Land lädst du mit einem Klick herunter.",
    image: "/help/screens/tagesmeldung-mecklenburg-vorpommern.webp",
    imageAlt:
      "Oben die Zahlen Kinder am Tag, Verweildauer, Längster Tag und Abwesend gemeldet. Darunter die Tabelle Pro Tag mit einer Zeile pro Tag.",
    group: "auswertung",
    audience: "traeger",
    icon: "SealCheck",
    requirements: [
      "Du brauchst das Recht `Berichte lesen`. Es gehört zu den Rollen `Verwaltung`, `Abrechnung`, `Personal` und `Nur lesen`.",
      "Mindestens eine Schule deines Trägers liegt in Mecklenburg-Vorpommern. Das Bundesland einer Schule stellt das moto-Team ein.",
    ],
    steps: [
      "Wähle in der Navigation `Tagesmeldung`.",
      "Wähle oben den Zeitraum. Am Anfang ist es die letzte Woche bis gestern. Ein Zeitraum hat höchstens 31 Tage.",
      "Lies oben die Zahlen: `Kinder am Tag`, `Verweildauer`, `Längster Tag` und `Abwesend gemeldet`.",
      "Lies unter `Pro Tag`, wie viele Kinder an jedem Tag da waren und wie viele krank, entschuldigt oder auf Klassenfahrt waren.",
      "Wähle oben neben dem Zeitraum eine Schule, um nur sie zu sehen.",
      "Öffne oben rechts das Drei-Punkte-Menü. Wähle unter `Herunterladen` `CSV`. Diese Datei reichst du beim Land ein. `PDF` und `Excel` sind für deine eigene Ablage.",
    ],
    result:
      "Du hast die Datei mit einer Zeile pro Kind und Tag. Sie enthält keine Namen.",
    notes: [
      "Die Pflicht steht in § 32 Absatz 1a KiföG M-V und gilt ab 2027.",
      "Das Land legt das genaue Format noch fest. Bis dahin enthält die Datei: Einrichtung, Ort, Datum, laufende Nummer, Status, Ankunft, Abholung und die Minuten dazwischen.",
      "Als Ankunft zählt das erste Einchecken am Tag, als Abholung das letzte Auschecken.",
      "War ein Kind krank gemeldet, kam aber doch, zählt es als anwesend.",
      "Heute zählt erst ab morgen mit, weil der Tag noch nicht vorbei ist.",
      "Jedes Herunterladen steht im Zugriffsprotokoll der Schule.",
    ],
    differences: [
      "Fehlt der Eintrag in der Navigation? Dann liegt keine Schule deines Trägers in Mecklenburg-Vorpommern, oder deine Rolle hat das Recht `Berichte lesen` nicht.",
      "Steht unter `Ohne Abholung` eine Zahl? So viele Kinder wurden an diesem Tag nicht ausgecheckt. Für sie gibt es keine Abholzeit und keine Verweildauer.",
      "Steht oben, dass Schulen fehlen? Diese Schulen liegen in einem anderen Bundesland und gehören nicht in die Meldung.",
      "Auf dem Telefon steht `Tagesmeldung` unter `Mehr`.",
    ],
    related: [
      HELP_TOPICS.traegerArrivalPickupTimes,
      HELP_TOPICS.traegerAccessLog,
    ],
  };
}
