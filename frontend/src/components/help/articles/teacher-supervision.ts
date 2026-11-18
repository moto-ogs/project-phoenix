import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/school/aufsichten`: die eigenen Dienste des Tages. */
export function teacherSupervisionTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherSupervision,
    title: "Meine Aufsichten ansehen",
    question: "Wann habe ich heute Aufsicht?",
    summary: "Unter `Meine Aufsichten` stehen deine eigenen Dienste des Tages.",
    group: "aufsicht",
    audience: "teacher",
    icon: "Eye",
    steps: [
      "Öffne `Meine Aufsichten`.",
      "Lies, welche Aufsichten heute für dich eingeteilt sind.",
      "Wähle eine Aufsicht, um Einzelheiten zu sehen.",
    ],
    result: "Du siehst Zeit, Raum und die Kinder deiner Aufsicht.",
    notes: [
      "Mit `Zurück zu allen Aufsichten heute` kommst du zurück zur Übersicht.",
    ],
    differences: [
      "Eine Aufsicht trägt `Fällt aus`? Dann findet sie heute nicht statt.",
      "Vertrittst du jemanden, steht das an der Aufsicht.",
    ],
    troubleshootingDetails: [
      "Die Liste ist leer? Dann bist du heute nicht für eine Aufsicht eingeteilt. Eingeteilt wird im OGS-Team.",
    ],
    related: [
      HELP_TOPICS.teacherStartSupervision,
      HELP_TOPICS.teacherSupervisionRoster,
      HELP_TOPICS.teacherClassDay,
    ],
  };
}
