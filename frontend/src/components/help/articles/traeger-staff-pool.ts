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
      "Springer springen an allen deinen Schulen ein. Jede Schule blockt sie für einen Tag und eine Zeit. Du siehst jede Blockung.",
    group: "personal",
    audience: "traeger",
    icon: "ArrowsLeftRight",
    requirements: [
      "Du hast die Rolle `Personal`.",
      "Die Person hat eine Personalakte mit Arbeitsvertrag.",
    ],
    instructionGroups: [
      {
        title: "Eine Person zum Springer machen",
        steps: [
          "Öffne `Personalakten` und dort die Akte der Person.",
          "Öffne den Reiter `Verträge und Zeit`.",
          "Lege einen Arbeitsvertrag an, oder wähle beim Vertrag `Vertrag ändern`.",
          "Schalte `Vertretungspool` ein und speichere.",
        ],
      },
      {
        title: "Blockungen ansehen und aufheben",
        steps: [
          "Wähle in der Navigation `Vertretungspool`.",
          "Wähle mit den Pfeilen die Woche.",
          "Wähle eine Blockung und dann `Aufheben`.",
        ],
      },
      {
        title: "Blockungen herunterladen",
        steps: [
          "Wähle mit den Pfeilen die Woche.",
          "Wähle oben rechts das Menü mit den drei Punkten. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`. Die Datei enthält alle Blockungen dieser Woche.",
        ],
      },
    ],
    steps: [],
    result:
      "Alle deine Schulen sehen die Person und können sie blocken. Hebst du eine Blockung auf, sieht die Schule „Vom Träger aufgehoben“.",
    notes: [
      "Eine Person ist zu jeder Zeit nur für eine Schule geblockt.",
      "Eine Schule sieht vom Springer nur den Namen, ob die Nachweise vollständig sind, und die geblockten Zeiten.",
      "Andere Schulen sehen nur, welche Schule geblockt hat. Einen Grund oder eine Gruppe speichert moto nicht.",
      "Jedes Anzeigen und jeder Download der Woche steht im Zugriffsprotokoll jeder betroffenen Schule.",
      "Blockt eine Schule die Person zum ersten Mal, wird die Schule ein Einsatzort in der Akte. Die Schule plant sie dann im Dienstplan ein.",
      "An dieser Schule meldet sich die Person nur in den geblockten Zeiten an. Hebst du eine Blockung auf, endet auch dieser Zugang.",
      "Am Tag nach der letzten Blockung einer Schule endet die Beschäftigung dort. In der Akte steht der Einsatzort dann als `Beendet`. Die nächste Blockung beschäftigt die Person dort wieder. Ihr Konto bleibt bestehen.",
      "Hat die Schule der Person eine eigene Rolle gegeben, bleibt sie dort auch nach der letzten Blockung beschäftigt.",
      "Die Person braucht dafür ein Konto bei moto. Hat sie keins, lade sie an einer Schule ein.",
    ],
    differences: [
      "Die Seite zeigt `Diese Funktion ist nicht eingeschaltet`: Personal beim Träger ist noch nicht freigeschaltet. Das moto-Team schaltet es frei.",
    ],
    related: [
      HELP_TOPICS.traegerStaffRecords,
      HELP_TOPICS.traegerStaffContracts,
      HELP_TOPICS.traegerStaffPlanning,
    ],
  };
}
