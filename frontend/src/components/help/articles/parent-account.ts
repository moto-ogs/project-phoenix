import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Einladung annehmen unter `/parents/accept-guardian-invite/[token]`. Die
 * Passwortregeln stehen im Formular selbst (i18n `guardianInvite.passwordRules`).
 */
export function parentAccountTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentAccount,
    title: "Mein Eltern-Konto einrichten",
    question: "Wie richte ich mein Eltern-Konto ein?",
    summary: "Du öffnest den Link aus der E-Mail und legst dein Passwort fest.",
    group: "einstieg",
    audience: "parent",
    icon: "KeyRound",
    requirements: ["Du hast eine Einladungs-E-Mail deiner OGS bekommen."],
    steps: [
      "Öffne den Link aus der E-Mail.",
      "Prüfe oben, für welche Schule die Einladung gilt.",
      "Trage bei `Passwort` dein neues Passwort ein.",
      "Trage es bei `Passwort bestätigen` noch einmal ein.",
      "Wähle `Einladung akzeptieren`.",
      "Melde dich danach mit deiner E-Mail-Adresse und dem neuen Passwort an.",
    ],
    result:
      "Dein Konto ist angelegt. Du siehst danach dein Kind im Elternportal.",
    notes: [
      "Das Passwort braucht mindestens 8 Zeichen, einen Großbuchstaben, einen Kleinbuchstaben, eine Zahl und ein Sonderzeichen.",
      "Unter `Passwortanforderungen` siehst du, was noch fehlt.",
      "Zur Einladung bekommst du eine zweite E-Mail: `Willkommen bei moto`. Sie führt zu dieser Anleitung und zur Elterninfo. Den Link zum Einrichten findest du nur in der Einladungs-E-Mail.",
    ],
    differences: [
      "Du siehst `Konto erstellt`? Dann hat es geklappt. Melde dich jetzt an.",
    ],
    troubleshootingDetails: [
      "Die Seite sagt, die Einladung sei abgelaufen oder schon benutzt? Bitte deine OGS um eine neue Einladung.",
      "Die Seite sagt, für diese E-Mail gebe es schon ein Konto? Dann melde dich direkt an.",
    ],
    related: [
      HELP_TOPICS.parentLogin,
      HELP_TOPICS.parentAccountProblem,
      HELP_TOPICS.parentInstallApp,
    ],
  };
}
