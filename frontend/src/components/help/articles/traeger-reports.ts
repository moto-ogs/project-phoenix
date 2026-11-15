import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/berichte` (#4716): Berichte nach Vorlage zum Stichtag für Jugendamt und Kommune. */
export function traegerReportsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerReports,
    title: "Berichte zum Stichtag",
    question: "Wie erstelle ich einen Bericht für Jugendamt oder Kommune?",
    summary:
      "Ein Bericht zählt alle Schulen Ihres Trägers an einem Stichtag: Kinder, Personal, Fehlzeiten, Belegung und Nachfrage.",
    group: "einstieg",
    audience: "traeger",
    icon: "ClipboardList",
    requirements: [
      "Das Recht „Berichte lesen“. Vorlagen anlegen und ändern dürfen Personen mit der Rolle Verwaltung.",
    ],
    steps: [
      "Wählen Sie in der Navigation `Berichte`.",
      "Wählen Sie oben eine Vorlage. Ohne Vorlage zeigt moto alle Abschnitte.",
      "Prüfen Sie den Stichtag. moto schlägt den letzten 15. Oktober vor. Mit den Pfeilen springen Sie ein Jahr vor oder zurück.",
      "Hat die Vorlage Sozialräume, wählen Sie `Je Schule` oder `Je Sozialraum`.",
      "Wählen Sie in der Tabelle der Kinder eine Zeile, um die Betreuungsformen zu sehen.",
      "Wählen Sie `Herunterladen` und dann `PDF`, `Excel` oder `CSV`.",
    ],
    result:
      "Sie haben eine Datei mit den Zahlen aller Schulen und einer Zeile „Gesamt“. Sie können sie an Jugendamt oder Kommune schicken.",
    instructionGroups: [
      {
        title: "Eine Vorlage anlegen",
        description:
          "Eine Vorlage merkt sich Abschnitte, üblichen Stichtag und Sozialräume. So sieht jeder Bericht gleich aus.",
        steps: [
          "Wählen Sie den Reiter `Vorlagen`.",
          "Wählen Sie `Neue Vorlage`.",
          "Geben Sie einen Namen ein, zum Beispiel `Jugendamt Stichtag 15.10.`.",
          "Wählen Sie die Abschnitte, die der Bericht zeigen soll.",
          "Wählen Sie Tag und Monat des üblichen Stichtags.",
          "Tragen Sie bei Bedarf bei jeder Schule ihren Sozialraum ein.",
          "Wählen Sie `Vorlage anlegen`.",
        ],
        ordered: true,
      },
    ],
    notes: [
      "„Kinder“ zählt die Kinder, die die Schule am Stichtag aktiv führt. Das ist dieselbe Zählung wie bei den Stichtagszahlen.",
      "„Fehlzeiten“ zählt Tage vom 1. August bis zum Stichtag. Gezählt werden nur Montag bis Freitag.",
      "„Offen“ und „Warteliste“ zeigen immer den Stand von heute, auch bei einem früheren Stichtag.",
      "„Nachfrage“ sind gebuchte Kinder, offene Anmeldungen und Warteliste zusammen.",
      "Der Bericht enthält nur Zahlen, keine Namen von Kindern oder Personal.",
    ],
    differences: [
      "Fehlt der Reiter `Je Sozialraum`, hat die Vorlage keine Sozialräume. Tragen Sie sie in der Vorlage ein.",
      "Fehlt der Knopf `Neue Vorlage`, haben Sie nicht die Rolle Verwaltung. Sie können Berichte trotzdem ansehen und herunterladen.",
      "Steht `Bei einer Schule gibt es Check-ins erst ab …`, hat die Schule für die Tage davor keine Check-ins. Dann zählt moto für diese Tage keine Anwesenheit.",
    ],
    image: "/help/screens/traeger-berichte.webp",
    imageAlt:
      "Die Seite Berichte: oben Stichtag und Vorlage, darunter Kennzahlen und die Tabelle der Kinder je Schule.",
    related: [
      HELP_TOPICS.traegerKeyDateCounts,
      HELP_TOPICS.traegerOccupancy,
      HELP_TOPICS.traegerUtilization,
    ],
  };
}
