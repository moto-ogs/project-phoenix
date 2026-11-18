import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/payroll`: keine Abrechnung, sondern deren Konfiguration. Karten:
 * `Vollständigkeit`, `Feste Lohnarten`, `Eigene Lohnarten`, `Zuschläge`,
 * `Eigene Abwesenheitsarten` (#4807), `DATEV-Mandant` und `Versand an das
 * Lohnbüro` (#4805, payroll/page.tsx).
 */
export function payrollTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadPayroll,
    title: "Eine Abrechnung für DATEV vorbereiten",
    question: "Wie bereite ich die Lohnabrechnung vor?",
    summary: "Du hinterlegst einmal die Lohnarten deines Trägers.",
    group: "personal",
    audience: "lead",
    icon: "Landmark",
    steps: [],
    instructionGroups: [
      {
        title: "Lohnarten und DATEV eintragen",
        steps: [
          "Klappe in der Seitenleiste `Verwaltung` auf.",
          "Öffne `Abrechnung`.",
          "Prüfe oben unter `Vollständigkeit`, was noch fehlt.",
          "Trage unter `Feste Lohnarten` die Nummern deines Lohnsystems ein.",
          "Trage unter `DATEV-Mandant` `Beraternummer` und `Mandantennummer` ein.",
          "Trage die `Personalnummern` bei den Personen nach. Das Feld steht beim Personal im Reiter `Stammdaten`.",
          "Fehlt bei `Soll (Arbeitszeit)` etwas? Tippe auf `Personen ohne Soll`. Tippe auf eine Person und lege im Reiter `Arbeitszeitmodell` das Soll fest.",
        ],
      },
      {
        title: "Eigene Lohnarten und Zuschläge anlegen",
        description:
          "moto zählt die gestempelten Stunden in der Nacht, am Sonntag und an Feiertagen. Pausen zählen nicht mit.",
        steps: [
          "Öffne `Abrechnung` und gehe zur Karte `Eigene Lohnarten`.",
          "Tippe auf `Lohnart anlegen`.",
          "Trage `Bezeichnung` und `Lohnartnummer` ein und wähle die `Einheit`.",
          "Zuschläge in Prozent brauchen die Einheit `Stunden`, Zuschläge in Euro die Einheit `Betrag in Euro`.",
          "Tippe in der Karte `Zuschläge` auf `Zuschlagsregel anlegen`.",
          "Wähle die `Art`: `Nachtarbeit`, `Sonntagsarbeit` oder `Feiertagsarbeit`.",
          "Bei `Nachtarbeit`: Prüfe `Von` und `Bis`. Vorgegeben ist 20:00 bis 06:00 Uhr.",
          "Trage die `Höhe` ein und wähle die `Lohnart`.",
        ],
      },
      {
        title: "Eigene Abwesenheitsarten einer Lohnart zuordnen",
        steps: [
          "Öffne `Abrechnung` und gehe zur Karte `Eigene Abwesenheitsarten`.",
          "Wähle neben der Abwesenheitsart die `Lohnart`.",
          "`Keine eigene Lohnart` lässt sie wie bisher unter `Gutschrift Sonstige`.",
        ],
      },
      {
        title: "Die Monatsdatei automatisch an das Lohnbüro senden",
        description:
          "Nach dem Monatsabschluss schickt moto die Monatsdatei aller Mitarbeitenden an das Lohnbüro.",
        steps: [
          "Öffne `Abrechnung` und gehe zur Karte `Versand an das Lohnbüro`.",
          "Schalte `Automatisch nach dem Monatsabschluss senden` ein.",
          "Wähle den `Versandweg`: `SFTP` oder `E-Mail`.",
          "Wähle das `Dateiformat`.",
          "Bei `E-Mail`: Trage die `E-Mail-Adresse des Lohnbüros` ein.",
          "Unter `Letzter Versand` siehst du, ob die Datei angekommen ist.",
        ],
      },
    ],
    result:
      "Ist alles vollständig, kann die Datei für DATEV erzeugt werden. Nach jedem Monatsabschluss geht sie von selbst an das Lohnbüro, wenn der Versand eingeschaltet ist.",
    notes: [
      "Änderungen werden sofort gespeichert. Es gibt keinen Speichern-Knopf.",
      "Die Lohnartnummern kommen vom Träger, nicht von moto.",
      "`Lohn und Gehalt` braucht die Mandanten-Kennzahlen nicht.",
      "Die Feiertage nimmt moto aus dem Bundesland der Schule.",
      "Ist ein Sonntag auch Feiertag, zählt die höhere Regel. Nachtarbeit zählt zusätzlich.",
      "Ein abgeschlossener Monat behält die Lohnarten und Regeln, die beim Abschluss galten.",
      "Personen mit Arbeitsvertrag beim Träger fehlen in der Monatsdatei der Schule. Ihren Lohn rechnet der Träger ab.",
      "Eine Lohnart, die eine Regel oder Abwesenheitsart noch nutzt, lässt sich nicht archivieren.",
      "Per `E-Mail` bekommt das Lohnbüro einen Link, keinen Anhang. Der Link gilt 14 Tage und funktioniert nur einmal.",
      "Öffnest du einen Monat wieder und schließt ihn erneut ab, geht die Datei noch einmal raus. Ihr Name enthält dann „korrektur“.",
    ],
    differences: [
      "Den Knopf `Personen ohne Soll` sieht nur, wer die Zeiterfassung des Teams verwaltet. Alle anderen sehen nur die Zahl. Das Soll trägt dann die Leitung ein.",
      "`Soll (Arbeitszeit)` prüft den Vormonat, bis er abgeschlossen ist. Danach prüft es den laufenden Monat.",
      "Eine Kategorie oder eigene Lohnart ohne Lohnartnummer wird nicht exportiert. `Vollständigkeit` nennt sie.",
      "Dieselbe Nummer bei mehreren Kategorien ist erlaubt, führt aber meist zu doppelten Stunden. moto warnt davor.",
      "Führt dein Träger eine Person in seiner Personalakte, kommt ihre Personalnummer vom Träger. Ändern kann sie nur die Personalverwaltung des Trägers.",
    ],
    troubleshootingDetails: [
      "Der Export erzeugt keine Datei? Dann fehlt oben unter `Vollständigkeit` noch etwas.",
      "Ein Krankheitstag zählt 0 Stunden? Dann fehlt das Soll. `Vollständigkeit` zählt bei `Soll (Arbeitszeit)` alle Personen ohne Soll im laufenden Monat.",
      "`Zuschlagsregel anlegen` lässt sich nicht tippen? Dann fehlt noch eine eigene Lohnart.",
      "Unter `Letzter Versand` steht `Nicht gesendet` oder `Fehlgeschlagen`? Darunter steht der Grund. Wer die Zeiterfassung des Teams verwaltet, bekommt dazu eine E-Mail. Ob sie ankam, steht bei `Hinweis an die Leitung`.",
      "Unter `Letzter Versand` steht `Nicht zustellbar`? Die Mail mit dem Link kam beim Lohnbüro nicht an. Prüfe die `E-Mail-Adresse des Lohnbüros`. `Versendet` heißt: Die Mail ist raus, eine Meldung aus dem Postfach fehlt noch.",
      "Der `Versandweg` `SFTP` braucht die Gegenstelle aus den Einstellungen unter `Kalender und Export` bei `Zeitkonten übertragen`.",
    ],
    related: [
      HELP_TOPICS.leadWorkTimeReview,
      HELP_TOPICS.leadStaffRecord,
      HELP_TOPICS.leadExports,
    ],
  };
}
