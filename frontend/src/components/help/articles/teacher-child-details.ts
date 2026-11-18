import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Kindangaben. Die harte Grenze: Abhol- und Notfallkontakte gibt es nur zu
 * Kindern einer laufenden Aufsicht (`student-sheet-modal.tsx`).
 */
export function teacherChildDetailsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherChildDetails,
    title: "Angaben zu einem Kind ansehen",
    question: "Was sehe ich zu einem einzelnen Kind?",
    summary: "Du siehst den heutigen Tag. Kontaktdaten nur in deiner Aufsicht.",
    group: "klasse",
    audience: "teacher",
    icon: "UserRoundSearch",
    steps: [
      "Öffne die Liste deiner Klasse.",
      "Wähle das Kind aus der Liste.",
      "Lies unter `Heute`, wann es kommt und geht.",
    ],
    result:
      "Du siehst `Kommt um`, `Geht um` und `Geht so nach Hause` für den heutigen Tag.",
    notes: [
      "Mehr als den heutigen Tag zeigt moto schule nicht. Keine Stammdaten, keine Adressen.",
      "Jeder Zugriff auf die Ansicht wird protokolliert.",
    ],
    differences: [
      "In einer laufenden Aufsicht siehst du zusätzlich `Darf abholen` und `Im Notfall anrufen`.",
      "Außerhalb einer Aufsicht fehlen diese beiden Abschnitte.",
    ],
    troubleshootingDetails: [
      "Du brauchst einen Kontakt, hast aber keine Aufsicht? Frage im OGS-Team nach.",
    ],
    related: [
      HELP_TOPICS.teacherClassList,
      HELP_TOPICS.teacherSupervisionRoster,
      HELP_TOPICS.teacherMessages,
    ],
  };
}
