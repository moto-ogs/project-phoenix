import type { HelpTopic, HelpGroupMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function dayLogTopic(groupMode: HelpGroupMode): HelpTopic {
  // Ohne feste Gruppen zeigt die Tagesauswertung eine gemeinsame Liste.
  const openCare = groupMode === "open_care";
  return {
    id: HELP_TOPICS.dayLog,
    title: "Den heutigen Betreuungstag prüfen",
    question: "Wie prüfe ich den heutigen Betreuungstag?",
    summary: "Prüfe für heute, welche Kinder anwesend oder abwesend sind.",
    group: "kinder",
    audience: ["caregiver", "lead"],
    icon: "CalendarCheck",
    requirements: ["Deine OGS hat das `Anwesenheitsprotokoll` eingeschaltet."],
    steps: [],
    instructionGroups: [
      {
        title: "Den Betreuungstag prüfen",
        steps: [
          "Klappe in der Seitenleiste `Verwaltung` auf und öffne `Tagesauswertung`.",
          openCare
            ? "Prüfe oben die Zahlen für alle Kinder."
            : "Prüfe oben die Zahlen für alle Gruppen.",
          ...(openCare ? [] : ["Wähle bei einer Gruppe `Details`."]),
          "Prüfe die Kinder in den einzelnen Bereichen.",
          "Wähle ein Kind, um seine Angaben zu öffnen.",
        ],
      },
      {
        title: "Die Auswertung ausgeben",
        steps: [
          ...(openCare
            ? ["Bleibe für alle Kinder in der Übersicht."]
            : [
                "Bleibe für alle Gruppen in der Übersicht.",
                "Für eine einzelne Gruppe öffne deren `Details`.",
              ]),
          "Wähle `Drucken`, `PDF`, `Word` oder `Excel`.",
        ],
      },
    ],
    result:
      "Du siehst für heute, welches Kind da ist. Die Liste ist danach geordnet. Kinder ohne Meldung stehen unter `Unentschuldigt abwesend`. Vergangene Tage kannst du hier nicht auswählen.",
    differences: [
      "Fehlt `Tagesauswertung`? Frage deine Leitung nach dem `Anwesenheitsprotokoll`. Du findest es unter `Einstellungen` und `Datenschutz`.",
      "Steht dort `Anwesenheitsprotokoll ist ausgeschaltet`? Dann ist es für deine Schule nicht eingeschaltet.",
    ],
    notes: [
      "Ist ein Kind früher gegangen, steht der Grund hinter `gegangen`. Er steht auch im `PDF`, in `Word` und in `Excel`.",
    ],
    related: [
      HELP_TOPICS.absences,
      HELP_TOPICS.emergency,
      HELP_TOPICS.ownGroups,
      HELP_TOPICS.leadAbsenceReport,
      HELP_TOPICS.leadStatistics,
    ],
  };
}
