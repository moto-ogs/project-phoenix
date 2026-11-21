import type { HelpTopic, HelpPresenceMode, HelpGroupMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function studentSearchTopic(
  presenceMode: HelpPresenceMode,
  groupMode: HelpGroupMode,
): HelpTopic {
  const currentStatusStep =
    presenceMode === "detailed"
      ? "Prüfe oben den Aufenthaltsort sowie die heutige Ankunft und Abholung."
      : presenceMode === "binary"
        ? "Prüfe oben die Anwesenheit sowie die heutige Ankunft und Abholung."
        : "Prüfe oben die Anwesenheit sowie die heutige Ankunft und Abholung.";

  const presenceDifference =
    presenceMode === "binary"
      ? "Bei einfacher Anwesenheit siehst du keinen Raum. Du siehst nur, ob das Kind da ist."
      : null;
  // #5026: ohne Räume (Binärmodus) gibt es keine Zuweisung.
  const transitNotes =
    presenceMode === "binary"
      ? []
      : [
          "Filterst du nach `Unterwegs`? Oder gruppierst du `Nach Status` oder `Nach Raum`? Dann steht oben die Karte `Unterwegs`. Mit `Zuweisen` setzt du diese Kinder in einen Raum. Die Karte siehst du nur, wenn du Kinder einem Raum zuweisen darfst.",
        ];

  return {
    id: HELP_TOPICS.studentSearch,
    title: "Ein Kind finden und Angaben ansehen",
    question: "Wie finde ich ein Kind und seine Angaben?",
    summary: "Finde ein Kind. Öffne danach die benötigten Angaben.",
    group: "kinder",
    audience: ["caregiver", "lead"],
    icon: "Search",
    steps: [],
    instructionGroups: [
      {
        title: "Ein Kind finden",
        steps: [
          "Öffne `Alle Kinder`.",
          "Gib in `Name suchen...` den Namen ein.",
          "Du kannst auch nur einen Namensteil eingeben.",
          // Der Filter traegt kein sichtbares Wort, nur ein Symbol mit drei
          // Reglern (FilterButton, aria-label "Filter").
          "Zu viele Treffer? Wähle rechts neben der Suche das Filtersymbol.",
          // Ohne feste Gruppen gibt es auch keinen Gruppenfilter.
          groupMode === "open_care"
            ? "Wähle zum Beispiel eine Klasse."
            : "Wähle zum Beispiel eine Klasse oder Gruppe.",
          // Der Klick auf den eigenen Menüeintrag leert Suche und Filter
          // (#3374). Am Handy heißt der Eintrag unten "Suchen".
          "Neue Suche? Wähle im Menü `Alle Kinder` oder unten `Suchen`. Suche und Filter sind dann leer.",
        ],
      },
      {
        title: "Angaben ansehen",
        steps: [
          "Wähle die Karte des Kindes.",
          currentStatusStep,
          // #4761: die Zeilen stehen unter `Heutige Ankunft` und `Heutige
          // Abholung`, sobald das Kind an- oder abgemeldet ist.
          "Unter der Zeit steht, wer das Kind heute an- und abgemeldet hat. `am Gerät` heißt: am Tablet ohne Person. `Ehemalige Mitarbeitende` heißt: Die Person ist nicht mehr in moto. `automatisch` heißt: moto hat das Kind selbst abgemeldet.",
          // #4795: dieselbe Zeile steht in der Aufsicht und in der Gruppe.
          "Steht auf der Karte `Hinweis der Lehrkraft`? Den hat die Lehrkraft heute in moto schule geschrieben. Morgen ist er weg.",
        ],
      },
      {
        title: "Den passenden Bereich wählen",
        ordered: false,
        steps: [
          "Wähle `Stammdaten` für persönliche Angaben.",
          "Wähle `Nachrichten` für den Nachrichtenaustausch mit den Eltern.",
          "Wähle `Erziehungsberechtigte` für Kontaktangaben.",
          "Wähle `Betreuungsplan` für den geplanten Tages- oder Wochenablauf.",
          "Wähle `Betreuungszeiten` für regelmäßige Ankunfts- und Abholzeiten.",
          // Live geprueft: mit Betreuer-Rechten fehlt der Reiter ganz. Er
          // bleibt trotzdem in der Liste -- die Leitung liest denselben
          // Artikel und sieht ihn (canViewEnrollments = `config:manage`).
          "Wähle `Anmeldungen` für Angaben aus der Halbjahresanmeldung. Diesen Reiter sieht nur die Leitung. Über `Herunterladen` wählst du dort `PDF`, `Word` oder `Excel`.",
          "Wähle `Dokumente` für Dateien zum Kind.",
          "Wähle `Änderungsprotokoll` für Änderungen an den Angaben.",
          "Wähle `Historie` für Anwesenheit, Feedback und weitere Verläufe.",
        ],
      },
      {
        title: "Ein Anwesenheitsprotokoll herunterladen",
        steps: [
          "Öffne beim Kind `Historie` und danach `Anwesenheitsprotokoll`.",
          // #4761: Tabelle und Export nennen dieselben Angaben.
          "Bei jedem Tag steht, wer das Kind an- und abgemeldet hat. Die Datei enthält dazu die Spalten `Angemeldet von` und `Abgemeldet von`.",
          "Wähle im Drei-Punkte-Menü `Exportieren`.",
          "Wähle unter `Von` und `Bis` den Zeitraum.",
          "Möglich sind nur die sichtbaren Tage bis heute.",
          "Wähle das Format und danach `Herunterladen`.",
        ],
      },
      {
        // #3844: Stopp je Kind, gesetzt und aufgehoben von der OGS-Verwaltung
        // (config:manage) im Bereich `Historien`.
        title: "Raumverlauf und Stimmung für ein Kind stoppen",
        description: "Das kann nur die OGS-Verwaltung.",
        steps: [
          "Öffne beim Kind `Historie`.",
          "Wähle bei `Historien` den Knopf `Stopp setzen`.",
          "Gib zur Bestätigung `LÖSCHEN` ein. Wähle dann `Stoppen und löschen`.",
          "moto löscht den bisherigen Raumverlauf des Kindes sofort.",
          "Danach speichert moto für das Kind keine Räume und keine Stimmung mehr. Am Tablet fragt moto das Kind nicht nach seiner Stimmung.",
          "Der aktuelle Raum bleibt für die Betreuung sichtbar. Frühere Stimmungen bleiben bis zum Ende ihrer Frist gespeichert.",
          "Mit `Stopp aufheben` speichert moto ab jetzt wieder. Gelöschtes kommt nicht zurück.",
        ],
      },
      {
        // #3834: derselbe Umschalter steht auch in `Gruppen` und in der
        // aktuellen Aufsicht, auch auf dem Handy.
        title: "Als Liste ansehen",
        description:
          "Die Liste zeigt dieselben Angaben wie die Karten, ein Kind pro Zeile.",
        steps: [
          "Wähle oben rechts das Listensymbol (drei Striche). Mit dem Kachelsymbol (vier Kästchen) kommen die Karten zurück.",
          "Spalten ein- oder ausblenden? Öffne oben rechts das Menü mit den drei Punkten. Wähle unter `Spalten in der Liste` die Spalten.",
          "Auf dem Handy zeigt die Liste je Kind eine Zeile. Was unter dem Namen steht, wählst du im Menü mit den drei Punkten unter `In der Zeile zeigen`, zum Beispiel `Gehzeit` oder `Gruppe`.",
          "Kreuze links in der Zeile Kinder an. Oben erscheint eine Leiste mit `Exportieren`, `Anmelden` und `Abmelden`.",
          "Wähle `Aufheben`, um alle Kreuze zu entfernen.",
        ],
      },
      {
        // #6954: der Filter steht im Filterfeld unter `Anmeldung`, nur mit
        // Zugriff auf die Angaben der Kinderakte und nur bei eigenen Fragen
        // der Online-Anmeldung. Freitext, Zahl und Datum: `Angabe vorhanden`
        // (#7012).
        title: "Nach Angaben aus der Anmeldung filtern",
        steps: [
          "Wähle rechts neben der Suche das Filtersymbol.",
          "Wähle unter `Anmeldung` bei `Angabe aus der Anmeldung` eine Antwort, zum Beispiel eine Frage mit `Ja`.",
          "Bei Fragen mit freiem Text, Zahl oder Datum wählst du `Angabe vorhanden`. Dann siehst du alle Kinder, bei denen die Eltern etwas eingetragen haben. Auch „keine“ zählt als Angabe.",
          "Haben die Eltern nur wenige verschiedene Antworten gegeben, steht jede Antwort darunter, zum Beispiel `keine`. So siehst du, wie viele Kinder welche Antwort haben.",
          "Die Zahl in Klammern nennt, wie viele Kinder die Liste dann zeigt. Kinder, die die Schule verlassen haben, zählen nicht.",
          "`Alle Angaben` hebt den Filter wieder auf.",
        ],
      },
    ],
    result:
      "Du siehst jetzt die Angaben des Kindes. Über dem Namen steht `Zurück zur Kinderübersicht`. Damit kommst du zur Liste zurück.",
    differences: [
      "Hast du einen anderen Tag gewählt? Dann siehst du die geplante Anwesenheit. Ein aktueller Aufenthaltsort wird nicht gezeigt.",
      "Ansicht und Spalten bleiben auf diesem Gerät so, wie du sie gewählt hast.",
      // Einstellung „Kinder nur über ‚Alle Kinder‘ finden“ (#1321).
      "Fehlen `Gruppen` und `Aktuelle Aufsicht` in der Navigation? Dann wähle in `Alle Kinder` oben `Meine Gruppe` oder `Meine Aufsicht`.",
      "Einige Bereiche brauchen zusätzliche Rechte: `Betreuungsplan`, `Dokumente` und `Änderungsprotokoll`. Fehlt ein Bereich? Frage deine Leitung.",
      "Fehlt im Filter `Anmeldung`? Den Filter sehen nur Mitarbeitende, die auch die Angaben aus der Anmeldung beim Kind sehen. Er erscheint erst, wenn Eltern in der Online-Anmeldung eigene Fragen der Schule beantwortet haben.",
      ...(presenceDifference ? [presenceDifference] : []),
    ],
    ...(transitNotes.length > 0 ? { notes: transitNotes } : {}),
    troubleshooting: HELP_TOPICS.missingChildOrGroup,
    related: [
      HELP_TOPICS.schoolSearch,
      HELP_TOPICS.editStudent,
      HELP_TOPICS.webAttendance,
      HELP_TOPICS.absences,
      HELP_TOPICS.leadManageStudent,
    ],
  };
}
