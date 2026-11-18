import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** Kindblatt in der laufenden Aufsicht: Abholung und Notfallkontakt. */
export function teacherSupervisionRosterTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherSupervisionRoster,
    title: "Die Kinder meiner Aufsicht sehen",
    question: "Wer darf ein Kind abholen und wen rufe ich im Notfall an?",
    summary:
      "In einer laufenden Aufsicht siehst du Abholung und Notfallkontakt.",
    group: "aufsicht",
    audience: "teacher",
    icon: "User",
    steps: [
      "Starte deine Aufsicht.",
      "Wähle ein Kind aus der Liste.",
      "Lies unter `Heute` die Zeiten des Kindes.",
      "Unter `Darf abholen` steht, wer es abholen darf.",
      "Unter `Im Notfall anrufen` stehen die Notfallkontakte.",
    ],
    result:
      "Du kannst ein Kind sicher übergeben, ohne im OGS-Team nachzufragen.",
    notes: [
      "Diese Angaben siehst du nur zu Kindern deiner laufenden Aufsicht.",
      "Jeder Zugriff wird protokolliert.",
    ],
    differences: [
      "In der `Klassenansicht` fehlen `Darf abholen` und `Im Notfall anrufen`. Das ist Absicht.",
    ],
    troubleshootingDetails: [
      "Ein Kontakt fehlt oder stimmt nicht? Melde das dem OGS-Team. Ändern kannst du es hier nicht.",
    ],
    related: [
      HELP_TOPICS.teacherStartSupervision,
      HELP_TOPICS.teacherChildDetails,
      HELP_TOPICS.teacherSupervision,
    ],
  };
}
