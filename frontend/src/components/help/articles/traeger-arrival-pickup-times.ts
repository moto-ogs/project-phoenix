import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/ankunft-abholung` (#4714): wann Kinder an den Schulen des Trägers
 * ankommen und gehen, je Wochentag und halbe Stunde.
 */
export function traegerArrivalPickupTimesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerArrivalPickupTimes,
    title: "Ankunft und Abholung",
    question: "Wann kommen die Kinder an und wann gehen sie?",
    summary:
      "Farbige Felder zeigen je Wochentag und halbe Stunde, wie viele Kinder ankommen und gehen. So planst du Personal für die vollen Zeiten.",
    image: "/help/screens/ankunft-und-abholung.webp",
    imageAlt:
      "Oben die Hauptzeiten Meiste Ankünfte und Meiste Abholungen. Darunter die grünen Felder der Ankunft mit einer Zeile je Wochentag und einem Feld je halbe Stunde.",
    group: "auswertung",
    audience: "traeger",
    icon: "ClockAfternoon",
    requirements: [
      "Du brauchst das Recht `Berichte lesen`. Es gehört zu den Rollen `Verwaltung`, `Abrechnung`, `Personal` und `Nur lesen`.",
    ],
    steps: [
      "Wähle in der Navigation `Ankunft und Abholung`.",
      "Wähle oben den Zeitraum. Am Anfang sind es die letzten 4 Wochen bis gestern.",
      "Lies oben die Hauptzeiten: `Meiste Ankünfte` und `Meiste Abholungen`.",
      "Lies die Felder unter `Ankunft` und `Abholung`. Je dunkler ein Feld, desto mehr Kinder. Die Zahl im Feld ist der Durchschnitt eines Tages.",
      "Zeige auf ein Feld oder tippe darauf. Darunter steht dann die genaue Zahl.",
      "Wähle unter `Je Schule` eine Schule oder oben neben dem Zeitraum eine Schule. Dann siehst du nur diese Schule.",
      "Öffne oben rechts das Drei-Punkte-Menü. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`. Mit einer gewählten Schule enthält die Datei nur diese Schule.",
    ],
    result:
      "Du siehst, wann an jeder Schule viele Kinder kommen und gehen. Plane für diese Zeiten mehr Personal ein.",
    notes: [
      "Als Ankunft zählt das erste Einchecken eines Kindes am Tag. Als Abholung zählt das letzte Auschecken, auch wenn ein Kind allein nach Hause geht.",
      "Geht ein Kind zwischendurch und kommt wieder, zählt nur der erste und der letzte Zeitpunkt.",
      "Jede Zahl ist der Durchschnitt eines Tages, zum Beispiel aller Montage im Zeitraum. Es zählen nur Tage, an denen die Schule Kinder eingecheckt hat. Ferien und Schließtage ohne Betreuung zählen also nicht.",
      "Bei `Alle Schulen` stehen die Zahlen aller Schulen zusammengezählt.",
      "Heute zählt erst ab morgen mit, weil der Tag noch nicht vorbei ist.",
      "Du siehst nur Zahlen, keine Namen von Kindern.",
    ],
    differences: [
      "Steht bei einer Schule unter `Tage` ein Datum wie `ab 03.11.2026`? Diese Schule hat erst ab diesem Tag Kinder eingecheckt, später als die anderen Schulen. Zum Beispiel arbeitet sie erst seit diesem Tag mit moto, oder ältere Einträge sind schon gelöscht.",
      "Steht bei einem Wochentag `keine Daten`? An diesem Wochentag hat die Schule im Zeitraum kein Kind eingecheckt.",
      "Ist ein Kind noch da oder wurde nicht ausgecheckt, zählt seine Ankunft, aber keine Abholung.",
      "Auf dem Telefon steht `Ankunft und Abholung` unter `Mehr`. Die Wochentage stehen dort oben, die Uhrzeiten laufen nach unten.",
      "Fehlt der Eintrag in der Navigation? Deine Rolle hat das Recht `Berichte lesen` nicht.",
    ],
    related: [
      HELP_TOPICS.traegerOccupancy,
      HELP_TOPICS.traegerCareTimeOverruns,
    ],
  };
}
