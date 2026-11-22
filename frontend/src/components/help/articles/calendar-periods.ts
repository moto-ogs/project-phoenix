import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/calendar-periods` heisst in Seitenleiste und Kopfzeile `Schuljahr und
 * Kalender` (#4778).
 */
export function calendarPeriodsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadCalendarPeriods,
    title: "Schuljahr, Ferien und Schließtage eintragen",
    question: "Wo trage ich Schuljahr, Ferien und Schließtage ein?",
    summary: "moto plant nur an Tagen, an denen deine OGS geöffnet hat.",
    group: "planung",
    audience: "lead",
    icon: "CalendarDays",
    steps: [],
    instructionGroups: [
      {
        title: "Zeitraum oder Schließtag?",
        steps: [
          "Ein Zeitraum der Art `Ferien`, etwa die Herbstferien, markiert nur die Ferienzeit. Termine und Sollstunden bleiben.",
          "Hat die OGS zu, lege einen Schließtag an. Dann fallen Termine aus, und niemand hat Sollstunden.",
          "Arbeitet jemand trotzdem, etwa in der Ferienbetreuung? Trage für die Person eine Sonderarbeitszeit ein.",
        ],
        ordered: false,
      },
      {
        title: "Einen Zeitraum anlegen",
        steps: [
          "Klappe in der Seitenleiste `Planung` auf.",
          "Öffne `Schuljahr und Kalender`.",
          "Wähle `Halbjahr anlegen` oder `Zeitraum anlegen`.",
          "Trage `Bezeichnung`, `Art`, `Startdatum` und `Enddatum` ein. Für Ferien wähle die Art `Ferien`.",
          "Wähle `Anlegen`.",
        ],
      },
      {
        title: "Einen Schließtag eintragen",
        steps: [
          "Öffne `Schuljahr und Kalender`.",
          "Gehe zum Abschnitt `Schließtage`.",
          "Wähle `Schließtag anlegen`.",
          "Trage `Grund`, `Von` und `Bis` ein, zum Beispiel `Herbstferien`.",
          "Richtet deine OGS in dieser Zeit Ferienbetreuung für den Träger aus, zeigt der Dialog die Woche und wie viele Kinder gebucht haben. Die Buchungen bleiben.",
          "Wähle `Speichern`.",
          "Stehen an diesen Tagen schon Termine, fragt moto nach. Sage sie ab wie im nächsten Abschnitt.",
          // „Heute anders“ (#7664) zeigt den Schließtag mit seinem Grund.
          "Am Schließtag steht auf der `Startseite` unter `Heute anders`, dass die OGS geschlossen ist. Dort steht auch der `Grund`.",
        ],
      },
      {
        title: "Eltern der Ferienbetreuung informieren",
        description:
          "Liegt ein Schließtag in einer gebuchten Ferienwoche, bekommen die Eltern nicht von selbst eine E-Mail. Das gilt auch, wenn du den Schließtag änderst, verschiebst oder löschst. Den Versand löst du oder das Träger-Büro aus.",
        steps: [
          "Öffne `Schuljahr und Kalender`.",
          "Oben steht die Karte `Eltern der Ferienbetreuung informieren`. Dort stehen der Grund, die Tage und wie viele Familien gebucht haben.",
          "Wähle `Eltern informieren`. Ein Klick genügt.",
          "Der Hinweis zeigt den Versandstand: `Wird gesendet`, `Gesendet` oder `Keine E-Mail nötig`.",
        ],
      },
      {
        title: "Die gesetzlichen Feiertage prüfen",
        description:
          "moto richtet die Feiertage nach dem Bundesland deiner Schule. Du musst sie nicht eintragen.",
        steps: [
          "Öffne `Schuljahr und Kalender`.",
          "Gehe zum Abschnitt `Gesetzliche Feiertage`.",
          "Prüfe das Bundesland im Text über der Liste.",
          "Stimmt das Bundesland nicht? Ändere es in den `Einstellungen` unter `Betrieb`.",
        ],
      },
      {
        title: "Die Schulferien sehen",
        description:
          "moto holt die Schulferien deines Bundeslands jeden Tag aus dem öffentlichen Ferienkalender OpenHolidays. Ferien sind keine Schließtage.",
        steps: [
          "Öffne `Schuljahr und Kalender`.",
          "Gehe zum Abschnitt `Schulferien`.",
          "Die Liste ist nur zur Information. Ob die OGS in den Ferien schließt, trage als Schließtag ein.",
        ],
      },
      {
        title: "Regeltermine in den Ferien prüfen",
        description:
          "Stehen in den Schulferien der nächsten acht Wochen Regeltermine im Plan, zeigt moto den Hinweis `Termine in den Ferien prüfen`. Du siehst ihn im Betreuungsplan, auf `Schuljahr und Kalender` und auf der Startseite.",
        steps: [
          "Lies, welche Ferien es sind und wie viele Regeltermine geplant sind.",
          "Hat die OGS zu? Wähle `Schließtage eintragen` und lege die Schließtage an.",
          "Sollen die Termine ausfallen? Wähle `Termine absagen`. moto schlägt die Ferien als Zeitraum vor.",
          "Findet in den Ferien Betreuung statt? Wähle `Betreuung ist geplant`. Der Hinweis verschwindet für diese Ferien, für alle in deiner OGS.",
        ],
        ordered: false,
      },
      {
        title: "Termine an Schließtagen absagen",
        description:
          "Für Termine, die schon vor dem Schließtag geplant waren. Das geht auch bei Schließtagen mit `Vom Träger`.",
        steps: [
          "Wähle beim Schließtag die drei Punkte.",
          "Wähle `Termine absagen`.",
          "Prüfe den `Zeitraum`. Du kannst ihn kürzen, etwa auf die erste Ferienwoche.",
          "Serien für die Ferienbetreuung bleiben im Plan. Sollen sie auch ausfallen, setze das Häkchen bei `Auch diese Serien absagen`.",
          "Wähle `Termine absagen` und dann `Endgültig absagen`.",
        ],
      },
    ],
    result:
      "Im Betreuungsplan plant moto an Schließtagen und gesetzlichen Feiertagen keine Termine. Abgesagte Termine verschwinden aus dem Plan. Eltern bekommen keine Nachricht.",
    notes: [
      "Ein Zeitraum, den noch nichts benutzt, trägt `Nicht verwendet`.",
      // #6845: Schichtserien halten ihren Zeitraum fest.
      "Einen Zeitraum mit Schichtserien im Dienstplan kannst du nicht löschen, auch wenn die Serien beendet sind. Nimm stattdessen den Haken bei `Zeitraum im Plan verwenden` heraus.",
      "Ferienbetreuung an Schließtagen: Wähle beim Speichern der Serie `Auch an Schließtagen planen`. Trage bei `Letzter Tag` den letzten Ferientag ein. Dann endet die Serie mit den Ferien.",
      "Schicht-Serien im Dienstplan lassen Ferien und Schließtage aus.",
      "Ein Schließtag mit `Vom Träger` hat dein Träger geplant. Er gilt wie deine eigenen Schließtage. Ändern kann ihn nur das Träger-Büro.",
      "Mit `Auch in den Ferien und an Schließtagen planen` planst du auch dann Schichten.",
      "An gesetzlichen Feiertagen plant eine Serie nie Schichten.",
      "Schichten, die schon geplant waren, bleiben stehen.",
      "Termine ohne Schließtag absagen: Wähle im Betreuungsplan im Menü `Termine im Zeitraum absagen`.",
      "Der Hinweis zu den Ferien zählt nur Termine, die schon im Plan stehen. Serien mit `Auch an Schließtagen planen` und Serien in einem Zeitraum der Art `Ferien` zählt er nicht mit.",
    ],
    differences: [
      "Ein verschobener Schließtag nennt `Neu` und `Vorher`. Die Eltern erfahren in einer E-Mail, welche Tage geschlossen und welche doch geöffnet sind.",
      "Ein gelöschter Schließtag steht mit `Gelöscht` in der Karte. Die Eltern erfahren, dass die Tage wieder geöffnet sind.",
      "Legst du eine Schicht auf einen Schließtag, fragt moto vorher nach.",
      "Du siehst `Termine absagen` nicht? Dann fehlt dir das Recht, den Betreuungsplan zu bearbeiten.",
    ],
    troubleshootingDetails: [
      "Der Hinweis zeigt `Nicht angekommen`? Wähle noch einmal `Eltern informieren`. Familien, die schon eine E-Mail haben, bekommen keine zweite.",
      "Der Hinweis zeigt `Ergebnis unbekannt`? Schreibe dem moto-Team. Es prüft den Versand.",
      "Nach dem Klick steht, der Schließtag wurde geändert? Prüfe den Hinweis und wähle noch einmal `Eltern informieren`.",
      "Der Betreuungsplan sagt `Noch kein Planungszeitraum`? Dann fehlt für diese Woche ein Zeitraum.",
    ],
    related: [
      HELP_TOPICS.leadCarePlan,
      HELP_TOPICS.leadDutyRoster,
      HELP_TOPICS.leadEnrollmentSetup,
    ],
  };
}
