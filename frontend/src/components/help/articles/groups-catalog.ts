import type { HelpTopic, HelpGroupMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Gruppenkatalog unter `/database/groups`. An keine Einstellung gebunden: der
 * `OpenCareModeGuard` schuetzt nur `/ogs-groups`, und die Seitenleiste blendet
 * bei offener Betreuung nur das Akkordeon `Gruppen` aus
 * (sidebar.tsx:1391). Der Katalog selbst bleibt in jeder Arbeitsweise stehen.
 */
export function groupsCatalogTopic(groupMode: HelpGroupMode): HelpTopic {
  const openCare = groupMode === "open_care";
  return {
    id: HELP_TOPICS.leadGroups,
    title: "Gruppen anlegen",
    question: "Wie lege ich die Gruppen der OGS an?",
    summary: openCare
      ? "Lege Gruppen an, wenn du Kinder darin ordnen möchtest."
      : "Lege jede Gruppe an und gib ihr Raum und Leitung.",
    group: "einrichten",
    audience: "lead",
    icon: "UsersThree",
    steps: [],
    instructionGroups: [
      {
        title: "Eine Gruppe anlegen",
        steps: [
          "Klappe in der Seitenleiste `Verwaltung` auf.",
          "Öffne `Datenverwaltung` und danach `Gruppendaten`.",
          "Wähle oben rechts `+ Gruppe`.",
          "Trage bei `Gruppenname` den Namen der Gruppe ein.",
          "Wähle bei Bedarf einen `Gruppenraum`.",
          "Wähle bei Bedarf eine `Gruppenleitung`. Mehrere sind möglich.",
          "Wähle `Erstellen`.",
        ],
      },
      {
        title: "Eine Gruppe ändern",
        steps: [
          "Öffne `Gruppendaten` und wähle die Gruppe aus der Liste.",
          "Ändere die Angaben unter `Stammdaten`.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Eine Gruppe löschen",
        steps: [
          "Öffne `Gruppendaten` und wähle die Gruppe aus der Liste.",
          "Wähle oben rechts `Löschen`.",
          "Bestätige mit `Ja, löschen`.",
        ],
      },
    ],
    result:
      "Die Gruppe steht sofort zur Auswahl. Du kannst Kinder darin eintragen.",
    notes: [
      "Ein Kind kommt über sein Feld `OGS Gruppe` in die Gruppe, nicht hier.",
      "Über `Alle Räume` filterst du die Liste auf die Gruppen eines Raums.",
      ...(openCare
        ? [
            "Deine OGS arbeitet ohne feste Gruppen. Dein Team sieht deshalb den Bereich `Gruppen` nicht.",
          ]
        : []),
    ],
    differences: [
      "Auf dem Handy steht statt `+ Gruppe` ein rundes Plus unten rechts.",
      "Bei `Gruppenraum` steht `Kein Gruppenraum`, solange kein Raum gewählt ist.",
    ],
    troubleshootingDetails: [
      "Fehlt `Datenverwaltung` in der Seitenleiste? Dann fehlen dir die Leitungsrechte. Frage deine Leitung.",
      "Fehlt eine Person bei `Gruppenleitung`? Dann ist sie noch nicht als Betreuungskraft angelegt.",
    ],
    related: [
      HELP_TOPICS.leadRooms,
      HELP_TOPICS.leadInviteStaff,
      HELP_TOPICS.leadCreateStudent,
    ],
  };
}
