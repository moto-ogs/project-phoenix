import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** Aufsicht starten: erst danach zeigt moto die Kinder mit Kontakten. */
export function teacherStartSupervisionTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherStartSupervision,
    title: "Eine Aufsicht starten",
    question: "Wie starte ich meine Aufsicht?",
    summary: "Mit dem Start siehst du die Kinder, die zu dir gehören.",
    group: "aufsicht",
    audience: "teacher",
    icon: "Clock3",
    steps: [
      "Öffne `Meine Aufsichten`.",
      "Wähle die Aufsicht, die jetzt beginnt.",
      "Wähle `Aufsicht starten`.",
    ],
    result: "moto zeigt danach die Kinder dieser Aufsicht mit ihren Angaben.",
    notes: [
      "Starten kannst du erst kurz vor dem Beginn, nicht schon am Morgen.",
    ],
    differences: [
      "Ist `Aufsicht starten` grau, ist es noch zu früh oder die Aufsicht läuft schon.",
    ],
    troubleshootingDetails: [
      "Der Knopf fehlt ganz? Dann ist diese Aufsicht nicht deine. Prüfe die Übersicht.",
    ],
    related: [
      HELP_TOPICS.teacherSupervision,
      HELP_TOPICS.teacherSupervisionRoster,
      HELP_TOPICS.teacherFeatureMissing,
    ],
  };
}
