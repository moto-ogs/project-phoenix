import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** Problemartikel: falsches Portal ist die haeufigste Ursache. */
export function teacherLoginProblemTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherLoginProblem,
    title: "Die Anmeldung klappt nicht",
    question: "Was tun, wenn die Anmeldung nicht klappt?",
    summary: "Meist wurde die Anmeldung der OGS statt moto schule benutzt.",
    group: "probleme",
    audience: "teacher",
    icon: "ShieldAlert",
    steps: [
      "Prüfe, ob oben `Willkommen bei moto schule` steht.",
      "Steht dort etwas anderes, nutze die Adresse von moto schule.",
      "Prüfe E-Mail-Adresse und Passwort.",
      "Nutze sonst `Passwort vergessen?`.",
    ],
    result: "Nach der Anmeldung landest du in der `Klassenansicht`.",
    notes: [
      "Der Link aus der Einladungs-E-Mail führt immer zur richtigen Adresse.",
    ],
    differences: [
      "`Dieses Konto hat keinen Zugang zu moto schule.` Dann fehlt deinem Konto die Rolle. Wende dich an die OGS-Verwaltung.",
      "`Die E-Mail-Adresse oder das Passwort stimmt nicht.` Prüfe beides.",
    ],
    troubleshootingDetails: [
      "Nach mehreren falschen Passwörtern warte bitte 15 Minuten.",
      "Ein Passwortwechsel verkürzt diese Wartezeit nicht.",
      "Du wirst immer wieder abgemeldet? Melde dich einmal neu an.",
    ],
    related: [
      HELP_TOPICS.teacherLogin,
      HELP_TOPICS.teacherAccess,
      HELP_TOPICS.teacherNoClasses,
    ],
  };
}
