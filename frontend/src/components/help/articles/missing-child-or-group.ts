import type { HelpTopic, HelpGroupMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function missingChildOrGroupTopic(groupMode: HelpGroupMode): HelpTopic {
  return {
    id: HELP_TOPICS.missingChildOrGroup,
    title: "Ein Kind oder eine Gruppe fehlt",
    question: "Was kann ich tun, wenn ein Kind oder eine Gruppe fehlt?",
    summary: "Prüfe Suche, Filter, gewählten Tag und deine Gruppenzuordnung.",
    group: "probleme",
    audience: "caregiver",
    icon: "Search",
    steps: [
      "Lösche den Text im Suchfeld.",
      // Jede Liste hat eigene Filter: ein Symbol, ein Umschalter oder eine
      // Auswahl. Einen Knopf namens `Filter` gibt es nirgends.
      "Setze die Filter über der Liste zurück.",
      "Prüfe, ob oben der richtige Tag gewählt ist.",
      "Suche das Kind unter `Alle Kinder`.",
      ...(groupMode === "fixed_groups"
        ? [
            "Fehlt das Kind nur unter `Gruppen`? Prüfe, ob du die richtige Gruppe geöffnet hast.",
            "Frag deine Leitung, ob sie die Gruppe des Kindes und deine Gruppenzuordnung prüft.",
          ]
        : groupMode === "open_care"
          ? [
              "Bei offener Betreuung gibt es keine festen eigenen Gruppen. Arbeite über `Alle Kinder`.",
            ]
          : [
              "Prüfe, ob deine OGS mit festen Gruppen oder einer gemeinsamen Kinderliste arbeitet.",
            ]),
    ],
    result:
      "Das Kind bleibt unsichtbar? Dann muss deine Leitung Daten und Zugriff prüfen.",
    differences: [
      "Ein Kind kann an einem anderen Tag anders eingeplant sein.",
      "Vorübergehend übernommene Gruppen gelten nur bis zum Ende des Tages.",
      "Gelöschte oder noch nicht übernommene Kinder erscheinen nicht in der normalen Kinderliste.",
      // #6041: ein Kind mit geplantem späterem Start zählt erst ab dem Start.
      "Ist der Start eines Kindes für später geplant, steht es erst ab dem Start unter `Alle Kinder`. Vorher findest du es unter `Datenverwaltung` und danach `Kinderdaten`.",
    ],
    related: [HELP_TOPICS.studentSearch, HELP_TOPICS.ownGroups],
  };
}
