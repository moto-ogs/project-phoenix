import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function traegerInvoiceJournalTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerInvoiceJournal,
    title: "Rechnungsausgangsbuch lesen",
    question: "Wo sehe ich alle ausgestellten Rechnungen in einer Liste?",
    summary:
      "Das Rechnungsausgangsbuch zeigt jedes ausgestellte Dokument aus allen Läufen: Rechnungen, Bescheide, Stornos und Gutschriften. Eine Rechnung zeigt ihren Stand und was sie noch fordert. Fehlt in einem Nummernkreis eine Nummer, zeigt moto das als Warnung.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "ListSearch",
    image: "/help/screens/traeger-rechnungsausgangsbuch.webp",
    imageAlt:
      "Das Rechnungsausgangsbuch: oben Suche und Filter, darunter die Warnung zu fehlenden Nummern, die Summen und die Liste der Dokumente mit Nummer, Datum, Dokumentart und Stand, Empfänger mit Kindern, Lauf, Beträgen und offener Forderung.",
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
          "Pro Dokument steht eine Zeile mit Nummer, Datum der Ausstellung, Dokumentart, Empfänger, Lauf und den Beträgen. Das neueste Dokument steht oben.",
          "Neben der Dokumentart steht bei einer Rechnung ihr Stand, zum Beispiel `Forderung offen`, `Teilgutschrift` oder `Storniert`. Die Spalte `Offene Forderung` nennt, was die Rechnung noch fordert.",
          "Unter dem Empfänger stehen die Vornamen der Kinder. Wähle den Namen des Empfängers. Du kommst zur Familie mit all ihren Dokumenten.",
          "Neben einem Storno oder einer Gutschrift steht die Nummer der Rechnung, zu der es gehört. Wähle diese Nummer. moto sucht sie in allen Dokumenten und leert dabei die anderen Filter.",
          "Wähle den Namen in der Spalte `Lauf`. Du kommst zum Lauf mit seinen Schreiben.",
          "Über der Liste stehen die Zahl der Dokumente und die Summen netto, Steuer und brutto. Stornos und Gutschriften sind abgezogen. Daneben steht die Summe der offenen Forderungen.",
          "Wähle einen Spaltenkopf, zum Beispiel `Brutto` oder `Offene Forderung`. moto sortiert alle Dokumente zu Suche und Filter, nicht nur die geladenen Zeilen. Wähle ihn noch einmal für die andere Richtung.",
        ],
      },
      {
        title: "Dokumente finden",
        description: "Zahl und Summen folgen immer der Suche und dem Filter.",
        steps: [
          "Tippe in die Suche eine Nummer, den Namen des Empfängers, den Vornamen eines Kindes oder eine Debitorennummer.",
          "Wähle neben der Suche `Zeitraum wählen` für die Dokumente eines Monats oder Jahres.",
          "Daneben filterst du nach Dokumentart, Stand, Nummernkreis und Lauf. Auf dem Handy wählst du dafür das Filter-Symbol.",
          "Mit dem Filter `Stand` und `Forderung offen` siehst du alle Rechnungen, die noch ihren ganzen Betrag fordern.",
          "Jeder Filter steht als Marke unter der Suche. Mit dem Kreuz an der Marke nimmst du ihn wieder weg.",
          "Stellen mehrere Stellen für deine Schulen Rechnungen aus, filterst du auch nach `Rechnungssteller`.",
        ],
      },
      {
        title: "Lücke im Nummernkreis prüfen",
        description:
          "Ein Nummernkreis zählt je Rechnungssteller, Leistung und Jahr. moto vergibt jede Nummer nur einmal und ohne Lücke.",
        steps: [
          "Fehlt eine Nummer, steht über der Liste eine Warnung. Sie nennt den Nummernkreis und die Nummern, die fehlen.",
          "In der Liste steht die Warnung auch am Dokument neben der Lücke, zum Beispiel `Lücke: 2 Nummern`.",
          "Wähle `Nur diesen Nummernkreis zeigen`. Die Liste zeigt nur diesen Nummernkreis, nach Nummer sortiert. Suche und andere Filter leert moto dabei.",
          "Wende dich an das moto-Team und nenne die Nummern. Wir klären die Ursache mit dir.",
        ],
      },
      {
        title: "Liste herunterladen",
        steps: [
          "Wähle oben rechts das Menü mit den drei Punkten.",
          "Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`.",
          "Die Datei enthält alle Dokumente zu Suche und Filter, aufsteigend nach Nummer, auch wenn du die Liste anders sortiert hast. Sie nennt zusätzlich Stand, Kinder, Debitorennummer und offene Forderung. Am Ende stehen die Summen. Das Menü nennt vorher, wie viele Dokumente es sind.",
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
      "Ob eine Familie gezahlt hat, steht hier nicht. `Forderung offen` heißt nur: Die Rechnung ist ausgestellt und weder storniert noch ganz gutgeschrieben. Zahlungen prüfst du in deiner Buchhaltung.",
      "Ein Storno, eine Gutschrift und ein Jahresbescheid haben keinen Stand. In der Spalte `Offene Forderung` steht dort ein Strich. Jahresbescheide zählen in der Summe der offenen Forderungen nicht mit.",
    ],
    troubleshootingDetails: [
      "Ein Dokument fehlt in der Liste: Der Lauf ist noch nicht freigegeben. Entwürfe haben keine Nummer und stehen nur im Lauf.",
      "Die Liste zeigt `Kein Dokument passt …`: Prüfe Suche, Zeitraum und Filter. Wähle `Filter zurücksetzen`.",
      "Du siehst den Reiter nicht: Dir fehlt die Rolle Abrechnung. Wende dich an die Person, die bei deinem Träger die Mitglieder verwaltet.",
    ],
    related: [
      HELP_TOPICS.traegerBillingRun,
      HELP_TOPICS.traegerCareMonths,
      HELP_TOPICS.traegerCareNotices,
    ],
  };
}
