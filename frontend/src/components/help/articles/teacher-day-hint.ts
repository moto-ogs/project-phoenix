import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `Hinweis für die OGS` (`class-day-class.tsx`, #4795). Nur mit Freigabe der
 * OGS; gilt nur für heute, für die Klasse oder ein Kind.
 */
export function teacherDayHintTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherDayHint,
    title: "Der OGS einen Hinweis für heute geben",
    question: "Wie sage ich der OGS, was sie heute wissen muss?",
    summary:
      "Du schreibst einen kurzen Hinweis für deine Klasse oder ein Kind.",
    group: "klasse",
    audience: "teacher",
    icon: "MessageSquareText",
    steps: [
      "Öffne die Liste deiner Klasse für heute.",
      "Wähle `Hinweis für die OGS`.",
      "Wähle bei `Für wen ist der Hinweis?` die ganze Klasse oder ein Kind.",
      "Schreibe den Hinweis. Er darf bis zu 500 Zeichen lang sein.",
      "Wähle `Speichern`.",
    ],
    result:
      "Die OGS sieht den Hinweis sofort am Kind: in der Aufsicht, in der Gruppe und in der Kindersuche. Dort steht `Hinweis der Lehrkraft`.",
    notes: [
      "Der Hinweis gilt nur heute. Morgen ist er aus diesen Ansichten verschwunden.",
      "Wähle das Kind oder die Klasse noch einmal, um deinen Hinweis zu ändern.",
      "Mit `Hinweis löschen` nimmst du ihn zurück.",
    ],
    differences: [
      "Fehlt `Hinweis für die OGS`? Dann hat deine OGS das nicht freigegeben, oder du siehst einen anderen Tag als heute.",
      "Für Kinder ohne OGS-Betreuung kannst du keinen eigenen Hinweis schreiben.",
    ],
    related: [
      HELP_TOPICS.teacherClassDay,
      HELP_TOPICS.teacherArrivalChange,
      HELP_TOPICS.teacherMessages,
    ],
  };
}
