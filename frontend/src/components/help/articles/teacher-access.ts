import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** Einladung annehmen: geteilte Strecke, danach geht es nach moto schule. */
export function teacherAccessTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherAccess,
    title: "Zugang zu moto schule einrichten",
    question: "Wie bekomme ich Zugang zu moto schule?",
    summary: "Du öffnest den Link aus der E-Mail und legst dein Passwort fest.",
    group: "einstieg",
    audience: "teacher",
    icon: "KeyRound",
    requirements: ["Du hast eine Einladungs-E-Mail der OGS bekommen."],
    steps: [
      "Öffne den Link aus der E-Mail.",
      "Lege dein Passwort fest.",
      "Nimm die Einladung an.",
      "Öffne danach moto schule und melde dich an.",
    ],
    result: "Du landest in der `Klassenansicht` mit deinen Klassen.",
    notes: [
      "Hast du schon ein Konto? Dann melde dich an und kehrst zur Einladung zurück. Dein Passwort bleibt unverändert.",
      "Der Link aus der E-Mail führt schon zur richtigen Adresse.",
      "Zur Einladung bekommst du eine zweite E-Mail: `Willkommen bei moto`. Sie führt zu dieser Anleitung. Den Link zum Annehmen findest du nur in der Einladungs-Mail.",
    ],
    differences: [
      "moto schule hat eine eigene Adresse. Über die Adresse der OGS kommst du nicht hinein.",
    ],
    troubleshootingDetails: [
      "Der Link funktioniert nicht mehr? Bitte die OGS um eine neue Einladung.",
    ],
    related: [
      HELP_TOPICS.teacherLogin,
      HELP_TOPICS.teacherLoginProblem,
      HELP_TOPICS.teacherClassDay,
    ],
  };
}
