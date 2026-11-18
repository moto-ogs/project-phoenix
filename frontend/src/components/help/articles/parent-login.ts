import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/parents/login`. Eigenes Portal mit eigener Adresse: ein Personalkonto
 * wird hier abgewiesen (i18n `parentLogin.errors.notAGuardian`).
 */
export function parentLoginTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentLogin,
    title: "Bei moto anmelden",
    question: "Wie melde ich mich im Elternportal an?",
    summary:
      "Das Elternportal hat eine eigene Adresse und eigene Zugangsdaten.",
    group: "einstieg",
    audience: "parent",
    icon: "LogIn",
    steps: [
      "Öffne die Adresse des Elternportals.",
      "Trage deine `E-Mail-Adresse` ein.",
      "Trage dein `Passwort` ein.",
      "Wähle `Anmelden`.",
    ],
    result: "moto öffnet die Startseite mit dem heutigen Tag deines Kindes.",
    notes: [
      "Mit dem Augensymbol siehst du dein Passwort im Klartext.",
      "Lege dir die Adresse als Lesezeichen an. Oder füge moto zum Startbildschirm hinzu.",
    ],
    differences: [
      "Du hast die `Anmeldung mit Code` eingeschaltet? Dann schickt moto nach dem Passwort einen Code an deine E-Mail-Adresse. Trage ihn ein und wähle `Ja, merken und anmelden` oder `Nein, nur anmelden`.",
      "Passwort vergessen? Wähle `Passwort vergessen?`. Es öffnet sich das Fenster `Passwort zurücksetzen`. Trage deine E-Mail-Adresse ein und wähle `Link senden`. Den Link bekommst du per E-Mail.",
    ],
    troubleshootingDetails: [
      "Nach mehreren falschen Passwörtern warte bitte 15 Minuten.",
      "Ein Passwortwechsel verkürzt diese Wartezeit nicht.",
      "moto sagt, das Konto gehöre zum Personal einer Schule? Dann melde dich über die Schul-Anmeldung an.",
      "moto sagt, dein Konto sei deaktiviert? Wende dich an deine OGS.",
      "moto sagt, deine Schule nutze das Elternportal zurzeit nicht? Dann bietet deine Schule das Elternportal nicht an. Frage bei deiner Schule nach.",
    ],
    related: [
      HELP_TOPICS.parentSignInCode,
      HELP_TOPICS.parentAccount,
      HELP_TOPICS.parentChildOverview,
      HELP_TOPICS.parentAccountProblem,
    ],
  };
}
