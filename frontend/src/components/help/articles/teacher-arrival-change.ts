import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `Ankunft heute ändern` (`class-arrival-exception-dialog.tsx`). Nur mit
 * Freigabe der OGS; gilt fuer einen Tag und die ganze Klasse.
 */
export function teacherArrivalChangeTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherArrivalChange,
    title: "Die Ankunftszeit meiner Klasse ändern",
    question: "Der Unterricht fällt aus. Wie sage ich das der OGS?",
    summary: "Du trägst die neue Ankunftszeit für einen einzelnen Tag ein.",
    group: "klasse",
    audience: "teacher",
    icon: "Clock3",
    steps: [
      "Öffne die Liste deiner Klasse.",
      "Wähle `Ankunft heute ändern`.",
      "Wähle den Tag.",
      "Trage bei `Kommt um` die neue Zeit ein.",
      "Trage bei Bedarf einen `Grund (optional)` ein, zum Beispiel `Wandertag`.",
      "Wähle `Tag speichern`.",
    ],
    result:
      "Die OGS sieht die neue Zeit sofort. Sie gilt nur für Kinder mit Betreuung an diesem Tag.",
    notes: [
      "Die Zeit gilt für alle Kinder der Klasse und nur an diesem Tag.",
      "Mit `Entfernen` nimmst du einen Eintrag wieder zurück.",
    ],
    differences: [
      "Fehlt `Ankunft heute ändern`? Dann hat deine OGS das Eintragen nicht freigegeben. Du siehst dann nur die Zeit, die die OGS eingetragen hat.",
      "Bei einem Eintrag der OGS steht `Eingetragen von der OGS`.",
    ],
    troubleshootingDetails: [
      "moto sagt, das Eintragen sei nicht mehr freigegeben? Dann hat die OGS es zurückgenommen. Schreibe ihr eine Nachricht.",
    ],
    related: [
      HELP_TOPICS.teacherClassDay,
      HELP_TOPICS.teacherMessages,
      HELP_TOPICS.teacherFeatureMissing,
    ],
  };
}
