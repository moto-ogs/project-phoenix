import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `Beobachtungen der OGS` (`student-row.tsx`, `/school/klasse/kind`, #4797).
 * Nur die Lehrkraft der Klasse; nur Notizen, die die OGS freigegeben hat.
 */
export function teacherSharedNotesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherSharedNotes,
    title: "Beobachtungen der OGS lesen",
    question: "Was hat die OGS über ein Kind meiner Klasse notiert?",
    summary:
      "Du liest die Notizen, die die OGS für die Schule freigegeben hat.",
    group: "klasse",
    audience: "teacher",
    icon: "FileText",
    steps: [
      "Öffne die Liste deiner Klasse.",
      "Wähle beim Kind `Beobachtungen der OGS`.",
      "Lies die Notizen. Die neueste steht oben.",
    ],
    result:
      "Du siehst jede Notiz mit Tag und dem Namen der Person aus der OGS, die sie geschrieben hat.",
    notes: [
      "Du kannst die Notizen nur lesen. Ändern oder beantworten kannst du sie nicht.",
      "Jeder Abruf wird protokolliert.",
      "Fragen zu einer Notiz klärst du direkt mit der OGS, zum Beispiel über `Nachrichten`.",
    ],
    differences: [
      "Fehlt `Beobachtungen der OGS`? Dann bist du der Klasse nicht als Lehrkraft zugewiesen. Die Schulverwaltung sieht die Notizen nicht.",
      "Steht dort `Keine Beobachtungen`? Dann hat die OGS für dieses Kind nichts freigegeben.",
    ],
    troubleshootingDetails: [
      "Eine Notiz ist verschwunden? Dann hat die OGS die Freigabe zurückgenommen.",
    ],
    related: [
      HELP_TOPICS.teacherClassList,
      HELP_TOPICS.teacherDayHint,
      HELP_TOPICS.teacherMessages,
    ],
  };
}
