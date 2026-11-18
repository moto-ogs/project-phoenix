import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function absencesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.absences,
    title: "Ein Kind krank oder entschuldigt melden",
    question: "Wie melde ich ein Kind krank oder entschuldigt?",
    summary:
      "Trage eine Krankmeldung oder Entschuldigung für die passenden Tage ein.",
    group: "kinder",
    audience: "caregiver",
    icon: "BellRing",
    steps: [],
    instructionGroups: [
      {
        title: "Ein Kind krankmelden",
        steps: [
          "Suche das Kind unter `Alle Kinder`.",
          "Öffne die Karte des Kindes.",
          "Wähle `Krank melden`.",
          "Wähle `Einzelne Tage` oder `Zeitraum`.",
          "Wähle die Tage der Krankmeldung aus.",
          "Trage bei Bedarf einen Grund ein.",
          "Wähle `Krankmelden`.",
        ],
      },
      {
        title: "Ein Kind entschuldigen",
        steps: [
          "Suche das Kind unter `Alle Kinder`.",
          "Öffne die Karte des Kindes.",
          "Wähle `Entschuldigen`.",
          "Wähle `Ganzer Tag` oder `Ab Uhrzeit`.",
          "Bei `Ganzer Tag`: Wähle `Einzelne Tage` oder `Zeitraum`. Wähle danach die Tage aus.",
          "Bei `Ab Uhrzeit`: Wähle einen Tag. Trage danach die passende Uhrzeit ein.",
          "Trage bei Bedarf einen Grund ein.",
          "Wähle `Entschuldigen`.",
        ],
      },
      {
        title: "Bei `Ab Uhrzeit`",
        steps: [
          "`Ab Uhrzeit` gilt für genau einen Tag.",
          "Spätere Betreuungszeiten sind an diesem Tag entschuldigt.",
          "Ist keine Abholzeit eingetragen, übernimmt moto die gewählte Uhrzeit.",
        ],
        ordered: false,
      },
      {
        title: "Die Meldung für heute aufheben",
        steps: [
          "Suche das Kind unter `Alle Kinder`.",
          "Öffne die Karte des Kindes.",
          "Wähle `Gesund melden` oder `Entschuldigung aufheben`.",
          "Bestätige im Fenster mit `Gesundmelden` oder `Entschuldigung aufheben`.",
        ],
        description:
          "Das gilt auch, wenn die Eltern das Kind für heute abgemeldet haben.",
      },
      {
        title: "Einen geplanten Tag entfernen",
        steps: [
          "Suche das Kind unter `Alle Kinder`.",
          "Öffne die Karte des Kindes.",
          "Wähle `Krank melden` oder `Entschuldigen`.",
          "Steht dort `Gesund melden` oder `Entschuldigung aufheben`? Wähle das. Wähle danach im Fenster `Alle Kranktage ansehen` oder `Alle entschuldigten Tage ansehen`.",
          "Suche den Tag unter `Bereits krank` oder `Bereits entschuldigt`.",
          "Öffne beim Tag das Menü mit den drei Punkten.",
          "Wähle `Entfernen`.",
          "Wähle `Entfernen bestätigen`. Wähle danach `Eintrag entfernen`.",
        ],
      },
      {
        // Live geprueft: die Liste `Bereits ab Uhrzeit entschuldigt` erscheint,
        // sobald `Ab Uhrzeit` gewaehlt ist. Ein Tag muss dafuer nicht gewaehlt sein.
        title: "Eine Entschuldigung `Ab Uhrzeit` entfernen",
        steps: [
          "Öffne die Karte des Kindes.",
          "Wähle `Entschuldigen`.",
          "Wähle `Ab Uhrzeit`.",
          "Öffne unter `Bereits ab Uhrzeit entschuldigt` beim Tag das Menü mit den drei Punkten.",
          "Wähle `Entfernen`. Für eine andere Uhrzeit wähle `Bearbeiten`.",
          "Wähle `Entfernen bestätigen`. Wähle danach `Teilentschuldigung entfernen`.",
        ],
      },
    ],
    result:
      "Die Krankmeldung oder Entschuldigung ist gespeichert. Das Kind erscheint am gewählten Tag mit dem passenden Status.",
    notes: [
      "Die heutige Meldung aufheben ändert geplante Tage in der Zukunft nicht.",
      "Ist das Kind trotzdem da, zählt es als anwesend. Seine geplante Gehzeit gilt weiter. Ist sie vorbei, wird sie als überfällig markiert. Die Meldung bleibt als Hinweis beim Kind sichtbar.",
    ],
    differences: [
      "Fehlen `Krank melden` und `Entschuldigen`? Frage deine Leitung, ob deine Rolle Abwesenheiten bearbeiten darf.",
      "Steht dort `Gesund melden` oder `Entschuldigung aufheben`? Dann ist das Kind heute krank gemeldet oder entschuldigt.",
      "Fehlt `Ab Uhrzeit`? Dann darfst du nur ganze Tage entschuldigen.",
      "Steht beim Tag `Automatisch (Abholzeit)`? Dann kommt die Entschuldigung aus der früheren Abholzeit. Ändere dafür die Abholzeit des Tages.",
      // #5698: Teilentschuldigung bewusst durch eine Tagesmeldung ersetzen.
      "Ist ein gewählter Tag schon `Ab Uhrzeit` entschuldigt? Dann nennt das Fenster den Tag und speichert nur die anderen Tage. Soll die Meldung den ganzen Tag gelten, wähle zum Beispiel `Durch Krankmeldung ersetzen`. Geänderte Betreuungsblöcke und die Abholzeit gelten dann wieder wie geplant. Die Wahl fehlt, wenn du `Ab Uhrzeit` nicht bearbeiten darfst.",
    ],
    related: [
      HELP_TOPICS.studentSearch,
      HELP_TOPICS.dayLog,
      HELP_TOPICS.webAttendance,
    ],
  };
}
