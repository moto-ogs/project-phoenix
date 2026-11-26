import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/einstellungen/abrechnung` (#4664, #5627, #5685): Regeln des Ferienbeitrags und Kostenträger. */
export function traegerHolidayContributionTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerHolidayContribution,
    title: "Ferienbeitrag festlegen",
    question: "Wie rechnet moto den Ferienbeitrag?",
    summary:
      "Jede gebuchte Woche kostet den Preis ihres Zeitmodells. Geschwister zahlen weniger. Bei Leistungsbezug zahlt die Familie nichts.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "Landmark",
    requirements: [
      "Deine Rolle im Träger-Büro ist Abrechnung. Nur diese Rolle sieht unter `Abrechnungsvorgaben` die Ermäßigungen.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Preis festlegen",
        steps: [
          "Den Preis jeder Woche legst du im Ferienzeitraum fest. Jedes Zeitmodell hat einen `Preis in Euro`.",
          "Wird eine Woche tageweise gebucht, ist es ein `Preis pro Tag in Euro`. Der Beitrag ist dann der Tagespreis mal die gebuchten Tage. Danach rechnet moto Geschwister und Befreiung wie bei ganzen Wochen.",
        ],
      },
      {
        title: "Geschwisterregel anlegen",
        steps: [
          "Wähle unten in der Navigation `Einstellungen`.",
          "Wähle `Abrechnungsvorgaben`.",
          "Wähle bei `Geschwister` den Knopf `Geschwisterregel anlegen`.",
          "Trage ein, ab wann die Regel gilt. `Gilt bis` kannst du frei lassen.",
          "Wähle `ab dem 2. Kind` oder `ab dem 3. Kind`.",
          "Wähle `Anteil in Prozent` oder `Betrag in Euro` und trage den Wert ein. Zum Beispiel 50 für die Hälfte.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Befreiungsregel anlegen",
        description:
          "Die Regel gilt für alle Familien mit Leistungsbezug. Du legst damit keine einzelne Familie an. Welche Familie befreit ist, wählst du beim Bestätigen der Anmeldung.",
        steps: [
          "Wähle bei `Befreiung bei Leistungsbezug` den Knopf `Befreiungsregel anlegen`.",
          "Trage ein, ab wann die Regel gilt. `Gilt bis` kannst du frei lassen.",
          "Schreibe den `Vermerk auf dem Beitrag`. Er steht bei jeder befreiten Familie.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Einstellen, welches Kind das erste Kind ist",
        description:
          "Das erste Kind zahlt den vollen Preis. Für die anderen Kinder gilt die Ermäßigung.",
        steps: [
          "Wähle unten in der Navigation `Einstellungen`.",
          "Wähle `Allgemein` und dann den Bereich `Ferienbetreuung`.",
          "Wähle bei `Welches Kind ist das erste Kind?`: `Das Kind mit dem höchsten Beitrag` oder `Das älteste Kind`.",
        ],
      },
      {
        title: "Einstellen, was ein Kostenträger bezahlt",
        steps: [
          "Wähle unten in der Navigation `Einstellungen`.",
          "Wähle `Allgemein` und dann den Bereich `Ferienbetreuung`.",
          "Wähle bei `Was bezahlt ein Kostenträger?`: `Betrag nach der Ermäßigung` oder `Vollen Preis`. Beim vollen Preis gilt die Ermäßigung nur für die anderen Kinder.",
        ],
      },
      {
        title: "Kostenträger anlegen",
        description:
          "Ein Kostenträger bezahlt den Beitrag für eine Familie, zum Beispiel das Jugendamt bei Leistungsbezug. Du forderst den Betrag dann beim Kostenträger an.",
        steps: [
          "Wähle bei `Kostenträger` den Knopf `Kostenträger hinzufügen`.",
          "Trage den `Name` ein. `Anschrift` und `Dein Aktenzeichen beim Kostenträger` sind freiwillig.",
          "Wähle `Speichern`.",
          "Angaben eines Kostenträgers änderst du im Menü der Zeile mit `Bearbeiten`.",
          "Gibt es den Kostenträger nicht mehr, wähle im Menü der Zeile `Ausschalten`. Beim Bestätigen steht er dann nicht mehr zur Wahl.",
        ],
      },
    ],
    result:
      "Eltern sehen den Preis jedes Zeitmodells schon bei der Wahl der Wochen. Den Beitrag sehen sie vor dem Absenden der Ferienanmeldung. Beim Bestätigen hält moto den Beitrag fest.",
    notes: [
      "Geschwister sind Kinder derselben Ferienanmeldung oder von Anmeldungen, die das Träger-Büro als Geschwister zusammengeführt hat. Das erste Kind zahlt voll. Am Anfang ist das das Kind mit dem höchsten Preis. Du kannst auch das älteste Kind wählen.",
      "Haben zwei Kinder denselben Rang, zählt die früher eingegangene Anmeldung. Danach zählt die Reihenfolge im Formular.",
      "Eine geänderte Einstellung gilt nur für Anmeldungen, die danach bestätigt werden. Ist von Geschwistern schon eine Anmeldung bestätigt, rechnen alle diese Geschwister weiter wie bisher.",
      "Es gelten die Regeln vom ersten gebuchten Tag der Anmeldung.",
      "Hat ein Kind Mittagessen gebucht, steht es als eigene Zeile `Mittagessen` im Beitrag. Die Zeile nennt die Zahl der Essen und den Preis für ein Essen. Geschwisterermäßigung, Befreiung und Kostenübernahme gelten nur für die Betreuung. Das Essen zahlt die Familie voll.",
      "Eine Regel gilt nur für Anmeldungen, die nach der Änderung bestätigt werden. Bestätigte Anmeldungen behalten ihren Beitrag.",
      "Ob eine Familie befreit ist oder ein Kostenträger bezahlt, entscheidet das Träger-Büro beim Bestätigen. Für die Befreiung wählt es dort `Von der Zahlung befreien (Leistungsbezug)`. Diese Wahl gibt es nur, wenn eine Befreiungsregel gilt. Es zählt der erste gebuchte Tag.",
      "Kommt der Bescheid erst nach dem Bestätigen, ändert das Träger-Büro den Zahler in der Anmeldung mit `Zahler ändern`. Die Grundpreise bleiben, wie sie festgehalten sind.",
      "Befreiung heißt: Niemand bezahlt. Bei einem Kostenträger bezahlt die Familie nichts, aber der Kostenträger bezahlt den Betrag. Am Anfang ist das der Betrag nach der Geschwisterermäßigung. Du kannst auch den vollen Preis wählen.",
      "Bezahlt der Kostenträger den vollen Preis, zählt sein Kind weiter als Geschwisterkind. Die anderen Kinder behalten ihre Ermäßigung.",
      "Einen Kostenträger, der schon gewählt wurde, kannst du nur ausschalten, nicht löschen. Änderst du seinen Namen, behalten bestätigte Beiträge und Rechnungen den alten Namen.",
    ],
    differences: [
      "Du siehst unter `Abrechnungsvorgaben` keine Ermäßigungen? Deine Rolle ist nicht Abrechnung. Frage im Träger-Büro nach dieser Rolle.",
    ],
    troubleshootingDetails: [
      "Die Regel lässt sich nicht speichern, weil schon eine andere gilt? Von jeder Art gilt an einem Tag nur eine Regel. Setze bei der alten Regel `Gilt bis` auf den Tag davor.",
    ],
    related: [
      HELP_TOPICS.traegerBriefkopf,
      HELP_TOPICS.traegerHolidayPeriod,
      HELP_TOPICS.traegerHolidayRegistrationReview,
      HELP_TOPICS.traegerBillingRun,
    ],
  };
}
