import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/statistics`: Quoten je Bereich ueber einen frei gewaehlten Zeitraum. */
export function statisticsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadStatistics,
    title: "Eine Statistik öffnen",
    question: "Wo sehe ich Quoten und Auslastung?",
    summary: "Die Statistik zeigt die Anwesenheit über einen Zeitraum.",
    group: "auswertung",
    audience: "lead",
    icon: "BarChart3",
    steps: [
      "Klappe in der Seitenleiste `Verwaltung` auf.",
      "Öffne `Statistik`.",
      "Wähle oben den Bereich: `Gruppen`, `Kinder`, `Räume`, `Kurse`, `Uhrzeit` oder `Soll und Ist`.",
      "Wähle den Zeitraum.",
      "Lies die Zahlen der Tabelle.",
    ],
    result: "Die Zahlen gelten für den gewählten Bereich und Zeitraum.",
    notes: [
      "Bei `Kurse` wählst du zusätzlich zwischen `Je Kurs` und `Je Kind`.",
      "`Uhrzeit` zeigt, wie viele Kinder in jeder halben Stunde da sind: `Geplant` und `Da`. Für einen Tag siehst du die Zahlen dieses Tages. Für einen Zeitraum wählst du den Wochentag und siehst Durchschnitt und Höchstwert.",
      "Bei `Geplant` zählen kranke und entschuldigte Kinder nicht mit, Kinder mit „Kommt heute nicht“ auch nicht.",
      "Mit `Alle Klassen` und `Alle Gruppen` grenzt du die Kinder ein.",
      "Über das Menü mit den drei Punkten geht `Exportieren` als `PDF`, `Excel` oder `Word`. `Soll und Ist` hat ein eigenes Menü an der Liste, mit `PDF` und `Excel`.",
      "Die Pfeile schieben den Zeitraum um seine eigene Länge weiter.",
    ],
    differences: [
      "`Räume` zeigt nur mit eingeschaltetem `Anwesenheitsprotokoll` Zahlen.",
      "Ohne `Anwesenheitsprotokoll` fehlt dort auch das Menü zum Exportieren.",
      "Ist die Raumhistorie ausgeschaltet? Deine Administration kann das `Anwesenheitsprotokoll` einschalten. Die Einstellung steht unter `Einstellungen` und `Datenschutz`.",
      "`Kurse` zeigt nur dann Zahlen, wenn deine OGS damit arbeitet.",
      "`Geplant` und `Da` fehlen für Tage, deren Krankmeldungen oder Anwesenheiten nicht mehr gespeichert sind. Die Seite nennt das Datum, ab dem es Zahlen gibt.",
    ],
    troubleshootingDetails: [
      "Fehlt `Statistik` in der Seitenleiste? Der Bereich ist der Leitung vorbehalten.",
    ],
    related: [
      HELP_TOPICS.leadAbsenceReport,
      HELP_TOPICS.leadExports,
      HELP_TOPICS.careTimeComparison,
      HELP_TOPICS.dayLog,
    ],
  };
}
