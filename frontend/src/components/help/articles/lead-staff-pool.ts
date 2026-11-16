import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/dienstplan/springer` (#4709, ADR 0252): die Springer aus dem
 * Vertretungspool des Trägers sehen, blocken und eine eigene Blockung
 * aufheben.
 */
export function leadStaffPoolTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadStaffPool,
    title: "Springer des Trägers blocken",
    question: "Wie blocke ich einen Springer für meine Schule?",
    summary:
      "Springer sind Fachkräfte Ihres Trägers, die an jeder seiner Schulen einspringen. Sie blocken eine Person für einen Tag und eine Zeit.",
    group: "planung",
    audience: "lead",
    icon: "UsersThree",
    requirements: [
      "Sie dürfen den Dienstplan bearbeiten.",
      "Ihr Träger führt sein Personal in moto und hat Springer angelegt.",
    ],
    instructionGroups: [
      {
        title: "Einen Springer blocken",
        steps: [
          "Öffnen Sie `Dienstplan`.",
          "Wählen Sie oben rechts das Menü und dort `Springer des Trägers`.",
          "Wählen Sie mit den Pfeilen die Woche.",
          "Wählen Sie in der Zeile der Person einen freien Tag.",
          "Tragen Sie `Beginn` und `Ende` ein.",
          "Wählen Sie `Blocken`.",
        ],
      },
      {
        title: "Eine Blockung aufheben",
        steps: [
          "Wählen Sie die grüne Blockung `Ihre Schule`.",
          "Wählen Sie `Aufheben`.",
        ],
      },
    ],
    steps: [],
    result:
      "Die Person ist zu dieser Zeit für Ihre Schule geblockt. Andere Schulen sehen nur, dass Ihre Schule geblockt hat.",
    notes: [
      "Eine Person ist zu jeder Zeit nur für eine Schule geblockt. Blocken zwei Schulen gleichzeitig, bekommt die erste die Person.",
      "Neben dem Namen steht, ob die Nachweise vollständig sind, etwa das Führungszeugnis.",
      "moto speichert keinen Grund und keine Gruppe zu einer Blockung.",
      "Nach der ersten Blockung steht die Person in Ihrem Dienstplan. Planen Sie dort ihre Schicht ein.",
      "Die Person meldet sich bei Ihrer Schule nur in den geblockten Zeiten an, 30 Minuten vorher bis 30 Minuten danach. Sie sieht ihren Dienstplan und stempelt, mehr nicht.",
      "Am Tag nach Ihrer letzten Blockung endet die Beschäftigung an Ihrer Schule. Blocken Sie die Person wieder, ist sie wieder bei Ihnen beschäftigt.",
      "Geben Sie der Person an Ihrer Schule eine eigene Rolle, bleibt sie auch nach der letzten Blockung beschäftigt.",
    ],
    differences: [
      "Eine graue Blockung nennt eine andere Schule. Zu dieser Zeit ist die Person dort.",
      "`Vom Träger aufgehoben`: Die Personalverwaltung hat Ihre Blockung aufgehoben. Die Zeit ist wieder frei.",
      "`Nicht im Pool`: An diesem Tag ist die Person nicht im Vertretungspool.",
      "`Ihr Träger führt sein Personal nicht in moto`: Dann gibt es keine Springer. Vertretungen planen Sie wie bisher im Dienstplan.",
    ],
    troubleshootingDetails: [
      "„Diese Person ist zu dieser Zeit schon geblockt“: Eine andere Schule war schneller. Wählen Sie eine andere Zeit.",
    ],
    related: [HELP_TOPICS.leadDutyRoster, HELP_TOPICS.leadSubstitutionPlan],
  };
}
