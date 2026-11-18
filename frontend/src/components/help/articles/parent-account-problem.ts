import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** Problemartikel: Einladung laesst sich nicht annehmen. */
export function parentAccountProblemTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentAccountProblem,
    title: "Ich kann mein Konto nicht einrichten",
    question: "Was tun, wenn die Einladung nicht funktioniert?",
    summary: "Meist ist der Link abgelaufen oder schon benutzt.",
    group: "probleme",
    audience: "parent",
    icon: "ShieldAlert",
    steps: [
      "Lies, was auf der Seite steht.",
      "Prüfe, ob du den Link schon einmal geöffnet hast.",
      "Versuche, dich direkt anzumelden.",
      "Klappt das nicht, bitte deine OGS um eine neue Einladung.",
    ],
    result: "Mit einer neuen Einladung kannst du dein Passwort festlegen.",
    notes: ["Ein Einladungslink lässt sich nur einmal benutzen."],
    differences: [
      "`Diese Einladung ist abgelaufen oder wurde bereits verwendet.` Frage nach einer neuen.",
      "`Dieser Link gilt nicht mehr.` Frage die Schule nach einer neuen Einladung.",
      "`Für diese E-Mail existiert bereits ein Konto.` Melde dich direkt an.",
      "`Das Passwort erfüllt noch nicht alle Sicherheitsanforderungen.` Prüfe die Liste unter dem Feld.",
    ],
    troubleshootingDetails: [
      "Du hast ein Konto, aber kein Passwort mehr? Nutze auf der Anmeldeseite `Passwort vergessen?`.",
    ],
    related: [
      HELP_TOPICS.parentAccount,
      HELP_TOPICS.parentLogin,
      HELP_TOPICS.parentChildMissing,
    ],
  };
}
