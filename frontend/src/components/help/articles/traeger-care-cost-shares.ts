import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function traegerCareCostSharesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerCareCostShares,
    title: "Kostenträger im Monatsbeitrag",
    question:
      "Wie trage ich ein, dass Bildung und Teilhabe oder das Jugendamt mitzahlt?",
    summary:
      "Du trägst je Kind ein, wer wie viel vom Monatsbeitrag übernimmt. Die Familie bekommt nur den Rest in Rechnung. Den Teil des Kostenträgers lädst du als eigene Liste herunter.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "HandCoins",
    requirements: [
      "Deine Rolle im Träger-Büro ist Abrechnung.",
      "Der Kostenträger steht unter `Einstellungen` und `Abrechnungsvorgaben`.",
      "Du hast den Bescheid geprüft.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Anteil eintragen",
        steps: [
          "Wähle `Familien und Zahlung` und dann den Reiter `Kostenübernahmen`.",
          "Wähle beim Kind das Menü und dann `Anteil eintragen`.",
          "Wähle bei `Wer zahlt mit?` die Art: `Bildung und Teilhabe`, `Jugendamt` oder `Sonstiger Zuschuss`.",
          "Wähle den `Kostenträger`.",
          "Wähle bei `Wofür zahlt er?`: `Betreuung`, `Mensa` oder `Betreuung und Mensa`. Bei Bildung und Teilhabe ist `Mensa` schon gewählt.",
          "Wähle `Prozent vom Beitrag` oder `Fester Betrag im Monat`. Trage die Zahl ein.",
          "Trage bei `Bescheid` nur das Aktenzeichen oder das Datum ein.",
          "Wähle, ab wann und bis wann der Bescheid gilt.",
          "Wähle `Anteil speichern`.",
        ],
      },
      {
        title: "Bevor ein Bescheid endet",
        description:
          "30 Tage vor dem Ende zeigt die Seite einen Hinweis. Der Anteil bekommt den Vermerk `Endet am`.",
        steps: [
          "Wähle im Hinweis `Nur diese zeigen`.",
          "Frage bei der Familie den neuen Bescheid an.",
          "Wähle beim Kind `Anteil eintragen` und trage den neuen Zeitraum ein.",
        ],
      },
      {
        title: "Liste für den Kostenträger",
        description:
          "Im Monatslauf zeigt die Karte `Kostenträger`, wie viel jede Stelle übernimmt.",
        steps: [
          "Öffne den Monatslauf unter `Monatsbeiträge`.",
          "Wähle in der Karte `Kostenträger` das Menü der Zeile.",
          "Wähle PDF, Excel oder CSV.",
          "Schicke die Liste an den Kostenträger.",
        ],
      },
      {
        title: "Alle Anteile herunterladen",
        steps: [
          "Wähle `Familien und Zahlung` und dann den Reiter `Kostenübernahmen`.",
          "Wähle `Herunterladen` und dann `PDF`, `Excel` oder `CSV`. Die Datei enthält alle Kinder, ohne Suche und Filter.",
          "Die Datei enthält personenbezogene Daten. Jeder Download wird protokolliert.",
        ],
      },
    ],
    result:
      "Der Monatslauf rechnet erst alle Ermäßigungen aus. Danach zieht er den Anteil des Kostenträgers ab. Die Rechnung zeigt den Monatsbeitrag, den Anteil und den Rest. Ein Anteil für die Mensa zieht vom Mensa-Betrag ab. Übernimmt der Kostenträger alles, steht auf der Rechnung `Beitragsfrei` und 0 €.",
    differences: [
      "Gilt ein Bescheid erst ab Mitte des Monats, zählt er für den ganzen Monat.",
      "Ein fester Betrag für `Betreuung und Mensa` geht erst an die Betreuung. Was übrig bleibt, geht an die Mensa.",
      "Kommt die Mensa auf eine eigene Rechnung, steht der Anteil für die Mensa auf der Mensa-Rechnung.",
      "Vor der Freigabe ist die Liste eine Vorschau ohne Rechnungsnummern.",
      "Eine Rechnung, die schon ausgestellt ist, bleibt, wie sie ist. Ein geänderter Anteil gilt ab dem nächsten Monatslauf.",
      "Ein stornierter Beitrag steht in der Liste, zählt aber nicht zur Summe.",
    ],
    notes: [
      "moto speichert nur Art, Anteil, Zeitraum und Aktenzeichen. Den Bescheid behaltest du.",
      "Jedes Öffnen des Reiters `Kostenübernahmen` steht im Zugriffsprotokoll.",
    ],
    related: [
      HELP_TOPICS.traegerCareReductions,
      HELP_TOPICS.traegerCareMonths,
      HELP_TOPICS.traegerAccessLog,
    ],
  };
}
