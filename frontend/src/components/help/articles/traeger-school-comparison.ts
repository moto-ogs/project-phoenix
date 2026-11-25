import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/standortvergleich` (#4715): Kennzahlen der Schulen nebeneinander. */
export function traegerSchoolComparisonTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerSchoolComparison,
    title: "Schulen vergleichen",
    question: "Wie stehen meine Schulen im Vergleich da?",
    summary:
      "Der Standortvergleich zeigt dieselben Kennzahlen für alle Schulen nebeneinander, mit dem Schnitt der Schulen.",
    group: "einstieg",
    audience: "traeger",
    icon: "ChartBarHorizontal",
    requirements: ["Das Recht „Berichte lesen“."],
    steps: [
      "Wähle in der Navigation `Standortvergleich`.",
      "Wähle oben den Zeitraum, zum Beispiel `Letzte 3 Monate`. Mit den Pfeilen springst du einen Zeitraum vor oder zurück.",
      "Wähle bei Bedarf rechts daneben die Schulen. Ohne Auswahl vergleicht moto alle Schulen.",
      "Wähle bei `Rangfolge` eine Kennzahl, zum Beispiel `Plätze belegt`. Die Schule mit der größten Zahl steht oben.",
      "Wähle bei `Kennzahlen pro Schule` die Spalten, die du vergleichen willst.",
      "Öffne oben rechts das Drei-Punkte-Menü. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`. Die Datei enthält die gewählten Schulen und Kennzahlen.",
    ],
    result:
      "Du siehst, welche Schule voller oder leerer ist als die anderen und wie weit sie vom Schnitt entfernt ist.",
    notes: [
      "„Ø“ ist der Durchschnitt pro Tag. Bei „Kinder anwesend“ zählen nur Tage mit Check-ins.",
      "Unter jeder Zahl steht der Abstand zum Schnitt der Schulen, zum Beispiel „12 Punkte über Schnitt“.",
      "Unter den Schulen stehen zwei Zeilen: `Schnitt pro Schule` und `Alle zusammen`.",
      "„Aktive Kinder am letzten Tag“ zählt die Kinder, die die Schule am letzten Tag des Zeitraums aktiv führt.",
      "Die Datei enthält genau die gewählten Schulen und Spalten.",
      "Den Verlauf über die Zeit siehst du unter `Auslastung`.",
    ],
    differences: [
      "Steht bei einer Schule „–“, fehlt ihr die Zahl im Zeitraum. Das ist so ohne Platzgrenze oder ohne Check-in.",
      "Steht `Bei einer Schule gibt es Check-ins erst ab …`, zählt „Kinder anwesend“ dort nur die Tage danach.",
      "Bei `Alle zusammen` fehlt „Höchstens anwesend“. Die vollsten Tage der Schulen liegen an verschiedenen Tagen.",
    ],
    image: "/help/screens/traeger-standortvergleich.webp",
    imageAlt:
      "Die Seite Standortvergleich: oben Zeitraum und Schulen, darunter vier Kennzahlen, die Rangfolge als liegende Balken und die Tabelle pro Schule.",
    related: [HELP_TOPICS.traegerUtilization, HELP_TOPICS.traegerReports],
  };
}
