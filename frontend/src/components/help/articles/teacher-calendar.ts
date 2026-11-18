import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function teacherCalendarTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherCalendar,
    title: "Den Kalender nutzen",
    question: "Wie trage ich einen Ausflug oder Schultermin ein?",
    summary:
      "Der Kalender zeigt Termine der OGS, Schließtage, Ferien und deine Schultermine.",
    group: "nachrichten",
    audience: "teacher",
    icon: "CalendarDays",
    steps: [],
    instructionGroups: [
      {
        title: "Einen Schultermin eintragen",
        steps: [
          "Öffne `Kalender`.",
          "Wähle `Neuer Termin`.",
          "Gib einen Titel ein und wähle die Art, zum Beispiel `Ausflug`.",
          "Wähle Tag und Uhrzeit. Oder setze den Haken bei `Ganztägig`.",
          "Wähle unter `Wer sieht den Termin?`, ob auch Eltern ihn sehen.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Auf eine Einladung der OGS antworten",
        steps: [
          "Wähle den Termin im Kalender.",
          "Bei einer Reihe: Wähle unter `Deine Antwort gilt für`, ob die Antwort nur für diesen Termin oder für `Alle Termine` gilt.",
          "Wähle `Zusagen` oder `Absagen`.",
        ],
      },
    ],
    result:
      "Die OGS und alle Lehrkräfte sehen deinen Schultermin. Die Eltern sehen ihn nur, wenn du das gewählt hast.",
    notes: [
      "Deine eigenen Schultermine öffnest du im Kalender. Dort findest du `Bearbeiten` und `Löschen`.",
      "Schließtage und Ferien trägt die OGS ein. Sie stehen ganztägig im Kalender.",
      "Unter `Kalender abonnieren` holst du die Termine in deinen Handy-Kalender.",
    ],
    differences: [
      "Wer den Termin sieht, wählst du nur beim Anlegen. Beim Ändern bleibt es gleich.",
      "`Eltern meiner Klassen` ist grau? Dann ist dir keine Klasse zugeordnet.",
    ],
    related: [
      HELP_TOPICS.teacherNotices,
      HELP_TOPICS.teacherMessages,
      HELP_TOPICS.teacherFeatureMissing,
    ],
  };
}
