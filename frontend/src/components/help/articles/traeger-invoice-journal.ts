import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function traegerInvoiceJournalTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerInvoiceJournal,
    title: "Rechnungsausgangsbuch lesen",
    question: "Wo sehe ich alle ausgestellten Rechnungen in einer Liste?",
    summary:
      "Das Rechnungsausgangsbuch zeigt jedes ausgestellte Dokument aus allen Läufen: Rechnungen, Bescheide, Stornos und Gutschriften. Fehlt in einem Nummernkreis eine Nummer, zeigt moto das als Warnung.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "ListSearch",
    requirements: [
      "Deine Rolle im Träger-Büro ist Abrechnung.",
      "Mindestens ein Lauf ist freigegeben. Ein Dokument steht erst in der Liste, wenn es seine Nummer hat.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Liste öffnen und lesen",
        steps: [
          "Wähle `Abrechnungsläufe` und dann den Reiter `Rechnungsausgangsbuch`.",
          "Pro Dokument steht eine Zeile mit Nummer, Datum, Dokumentart, Empfänger, Lauf und den Beträgen. Das neueste Dokument steht oben.",
          "Neben einem Storno oder einer Gutschrift steht die Nummer der Rechnung, zu der es gehört.",
          "Wähle den Namen in der Spalte `Lauf`. Du kommst zum Lauf mit seinen Schreiben.",
          "Über der Liste stehen die Summen netto, Steuer und brutto. Stornos und Gutschriften sind abgezogen.",
        ],
      },
      {
        title: "Dokumente finden",
        description: "Zahl und Summen folgen immer der Suche und dem Filter.",
        steps: [
          "Tippe in die Suche eine Nummer oder den Namen des Empfängers.",
          "Wähle oben rechts `Zeitraum wählen` für die Dokumente eines Monats oder Jahres.",
          "Wähle das Filter-Symbol neben der Suche. Du filterst nach `Dokumentart`, `Nummernkreis` und `Lauf`.",
          "Stellen mehrere Stellen für deine Schulen Rechnungen aus, filterst du auch nach `Rechnungssteller`.",
        ],
      },
      {
        title: "Lücke im Nummernkreis prüfen",
        description:
          "Ein Nummernkreis zählt je Rechnungssteller, Leistung und Jahr. moto vergibt jede Nummer nur einmal und ohne Lücke.",
        steps: [
          "Fehlt eine Nummer, steht über der Liste eine Warnung. Sie nennt den Nummernkreis und zwischen welchen Dokumenten die Nummern fehlen.",
          "Wähle `Nummernkreis zeigen`. Die Liste zeigt nur die Dokumente dieses Nummernkreises.",
          "Wende dich an das moto-Team und nenne die fehlenden Nummern. Wir klären die Ursache mit dir.",
        ],
      },
      {
        title: "Liste herunterladen",
        steps: [
          "Wähle oben rechts das Menü mit den drei Punkten.",
          "Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`.",
          "Die Datei enthält alle Dokumente zu Suche und Filter, sortiert nach Nummer. Am Ende stehen die Summen.",
          "Die Liste enthält personenbezogene Daten. Jeder Download wird protokolliert.",
        ],
      },
    ],
    result:
      "Du hast alle ausgestellten Dokumente nach Nummer vor dir und siehst, ob ein Nummernkreis vollständig ist.",
    differences: [
      "Die Spalte und der Filter `Rechnungssteller` fehlen: Dein Träger stellt alle Dokumente selbst aus.",
      "Die Nummern springen an einer Stelle, ohne Warnung: Dort hat dein Büro einen Startwert für die Rechnungsnummern gesetzt. Das ist keine Lücke.",
      "Ein Jahresbescheid steht im Nummernkreis der Monatsbeiträge: Beide zählen im selben Nummernkreis.",
    ],
    notes: [
      "Die Steuer ist immer 0,00 €. Elternbeiträge stellt moto ohne Steuer aus.",
      "Ob eine Familie gezahlt hat, steht hier nicht. Zahlungen sieht moto nicht. Prüfe sie in deiner Buchhaltung.",
    ],
    troubleshootingDetails: [
      "Ein Dokument fehlt in der Liste: Der Lauf ist noch nicht freigegeben. Entwürfe haben keine Nummer und stehen nur im Lauf.",
      "Die Liste ist leer: Prüfe Suche, Zeitraum und Filter. Wähle `Filter zurücksetzen`.",
      "Du siehst den Reiter nicht: Dir fehlt die Rolle Abrechnung. Wende dich an die Person, die bei deinem Träger die Mitglieder verwaltet.",
    ],
    related: [
      HELP_TOPICS.traegerBillingRun,
      HELP_TOPICS.traegerCareMonths,
      HELP_TOPICS.traegerCareNotices,
    ],
  };
}
