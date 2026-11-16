import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/personal/vertretungspool` (#4709, ADR 0252): wer Springer ist,
 * jede Blockung der Woche, ihr Download (#4718) und das Aufheben einer
 * Blockung.
 */
export function traegerStaffPoolTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerStaffPool,
    title: "Vertretungspool des Trägers",
    question: "Wie lege ich Springer an und sehe, wer sie geblockt hat?",
    summary:
      "Springer springen an allen Ihren Schulen ein. Jede Schule blockt sie für einen Tag und eine Zeit. Sie sehen jede Blockung.",
    group: "personal",
    audience: "traeger",
    icon: "ArrowsLeftRight",
    requirements: [
      "Sie haben die Rolle `Personal`.",
      "Die Person hat eine Personalakte mit Arbeitsvertrag.",
    ],
    instructionGroups: [
      {
        title: "Eine Person zum Springer machen",
        steps: [
          "Öffnen Sie `Personalakten` und dort die Akte der Person.",
          "Legen Sie einen Arbeitsvertrag an, oder wählen Sie beim Vertrag `Vertrag ändern`.",
          "Schalten Sie `Vertretungspool` ein und speichern Sie.",
        ],
      },
      {
        title: "Blockungen ansehen und aufheben",
        steps: [
          "Wählen Sie in der Navigation `Vertretungspool`.",
          "Wählen Sie mit den Pfeilen die Woche.",
          "Wählen Sie eine Blockung und dann `Aufheben`.",
        ],
      },
      {
        title: "Blockungen herunterladen",
        steps: [
          "Wählen Sie mit den Pfeilen die Woche.",
          "Wählen Sie oben rechts `Herunterladen` und dann `PDF`, `Excel` oder `CSV`. Die Datei enthält alle Blockungen dieser Woche.",
        ],
      },
    ],
    steps: [],
    result:
      "Alle Ihre Schulen sehen die Person und können sie blocken. Heben Sie eine Blockung auf, sieht die Schule „Vom Träger aufgehoben“.",
    notes: [
      "Eine Person ist zu jeder Zeit nur für eine Schule geblockt.",
      "Eine Schule sieht vom Springer nur den Namen, ob die Nachweise vollständig sind, und die geblockten Zeiten.",
      "Andere Schulen sehen nur, welche Schule geblockt hat. Einen Grund oder eine Gruppe speichert moto nicht.",
      "Jedes Anzeigen und jeder Download der Woche steht im Zugriffsprotokoll jeder betroffenen Schule.",
      "Blockt eine Schule die Person zum ersten Mal, wird die Schule ein Einsatzort in der Akte. Die Schule plant sie dann im Dienstplan ein.",
      "An dieser Schule meldet sich die Person nur in den geblockten Zeiten an. Heben Sie eine Blockung auf, endet auch dieser Zugang.",
      "Die Person braucht dafür ein Konto bei moto. Hat sie keins, laden Sie sie an einer Schule ein.",
    ],
    differences: [
      "Die Seite zeigt `Personal beim Träger ist noch nicht freigeschaltet`: Das moto-Team schaltet es frei.",
    ],
    related: [
      HELP_TOPICS.traegerStaffRecords,
      HELP_TOPICS.traegerStaffContracts,
      HELP_TOPICS.traegerStaffPlanning,
    ],
  };
}
