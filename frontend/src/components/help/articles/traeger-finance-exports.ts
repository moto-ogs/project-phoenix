import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function traegerFinanceExportsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerFinanceExports,
    title: "Sollstellung für die Kämmerei",
    question: "Wie gebe ich die Rechnungen an die Kämmerei?",
    summary:
      "Für jeden ausgestellten Lauf lädst du eine Sollstellung herunter. Das ist eine CSV-Datei mit einer Zeile pro Rechnung. Welche Spalten sie hat, legst du selbst fest. Jede Datei bekommt eine laufende Nummer.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "Table",
    requirements: [
      "Deine Rolle im Träger-Büro ist Abrechnung.",
      "Der Monatslauf oder Ferienlauf ist ausgestellt.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Spalten festlegen",
        description:
          "Frage deine Kämmerei, welche Spalten ihr Programm liest. Das machst du nur einmal.",
        steps: [
          "Wähle `Abrechnung`, dann den Reiter `Exporte`.",
          "Wähle oben rechts das Menü mit den drei Punkten und dann `Feldzuordnung`.",
          "Wähle bei jeder Spalte den `Inhalt` und trage den `Spaltennamen` ein.",
          "Mit `Spalte` fügst du eine Spalte hinzu. Für einen Wert, der in jeder Zeile gleich ist, wähle `Fester Wert`, etwa ein Konto.",
          "Für einen Text pro Rechnung wähle `Buchungstext`. Schreibe feste Wörter selbst und füge Platzhalter wie `{Monat}` und `{Kind}` mit einem Klick ein. Aus `SKB {Monat} {Kind}` wird etwa `SKB 10/2026 Lia Müller`.",
          "Will deine Buchhaltung Stornos und Gutschriften in einer eigenen Spalte? Dann wähle `Gutschrift`. Dort steht der Betrag ohne Minus. Die Spalte `Betrag` bleibt bei ihnen leer.",
          "Lege unter `Datei` Trennzeichen, Beträge, Datum, Zeichensatz und Dateinamen fest. `{NR}` im Dateinamen wird zur Dateinummer.",
          "Prüfe die `Vorschau` und wähle `Speichern`.",
        ],
      },
      {
        title: "Erste Dateinummer festlegen",
        description:
          "Nur nötig, wenn die Nummern deines bisherigen Programms weiterlaufen sollen.",
        steps: [
          "Trage in der Karte `Dateinummern` bei `Erste Nummer` die Nummer nach deiner letzten Datei ein.",
          "Wähle `Festlegen` und dann `Ja, festlegen`.",
        ],
      },
      {
        title: "Sollstellung herunterladen",
        steps: [
          "Wähle `Abrechnung`, dann den Reiter `Exporte`.",
          "Wähle beim Lauf das Menü mit den drei Punkten und unter `Herunterladen` `Sollstellung`. Die Datei wird heruntergeladen.",
          "Gib die Datei an deine Kämmerei. Oder lass moto sie übergeben, siehe „Exporte an Empfänger übergeben“.",
        ],
      },
      {
        title: "Läufe und Exportprotokoll herunterladen",
        steps: [
          "Wähle `Familien und Zahlung` und dann den Reiter `Exporte`.",
          "Wähle bei `Dateien pro Lauf` oder `Exportprotokoll` den Knopf `Herunterladen` und dann `PDF`, `Excel` oder `CSV`.",
        ],
      },
    ],
    result:
      "Die Datei steht im `Exportprotokoll` mit Nummer, Datum und wer sie geholt hat. Beim Lauf steht die letzte Sollstellung. In jeder Monatsrechnung zeigt `Verlauf`, in welchen Dateien sie war.",
    notes: [
      "Jeder Download ist eine neue Datei mit neuer Nummer. Steht im Protokoll `Gleicher Inhalt wie Nr. …`, enthält die Datei nichts Neues.",
      "Auch jede Lastschriftdatei und jede DATEV-Datei bekommt eine Nummer aus derselben Reihe. So nennt jede Nummer genau eine Datei.",
      "Für dein Steuerbüro gibt es im Menü des Laufs auch `DATEV-Datei`. Wie das geht, steht unter „DATEV-Werte eintragen“.",
      "Die Debitorennummer der Familie trägst du bei `Empfänger und Zahlung` der Familie ein. Neue Monats- und Ferienrechnungen übernehmen sie. Hat eine Ferienanmeldung eine eigene Nummer, gilt bei der Ferienrechnung diese. Beim Import der Mandate übernimmt moto die Spalte `Debitorennummer`.",
      "Eine neue Feldzuordnung gilt für jede neue Datei. Frühere Dateien bleiben, wie sie waren.",
      "Wählst du als Inhalt `Erlöskonto`, `Kostenstelle (KOST1)` oder `Zweite Kostenstelle (KOST2)`, hat die Datei eine Zeile pro Konto einer Rechnung. Der `Betrag` ist dann der Teil der Rechnung auf diesem Konto. Die Konten legst du unter `Konten und Kostenstellen` fest.",
    ],
    differences: [
      "Der Reiter `Exporte` fehlt? Dir fehlt das Recht `Finanz-Export`.",
      "Ein älterer Lauf oder eine ältere Datei fehlt? Die Listen zeigen zuerst die neuesten 50. Wähle unter der Liste `Ältere anzeigen`.",
      "Die Karte `Dateinummern` zeigt kein Feld? Die Nummern laufen schon. Die erste Nummer lässt sich nicht mehr ändern.",
    ],
    troubleshootingDetails: [
      "Die Kämmerei sieht falsche Umlaute? Wähle bei `Zeichensatz` den Wert `Windows-1252`.",
      "In der Datei stehen alle Werte in einer Spalte? Das Trennzeichen passt nicht zum Programm der Kämmerei. Wähle ein anderes.",
      "Beim Import einer Datei zeigt eine Zeile `Geschwister haben verschiedene Nummern`? moto führt eine Nummer pro Familie. Trage die richtige Nummer bei der Familie ein.",
    ],
    related: [
      HELP_TOPICS.traegerExportHandover,
      HELP_TOPICS.traegerDatevExport,
      HELP_TOPICS.traegerCareMonths,
      HELP_TOPICS.traegerSepaDebitFile,
      HELP_TOPICS.traegerBillingTerms,
    ],
  };
}
