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
      "Zwei Heatmaps zeigen je Wochentag und halbe Stunde, wie viele Kinder ankommen und gehen. So planen Sie Personal für die vollen Zeiten.",
    image: "/help/screens/ankunft-und-abholung.webp",
    imageAlt:
      "Oben die Hauptzeiten Meiste Ankünfte und Meiste Abholungen. Darunter die grüne Heatmap Ankunft mit einer Zeile je Wochentag und einem Feld je halbe Stunde.",
    group: "auswertung",
    audience: "traeger",
    icon: "ClockAfternoon",
    requirements: [
      "Sie brauchen das Recht `Berichte lesen`. Es gehört zu den Rollen `Verwaltung`, `Abrechnung`, `Personal` und `Nur lesen`.",
    ],
    steps: [
      "Wählen Sie in der Navigation `Ankunft und Abholung`.",
      "Wählen Sie oben den Zeitraum. Am Anfang sind es die letzten 4 Wochen bis gestern.",
      "Lesen Sie oben die Hauptzeiten: `Meiste Ankünfte` und `Meiste Abholungen`.",
      "Lesen Sie die Heatmaps `Ankunft` und `Abholung`. Je dunkler ein Feld, desto mehr Kinder. Die Zahl im Feld ist der Durchschnitt eines Tages.",
      "Zeigen Sie auf ein Feld oder tippen Sie darauf. Unter der Heatmap steht dann die genaue Zahl.",
      "Wählen Sie unter `Je Schule` eine Schule oder oben den Filter `Schule`. Dann sehen Sie nur diese Schule.",
      "Wählen Sie `Herunterladen` und dann `CSV`, um alle Zahlen als Tabelle zu speichern.",
    ],
    result:
      "Sie sehen, wann an jeder Schule viele Kinder kommen und gehen. Planen Sie für diese Zeiten mehr Personal ein.",
    notes: [
      "Als Ankunft zählt das erste Einchecken eines Kindes am Tag. Als Abholung zählt das letzte Auschecken, auch wenn ein Kind allein nach Hause geht.",
      "Geht ein Kind zwischendurch und kommt wieder, zählt nur der erste und der letzte Zeitpunkt.",
      "Jede Zahl ist der Durchschnitt eines Tages, zum Beispiel aller Montage im Zeitraum. Es zählen nur Tage, an denen die Schule Kinder eingecheckt hat. Ferien und Schließtage ohne Betreuung zählen also nicht.",
      "Bei `Alle Schulen` stehen die Zahlen aller Schulen zusammengezählt.",
      "Heute zählt erst ab morgen mit, weil der Tag noch nicht vorbei ist.",
      "Sie sehen nur Zahlen, keine Namen von Kindern.",
    ],
    differences: [
      "Steht bei einer Schule unter `Tage` ein Datum wie `ab 03.11.2026`? Die Schule bewahrt Check-ins nicht länger auf. Die Zahlen beginnen an diesem Tag.",
      "Steht bei einem Wochentag `keine Daten`? An diesem Wochentag hat die Schule im Zeitraum kein Kind eingecheckt.",
      "Ist ein Kind noch da oder wurde nicht ausgecheckt, zählt seine Ankunft, aber keine Abholung.",
      "Fehlt der Eintrag in der Navigation? Ihre Rolle hat das Recht `Berichte lesen` nicht.",
    ],
    related: [
      HELP_TOPICS.traegerOccupancy,
      HELP_TOPICS.traegerCareTimeOverruns,
    ],
  };
}
