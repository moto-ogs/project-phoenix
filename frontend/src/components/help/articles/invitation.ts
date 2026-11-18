import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function invitationTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.acceptInvitation,
    title: "Einladung annehmen und Konto einrichten",
    question: "Wie nehme ich meine Einladung an?",
    summary:
      "Öffne deine Einladungs-Mail und lege dein persönliches Passwort fest.",
    group: "einstieg",
    audience: ["caregiver", "lead"],
    icon: "EnvelopeOpen",
    requirements: [
      "Deine Einladungs-Mail von moto",
      "Zugriff auf das E-Mail-Postfach, an das die Einladung gesendet wurde",
    ],
    steps: [
      "Öffne die Einladungs-Mail von moto.",
      "Wähle in der E-Mail `Einladung annehmen`.",
      "Prüfe oben die Zeile `Einladung für ... als ...`. Stimmt die Rolle?",
      "Prüfe unter `Gültig bis`, wie lange die Einladung gilt.",
      "Ergänze `Vorname` und `Nachname`, falls die Felder leer sind.",
      "Gib unter `Passwort` ein persönliches Passwort ein.",
      "Gib dasselbe Passwort unter `Passwort bestätigen` erneut ein.",
      "Prüfe, ob alle Passwortanforderungen einen Haken haben.",
      "Wähle `Einladung akzeptieren`.",
    ],
    result:
      "Dein moto-Konto ist eingerichtet und du kannst dich jetzt anmelden. Bewahre deine E-Mail-Adresse und dein Passwort sicher auf und gib beides nicht weiter.",
    notes: [
      "Zur Einladung bekommst du eine zweite E-Mail: `Willkommen bei moto`. Sie führt zu dieser Anleitung. Den Knopf `Einladung annehmen` findest du nur in der Einladungs-Mail.",
    ],
    differences: [
      "Steht dort `Schule hinzufügen`? Dann hast du schon ein moto-Konto. Melde dich an und wähle `Einladung annehmen`. Dein Passwort bleibt gleich.",
    ],
    troubleshootingDetails: [
      "Du findest keine Einladungs-Mail? Prüfe auch deinen Spam-Ordner. Bitte sonst deine Leitung um eine neue Einladung.",
      "Die Einladung ist abgelaufen oder wurde schon verwendet? Frag deine Leitung nach einer neuen Einladung.",
      "Die Einladung ist nicht für dich oder die Rolle ist falsch? Nimm sie nicht an und wende dich an deine Leitung.",
    ],
    related: [HELP_TOPICS.login, HELP_TOPICS.installApp],
  };
}
