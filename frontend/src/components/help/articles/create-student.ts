import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Kinder anlegen: einzeln im Slide-over `Neues Kind` auf
 * `/database/students`, viele auf einmal unter `/database/students/import`.
 * Beides an keine Einstellung gebunden.
 *
 * Live geprueft: `Neues Kind` ist ein einziges Fenster. Pflicht sind nur
 * `Vorname`, `Nachname` und `Klasse`; darunter folgen die Abschnitte
 * `Erziehungsberechtigte`, `Betreuungszeiten`, `Gesundheitsinformationen`,
 * `Elternnotizen`, `Datenschutz` und `Erlaubte Heimwege`
 * -- alle vor `Erstellen`, alle freiwillig. Deshalb tragen die Schritte nur
 * den Weg, nicht jedes Feld.
 *
 * Die Weiche `Nur Klassenliste` erscheint nur mit `users:create`
 * (students/page.tsx:638), fuer die Leitung also immer. Der Einstieg
 * `Importieren` steht nur auf breiten Bildschirmen (`!isMobile`,
 * page.tsx:723).
 */
export function createStudentTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadCreateStudent,
    title: "Kinder anlegen",
    question: "Wie lege ich Kinder an?",
    summary: "Einzeln über ein Fenster. Viele auf einmal über eine Vorlage.",
    group: "einrichten",
    audience: "lead",
    icon: "User",
    steps: [],
    instructionGroups: [
      {
        title: "Ein Kind einzeln anlegen",
        description:
          "Alles steht in einem Fenster. Pflicht sind nur drei Felder, alles andere kannst du später nachtragen.",
        steps: [
          "Klappe in der Seitenleiste `Verwaltung` auf.",
          "Öffne `Datenverwaltung` und danach `Kinderdaten`.",
          "Wähle oben rechts `+ Kinder`.",
          "Bleibe oben auf `Mit OGS-Betreuung`.",
          "Trage `Vorname`, `Nachname` und `Klasse` ein.",
          "Fülle weiter unten aus, was du schon weißt.",
          "Wähle unten `Erstellen`.",
        ],
      },
      {
        title: "Viele Kinder aus einer Liste übernehmen",
        description:
          "Für ein ganzes Schuljahr ist die Vorlage schneller als das Fenster.",
        steps: [
          "Öffne `Kinderdaten`.",
          "Öffne oben das Menü mit den drei Punkten.",
          "Wähle `Importieren`.",
          "Wähle bei `Format wählen` `Excel (.xlsx)` oder `CSV (Komma-getrennt)`.",
          "Wähle `Vorlage herunterladen`.",
          "Trage die Kinder ein. Beim Geburtstag geht zum Beispiel `14.03.2018`.",
          "Bleibe unter `Was soll der Import tun?` bei `Nur neue anlegen`.",
          "Ziehe die Datei unter `Schritt 3: Datei hochladen` in das Feld.",
          "Prüfe die `Datenvorschau`.",
          "Wähle unten den grünen Knopf, zum Beispiel `12 Kinder importieren`.",
        ],
      },
    ],
    result:
      "Ein einzeln angelegtes Kind steht sofort unter `Kinderdaten`. Nach einem Import meldet moto, wie viele Kinder angelegt und wie viele aktualisiert wurden.",
    notes: [
      "Im Fenster stehen weiter unten `Erziehungsberechtigte`, `Betreuungszeiten`, `Gesundheitsinformationen`, `Elternnotizen`, `Datenschutz` und `Erlaubte Heimwege`.",
      "Bei einem Geschwisterkind wähle `Vorhandene/n suchen`. Dann teilen beide dieselben Erziehungsberechtigten.",
      "Ein Auge neben einer Angabe heißt: Eltern sehen sie.",
      "In der Vorlage erklärt das Blatt `Hinweise` jede Spalte.",
      "`Nur bestehende aktualisieren` und `Beides` brauchst du erst, wenn du Angaben nachträglich änderst. Leere Zellen ändern nie etwas.",
      "Hat deine Schule ein Kinderkontingent, steht es oben in `Kinderdaten`. Zum Beispiel `Kinderkontingent: 48 von 50 belegt`. Es zählen aktive Kinder und Kinder, deren Betreuung später beginnt. Das Info-Symbol daneben erklärt es auch.",
    ],
    differences: [
      "`Vorname`, `Nachname` und `Klasse` tragen einen roten Stern. Sie sind Pflicht.",
      "Oben im Fenster kannst du auf `Nur Klassenliste` wechseln. Das ist für Kinder ohne OGS-Betreuung.",
      "Statt `Nur Klassenliste` steht dort `Ohne OGS-Platz`? Dann hat das moto-Team für deine Schule Kinder ohne OGS-Platz eingeschaltet. Das Kind bekommt einen eigenen Eintrag. Seine Eltern kannst du in die Eltern-App einladen.",
      "Auf dem Handy steht statt `+ Kinder` ein rundes Plus unten rechts. `Importieren` fehlt dort ganz.",
    ],
    troubleshootingDetails: [
      "Fehlt die passende `Gruppe`? Lege sie zuerst in der `Datenverwaltung` unter `Gruppendaten` an.",
      "Der grüne Knopf ist grau? Dann hat die Vorschau noch Fehler. Behebe sie in der Datei und lade erneut hoch.",
      "Über der Vorschau steht rot, der Import würde mehr Kinder hinzufügen, als im Kinderkontingent frei sind? Dann startet der Import gar nicht. Nimm Kinder aus der Datei heraus oder melde dich beim moto-Team. Kinder, die der Import nur aktualisiert, zählen dabei nicht.",
      "moto erkennt eine Zeile an Vorname, Nachname und Klasse. Bei einem Klassenwechsel an der Spalte `RFID-Karte` oder am Geburtstag.",
      "moto meldet, das Kind ist angelegt, aber die Angaben unter `Datenschutz` wurden nicht gespeichert? Wähle in der Meldung `Öffnen`. Wähle bei `Persönliche Informationen` `Bearbeiten` und trage die Angaben unter `Datenschutz` neu ein.",
      "moto meldet, das Kinderkontingent ist voll? Dann ist die Kontingentzahl erreicht. Wie viel belegt ist, steht oben in `Kinderdaten`. Deine Eingaben bleiben im Fenster. Für weitere Kinder melde dich beim moto-Team.",
    ],
    related: [
      HELP_TOPICS.leadCareTimes,
      HELP_TOPICS.leadGroups,
      HELP_TOPICS.leadManageStudent,
    ],
  };
}
