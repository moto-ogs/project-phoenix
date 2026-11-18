import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function loginProblemTopic(nfcEnabled: boolean | null): HelpTopic {
  return {
    id: HELP_TOPICS.loginProblem,
    title: "Ich kann mich nicht anmelden",
    question: "Was kann ich tun, wenn die Anmeldung nicht klappt?",
    summary:
      "Prüfe die Seite deiner OGS, deine E-Mail-Adresse und dein Passwort.",
    group: "probleme",
    audience: ["caregiver", "lead"],
    icon: "KeyRound",
    steps: [
      "Prüfe, ob du die moto-Seite deiner OGS geöffnet hast.",
      "Gib deine E-Mail-Adresse erneut vollständig ein.",
      "Prüfe Groß- und Kleinschreibung sowie versehentliche Leerzeichen im Passwort.",
      "Wähle `Passwort vergessen?`, wenn du dein Passwort nicht mehr weißt.",
      "Öffne die E-Mail von moto und folge dem Link zum neuen Passwort.",
      "Fragt moto nach einem Sicherheitscode? Prüfe dein E-Mail-Postfach und den Spam-Ordner.",
      "Hast du mehrfach ein falsches Passwort eingegeben? Warte 15 Minuten. Versuche es danach erneut.",
      "Ein Passwortwechsel verkürzt diese Wartezeit nicht.",
      "Versuche die Anmeldung mit dem neuen Passwort erneut.",
      "Klappt die Anmeldung weiterhin nicht? Wende dich an deine Leitung.",
      "Bitte um eine Prüfung von Konto und Einladung.",
    ],
    result:
      "Mit einem aktiven Konto und den richtigen Zugangsdaten gelangst du wieder in moto.",
    differences: [
      "Eine abgelaufene oder bereits verwendete Einladung kann nicht noch einmal angenommen werden.",
      // Ohne NFC gibt es kein Tablet und keine Geraete-PIN. Der Hinweis
      // schickt dann auf die Suche nach etwas, das es nicht gibt.
      ...(nfcEnabled === false
        ? []
        : [
            "Die vierstellige Geräte-PIN des NFC-Tablets ist nicht dein persönliches moto-Passwort.",
          ]),
      "Ein Sicherheitscode kann nur für kurze Zeit verwendet werden. Fordere bei Bedarf einen neuen Code an.",
    ],
    related: [HELP_TOPICS.login, HELP_TOPICS.acceptInvitation],
  };
}
