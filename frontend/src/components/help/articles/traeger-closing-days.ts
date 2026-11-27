import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/schliesstage` (#4702): Schließtage des Trägers und Feiertage je Bundesland. */
export function traegerClosingDaysTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerClosingDays,
    title: "Schließtage für Schulen planen",
    question: "Wie plane ich einen Brückentag für mehrere Schulen?",
    summary:
      "Ein Schließtag gilt für die Schulen, die du wählst. An diesem Tag hat die OGS geschlossen. Die Feiertage kommen aus dem Bundesland der Schule.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "CalendarSlash",
    requirements: [
      "Sehen kann die Seite jede Rolle im Träger-Büro.",
      "Schließtage anlegen darf deine Rolle, wenn sie Einstellungen verwalten darf. Das gilt für die Rolle Verwaltung.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Schließtag anlegen",
        steps: [
          "Wähle in der Navigation `Schließtage`.",
          "Wähle `Schließtag anlegen`.",
          "Trage den `Grund` ein, zum Beispiel Brückentag.",
          "Trage `Von` und `Bis` ein. Für einen Tag trägst du zweimal dasselbe Datum ein.",
          "Wähle bei `Gilt für` die Schulen. `Alle Schulen` wählt alle auf einmal.",
          "Prüfe unter `Ferienbetreuung an diesen Tagen`, welche gebuchten Ferienwochen betroffen sind.",
          "Wähle `Speichern`. Sind Ferienwochen betroffen, heißt der Knopf `Speichern und Eltern informieren`.",
        ],
      },
      {
        title: "Schließtag ändern oder löschen",
        steps: [
          "Wähle beim Schließtag die drei Punkte.",
          "Wähle `Bearbeiten` oder `Löschen`.",
          "Unter `Ferienbetreuung an diesen Tagen` steht, welche Tage wieder geöffnet sind und wie viele Familien eine E-Mail bekommen.",
          "Wähle `Speichern` oder beim Löschen `Ja, löschen` und dann `Endgültig löschen`. Die Eltern bekommen die E-Mail sofort.",
        ],
      },
      // #8202: geänderte Öffnungszeiten des Trägers für mehrere Schulen.
      {
        title: "Geänderte Öffnungszeit planen",
        description:
          "Für einen Tag, an dem die OGS früher schließt oder später öffnet, zum Beispiel wegen einer Personalversammlung.",
        steps: [
          "Wähle in der Navigation `Schließtage`.",
          "Gehe zum Abschnitt `Geänderte Öffnungszeiten` und wähle `Tag anlegen`.",
          "Trage den `Anlass` ein und `Von` und `Bis`. Für einen Tag trägst du zweimal dasselbe Datum ein.",
          "Trage ein, wann die OGS öffnet und schließt.",
          "Wähle bei `Gilt für` die Schulen und dann `Speichern`.",
          "Zum Ändern oder Löschen wähle beim Tag die drei Punkte.",
        ],
      },
      {
        title: "Eltern zu einem Schließtag der Schule informieren",
        description:
          "Trägt eine Schule selbst einen Schließtag in eine gebuchte Ferienwoche ein, bekommen die Eltern nicht von selbst eine E-Mail. Das gilt auch, wenn die Schule ihn ändert oder löscht. Du oder die Schule löst den Versand aus.",
        steps: [
          "Wähle in der Navigation `Schließtage`.",
          "Oben steht dann die Karte `Eltern noch nicht informiert`. Pro Schließtag stehen dort Schule, Grund, Tage, Kinder und Familien.",
          "Wähle in der Zeile `Eltern informieren`. Ein Klick genügt.",
          "Mehrere Schließtage auf einmal: Wähle oben `Alle Eltern informieren`.",
          "Die Zeile zeigt `Wird gesendet` und dann `Gesendet`.",
        ],
      },
      {
        title: "Schließtage herunterladen",
        description: "Zum Drucken, zum Ablegen oder für eine Tabelle.",
        steps: [
          "Wähle in der Navigation `Schließtage`.",
          "Wähle oben das Jahr.",
          "Öffne oben rechts das Drei-Punkte-Menü. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`.",
          "Die Datei enthält die Schließtage dieses Jahres mit Grund und Schulen.",
        ],
      },
      {
        title: "Feiertage prüfen",
        steps: [
          "Wähle in der Navigation `Schließtage`.",
          "Oben wählst du das Jahr.",
          "Du siehst das letzte Jahr, dieses Jahr und die nächsten drei Jahre.",
          "In der `Jahresübersicht` sind Feiertage blau und Schließtage orange.",
          "Unter `Feiertage nach Bundesland` stehen die Feiertage und die Schulen dazu.",
        ],
      },
    ],
    result:
      "Die gewählten Schulen haben an diesem Tag geschlossen. Ferienwochen mit diesem Tag sind nicht mehr buchbar. Termine fallen aus, und Mitarbeitende haben kein Soll. Eltern mit einer Buchung in der Woche bekommen eine E-Mail mit den geschlossenen Tagen.",
    notes: [
      "Die Schulen sehen den Schließtag in ihrem Kalender mit `Vom Träger`. Ändern kann ihn nur das Träger-Büro.",
      "An einem Tag mit geänderter Öffnungszeit enden die Sitzungen der gewählten Schulen zur neuen Schließzeit. Die Schulen sehen den Tag mit `Vom Träger`. Ändern kann ihn nur das Träger-Büro.",
      // #8231: Hinweis an die gewählten Schulen.
      "Legst du eine geänderte Öffnungszeit an, änderst oder löschst sie, bekommen Team, Eltern und Träger-Büro jeder gewählten Schule einen Hinweis. Du selbst bekommst keinen. Hat eine Schule `Benachrichtigung bei geänderter Öffnungszeit` ausgeschaltet, bekommt dort niemand einen Hinweis.",
      "Der Elternbeitrag ändert sich durch einen Schließtag nicht, auch nicht bei tageweise gebuchten Wochen. Das steht auch in der E-Mail an die Eltern.",
      "Jede Familie bekommt eine E-Mail, auch wenn mehrere Kinder oder Wochen betroffen sind. Speicherst du den Schließtag noch einmal, bekommt niemand eine zweite E-Mail.",
      "Das Bundesland einer Schule legt das moto-Team fest. Stimmt es nicht, schreibe dem moto-Team.",
      "Bisherige Buchungen einer Ferienwoche bleiben, auch wenn du später einen Schließtag in die Woche legst. Niemand verliert seinen Platz, und niemand rückt von der Warteliste nach. Neue Buchungen der Woche sind dann nicht möglich.",
    ],
    differences: [
      "Du siehst keinen Knopf `Schließtag anlegen` oder `Tag anlegen`? Deine Rolle darf keine Einstellungen verwalten. Frage im Träger-Büro nach der Rolle Verwaltung.",
    ],
    troubleshootingDetails: [
      "Beim Speichern steht, die gebuchten Ferientage haben sich geändert? Inzwischen hat jemand gebucht oder storniert. Prüfe die neue Liste im Dialog und speichere noch einmal.",
      "Auch ohne Schulhinweis können E-Mails ausfallen. Die Karte `Eltern noch nicht informiert` zeigt ihre Zahl. Wähle `Erneut senden`. Bereits angenommene E-Mails werden nicht wiederholt.",
      "Eine Zeile zeigt `Nicht angekommen`? Wähle noch einmal `Eltern informieren`. Familien, die schon eine E-Mail haben, bekommen keine zweite.",
      "Eine Zeile zeigt `Ergebnis unbekannt`? Schreibe dem moto-Team. Es prüft den Versand.",
      "Nach dem Klick steht, der Schließtag wurde geändert? Die Schule hat ihn inzwischen geändert. Prüfe die Zeile und wähle noch einmal `Eltern informieren`.",
    ],
    related: [HELP_TOPICS.traegerHolidayPeriod, HELP_TOPICS.traegerSchoolView],
  };
}
