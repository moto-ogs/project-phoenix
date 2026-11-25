import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/einstellungen` (#4652, ADR 0086, #5685): Träger-Werte zwischen Standard
 * und Schule. Bezeichnungen aus `settings-origin.ts` und `traeger-nav-items.ts`.
 */
export function traegerSettingsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerSettings,
    title: "Einstellungen für alle Schulen festlegen",
    question: "Wie lege ich Einstellungen für alle Schulen fest?",
    summary: "Was du hier festlegst, gilt für alle Schulen deines Trägers.",
    group: "konfiguration",
    audience: "traeger",
    icon: "Settings",
    requirements: ["Du darfst im Träger-Büro Einstellungen ändern."],
    steps: [
      "Wähle unten in der Navigation `Einstellungen`.",
      "Wähle `Allgemein`.",
      "Wähle den Bereich, zum Beispiel `Anmeldung` oder `Betrieb`.",
      "Ändere den Wert. moto speichert die Änderung von selbst.",
    ],
    result:
      "Der Wert gilt sofort für alle Schulen deines Trägers. Auch neue Schulen übernehmen ihn.",
    notes: [
      "Bei deinem Wert steht `Vom Träger festgelegt` und das Datum der letzten Änderung.",
      "`Standard` heißt: Du hast nichts festgelegt. Es gilt der Wert von moto.",
      "`Zurücksetzen` entfernt deinen Wert. Dann gilt wieder der Standard.",
      "Eine Schule kann einen eigenen Wert eintragen. Dann gilt dort ihr Wert.",
      "Den eigenen Wert einer Schule kann nur die Schule selbst zurücksetzen.",
      "Im Bereich `Kontakt` trägst du die `Ansprechperson` deines Trägers ein. Sie steht auf allen Briefen und Rechnungen.",
      "Darunter steht `Kontakt für Widerrufe`. Diese Telefonnummer und E-Mail-Adresse nennt die Widerrufsbelehrung jedes Betreuungsvertrags. Ein leeres Feld nimmt die Angabe der Ansprechperson. Die Vorschau zeigt den Satz so, wie Eltern ihn lesen. Nach einer Änderung kopiert die Schule die Widerrufsbelehrung neu ins Anmeldeformular.",
      "Mit `Zurück zur App` oben in der Navigation kommst du zur zuletzt geöffneten Seite zurück.",
      "Im Bereich `Ferienbetreuung` legst du fest, ob du beim Bestätigen einer Ferienanmeldung die Debitorennummer der Familie abfragst. Diese Einstellung gilt nur im Träger-Büro.",
      "Ebenfalls dort wählst du bei `Debitorennummer zuordnen`, wen eine Nummer meint. `Zahler (Rechnungsempfänger)` heißt: Jeder Empfänger von Rechnungen hat eine Nummer, Geschwister teilen sie. Zahlen die Eltern getrennt, hat jeder Elternteil seine Nummer. `Kind` heißt: Jedes Kind hat eine eigene Nummer. Wenn du umstellst, bleiben alle gespeicherten Nummern erhalten. Ausgestellte Rechnungen behalten ihre Nummer, neue Rechnungen nehmen die Nummer nach der neuen Einstellung.",
      "Hat deine Kasse ein festes Format, schalte dort `Debitorennummer: nur Ziffern` ein. Darunter trägst du bei `Länge` ein, von wie vielen bis wie vielen Ziffern eine Nummer hat. Für genau 5 Ziffern trägst du zweimal 5 ein. Das `Beispiel` zeigt eine passende Nummer.",
      "Das Format gilt für jede Nummer, die du danach einträgst: beim Bestätigen, beim Ändern einer Anmeldung und bei den Familien. Gespeicherte Nummern bleiben, wie sie sind.",
      "Ebenfalls unter `Ferienbetreuung` schreibst du bei `Zahlungstext im Schreiben` einen eigenen Satz, der um die Zahlung bittet. Erlaubte Platzhalter sind {Betrag}, {Zahlungsfrist}, {Rechnungsnummer} und {Debitorennummer}. Darunter zeigt die `Vorschau des Zahlungstexts` den Satz mit Beispielwerten. Ist das Feld leer, steht im Schreiben der eingebaute Satz.",
      "Der eigene Zahlungstext gilt für die Schreiben, die du danach erstellst. Fertige Schreiben bleiben, wie sie sind.",
      "Unter `Ferienbetreuung` legst du bei `Ferienanmeldungen löschen nach (Tagen)` fest, wie lange moto Ferienanmeldungen aufbewahrt. Möglich sind 92 bis 1095 Tage, der Standard ist 365 Tage. Die Frist steht im Einwilligungstext für die Eltern. Eine Änderung gilt nur für Anmeldungen, die danach eingehen.",
      "Unter `Datenschutz` legst du bei `Erziehungsberechtigte ohne Kind aufbewahren (Tage)` fest, wie lange moto Eltern ohne Kind aufbewahrt. Möglich sind 30 bis 365 Tage, der Standard ist 90 Tage. Eine Schule kann einen eigenen Wert eintragen.",
      // #3844: Eltern-Stopp von Raumverlauf und Stimmung, nur Träger-Ebene.
      "Unter `Datenschutz` legst du bei `Eltern dürfen Raumverlauf und Stimmung stoppen` fest, ob Eltern das im Elternportal selbst tun dürfen. Der Standard ist aus. Ist es an, löscht ein Stopp den bisherigen Raumverlauf des Kindes. Eine Schule kann hier keinen eigenen Wert eintragen.",
      "Im Bereich `Dashboard` legst du fest, ab wann das Dashboard eine Schule unter `Auffälligkeiten` zeigt: bei zu wenig Personal, bei vielen Krankmeldungen und bei offenen Anmeldungen. 0 schaltet einen Hinweis aus.",
      "Unter `Ferienbetreuung` legst du bei `Ferienbeitrag` auch fest, welches Kind das erste Kind ist und was ein Kostenträger bezahlt. Mehr dazu steht im Artikel `Ferienbeitrag festlegen`.",
    ],
    differences: [
      "Auf dem Handy öffnest du in der Leiste unten `Mehr` und dann `Einstellungen`. Dort führt `Zurück zur App` wieder zurück.",
      "Du kannst die Werte nur ansehen? Dir fehlt das Recht zum Ändern. Wende dich an das moto-Team.",
    ],
    related: [HELP_TOPICS.traegerLogin, HELP_TOPICS.errorMessages],
  };
}
