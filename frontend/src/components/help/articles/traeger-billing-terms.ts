import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function traegerBillingTermsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerBillingTerms,
    title: "Zahlung und Empfänger der Rechnungen",
    question: "Wie lege ich fest, wie und bis wann Familien zahlen?",
    summary:
      "Je Leistung legst du den Zahlungsweg und das Zahlungsziel fest. Das Mittagessen steht auf der Rechnung der Betreuung oder auf einer eigenen Rechnung. Für eine einzelne Familie legst du einen anderen Empfänger, einen eigenen Zahlungsweg oder einen eigenen Zahltag fest.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "Users",
    requirements: ["Deine Rolle im Träger-Büro ist Abrechnung."],
    steps: [],
    instructionGroups: [
      {
        title: "Zahlung je Leistung festlegen",
        description:
          "Ohne deine Wahl zahlen alle Familien per Überweisung, innerhalb von 14 Tagen.",
        steps: [
          "Wähle unten in der Navigation `Einstellungen` und dann `Abrechnungsvorgaben`.",
          "In der Karte `Zahlung und Rechnungen` steht je Leistung eine Zeile: `Monatsbeitrag Betreuung`, `Mittagessen` und `Ferienbetreuung`.",
          "Wähle die Zeile der Leistung. Oder wähle das Menü mit den drei Punkten und dann `Ändern`.",
          "Wähle den `Zahlungsweg`: `Überweisung` oder `Lastschrift`.",
          "Trage das `Zahlungsziel in Tagen` ein. Das sind die Tage nach dem Rechnungsdatum.",
          "Beim Mittagessen wählst du bei `Rechnung`: `Auf der Rechnung der Betreuung` oder `Eigene Rechnung`.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Fälligkeit eines Laufs festlegen",
        description:
          "Ein Lauf kann ein festes Datum haben, bis zu dem alle Familien zahlen. Das geht nur vor der Freigabe.",
        steps: [
          "Öffne den Lauf unter `Abrechnungsläufe`, im Reiter `Monatsbeiträge` oder `Ferien`.",
          "Beim Monatslauf wählst du in der Karte `Monatslauf` beim Feld `Fällig` den Knopf `Ändern`. Beim Ferienlauf wählst du `Fälligkeiten ändern`. Es öffnet sich eine eigene Seite.",
          "Wähle je Zahlungsweg ein Datum. Ohne Datum gilt das Zahlungsziel der Leistung.",
          "Wähle `Speichern`. Du kommst zurück zum Lauf. Bei `Fällig` steht jetzt das Datum.",
        ],
      },
      {
        title: "Empfänger und Zahlung einer Familie ändern",
        description:
          "Das gilt für alle Rechnungen dieser Familie, auch für Geschwister. Die Familie ist die E-Mail-Adresse der Person im Vertrag.",
        steps: [
          "Öffne einen Monatslauf unter `Abrechnungsläufe` und `Monatsbeiträge`.",
          "Wähle bei der Rechnung des Kindes das Menü mit den drei Punkten und dann `Empfänger und Zahlung`. Es öffnet sich eine eigene Seite.",
          "Wähle bei `Rechnung an`: `Person im Vertrag`, `Beide Eltern` oder `Andere Person`.",
          "Bei `Beide Eltern` trägst du den Namen des zweiten Elternteils ein. Beide Namen stehen dann auf der Rechnung.",
          "Bei `Andere Person` trägst du Name, E-Mail-Adresse und Anschrift ein. Die Rechnung geht dann an diese Person.",
          "Wähle bei Bedarf einen eigenen `Zahlungsweg`. `Wie in den Abrechnungsvorgaben` nimmt den dort eingestellten Zahlungsweg.",
          "Wähle bei Bedarf einen `Eigenen Zahltag`, zum Beispiel den 15. des Monats.",
          "Wähle `Speichern`.",
        ],
      },
    ],
    result:
      "Jede Rechnung zeigt den Zahlungsweg und das Datum, an dem sie fällig ist. Steht dahinter `Zahltag der Familie`, kommt das Datum von der Familie. Rechnungen an beide Eltern oder an eine andere Person tragen das Zeichen `Beide Eltern` oder `Abweichender Zahler`.",
    notes: [
      "Die Ferienbetreuung hat immer eine eigene Rechnung. Sie steht nie auf der Rechnung der Betreuung.",
      "Bei `Lastschrift` buchst du den Betrag selbst ab. Dafür braucht die Familie ein SEPA-Mandat bei dir, und du brauchst eine Gläubiger-ID. Ohne Mandat geht die Rechnung als Überweisung. moto bucht kein Geld ab.",
      "Bei `Überweisung` steht auf jedem Schreiben eines Abrechnungslaufs ein QR-Code: auf Rechnung, Gebührenbescheid und Bestätigungsschreiben. Die Familie scannt ihn mit der Banking-App. Empfänger, IBAN, Betrag und Verwendungszweck sind dann schon ausgefüllt.",
      "Den QR-Code schaltest du unter `Briefkopf und Vorlagen` bei `GiroCode drucken` aus. Dann steht er auf keinem neuen Schreiben.",
      "Der Verwendungszweck im QR-Code ist die Nummer der Rechnung. Hat die Familie eine Debitorennummer, steht sie dahinter. Bei einem Bescheid heißt sie Buchungszeichen.",
      "Keinen QR-Code haben: Schreiben mit `Lastschrift`, Schreiben mit 0 €, Storno, Gutschrift und Jahresbescheide. Ein Jahresbescheid wird in Raten bezahlt.",
      "Unter `Familien und Zahlung` siehst du bei jeder Familie den Zahlungsweg ihrer Rechnungen.",
      "Beim Erstellen der Schreiben stehen die Fälligkeiten bereits fest. Das Feld `Zahlen bis` gilt nur für ältere Rechnungen ohne eigenes Datum.",
      "Welches Datum gilt: zuerst der eigene Zahltag der Familie, dann das Datum des Laufs, sonst das Zahlungsziel der Leistung.",
    ],
    differences: [
      "Eine Rechnung zeigt keinen Zahlungsweg? Sie wurde ausgestellt, bevor es diese Angaben gab.",
      "Bei einem freigegebenen Lauf fehlt `Ändern` beim Feld `Fällig`? Ausgestellte Rechnungen ändern sich nicht mehr.",
      "Änderst du eine Fälligkeit, nachdem du die Prüfliste geprüft hast, lehnt moto die Freigabe ab. Lade die Seite neu und prüfe den Lauf noch einmal.",
    ],
    troubleshootingDetails: [
      "Änderungen erscheinen nicht auf einer Rechnung? Ausgestellte Rechnungen bleiben, wie sie sind. Die Änderung gilt ab dem nächsten Lauf. Eine falsche Rechnung stornierst du und stellst sie neu aus.",
      "`Empfänger und Zahlung` lässt sich nicht speichern, weil eine E-Mail-Adresse fehlt? Im Vertrag steht keine E-Mail-Adresse. Trage sie im Vertrag ein.",
    ],
    related: [
      HELP_TOPICS.traegerSepaMandates,
      HELP_TOPICS.traegerCareMonths,
      HELP_TOPICS.traegerBillingRun,
      HELP_TOPICS.traegerBriefkopf,
    ],
  };
}
