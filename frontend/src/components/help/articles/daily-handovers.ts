import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/substitutions`, in der Seitenleiste `Übergaben` (#7568): laufende
 * Betreuungen, die Vertretungen von heute und die Gruppenübergaben auf einer
 * Seite. Den Vertretungsplan der Leitung beschreibt `substitution-plan.ts`.
 */
export function dailyHandoversTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.dailyHandovers,
    title: "Übergaben von heute",
    question: "Wer übernimmt heute welche Gruppe oder Aufsicht?",
    summary:
      "Hier siehst du, wer heute eine Aufsicht, einen Termin oder eine Gruppe übernimmt.",
    group: "gruppen",
    audience: ["caregiver", "lead"],
    icon: "Repeat",
    steps: [
      "Klappe in der Seitenleiste `Tagesbetrieb` auf und öffne `Übergaben`.",
      "Unter `Laufende Betreuungen` wählst du `Betreuer hinzufügen`. So kommt eine weitere Person in die Aufsicht.",
      "Unter `Vertretungen heute` siehst du, wer heute einen Termin übernimmt.",
      "Unter `Gruppen` wählst du `Gruppe übergeben`. Wähle die Gruppe und die Betreuungskraft. Dann wähle `Zuweisen`.",
      "Mit `Beenden` hörst du eine Übergabe vorzeitig auf. moto fragt vorher nach.",
    ],
    differences: [
      "Steht unter `Gruppen` `Keine Gruppenübergabe nötig`? Dann arbeitet deine OGS ohne feste Gruppen.",
      "Steht bei `Vertretungen heute` `Keine Vertretungen verfügbar`? Dann darfst du die Vertretungen nicht ansehen. Frage deine Leitung.",
      "Fehlt `Betreuer hinzufügen`? Dann bist du für diese Aufsicht nicht zuständig.",
      "Fehlt `Beenden` an einer Übergabe? Dann darfst du sie nicht beenden. Frage deine Leitung.",
    ],
    notes: [
      "Vertretungen für andere Tage plant die Leitung im `Vertretungsplan`.",
    ],
    related: [HELP_TOPICS.transferGroup, HELP_TOPICS.activeSupervision],
  };
}
