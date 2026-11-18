import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/invite` (#4650, #4693): Einladung aus der Mail annehmen, mit Namen. */
export function traegerInvitationTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerInvitation,
    title: "Einladung ins Träger-Büro annehmen",
    question: "Wie nehme ich eine Einladung ins Träger-Büro an?",
    summary:
      "Du hast eine E-Mail mit einer Einladung bekommen. So kommst du ins Träger-Portal.",
    group: "einstieg",
    audience: "traeger",
    icon: "UserRoundPlus",
    requirements: [
      "Das moto-Team oder jemand aus dem Träger-Büro hat dich per E-Mail eingeladen.",
    ],
    steps: [
      "Öffne die E-Mail `Einladung ins Träger-Portal von moto`.",
      "Wähle `Einladung annehmen`.",
      "Trage bei `Dein Name` deinen Namen ein. Personen im Träger-Büro sehen ihn im Exportprotokoll und im Verlauf jeder Rechnung.",
      "Hast du noch kein moto-Konto? Trage ein `Neues Passwort` ein und wiederhole es.",
      "Hast du schon ein moto-Konto? Trage das Passwort dieses Kontos ein.",
      "Wähle `Einladung annehmen`.",
      "moto öffnet die Anmeldung des Träger-Portals. Melde dich mit deiner E-Mail-Adresse und dem Passwort an.",
      "Beim ersten Anmelden richtest du den Code ein. Wähle `Code an meine E-Mail senden`.",
      "Öffne die E-Mail von moto. Gib den sechsstelligen Code ein.",
      "Wähle `Weiter zum Dashboard`.",
    ],
    result:
      "moto öffnet die Seite `Schulen`. Was du siehst, hängt von deiner Rolle ab.",
    notes: [
      "Mit derselben E-Mail-Adresse und demselben Passwort meldest du dich später an.",
      "Ein Konto in einer Schule brauchst du dafür nicht.",
      "Deinen Namen änderst du später im Profil-Menü unter `Konto`.",
    ],
    troubleshootingDetails: [
      "moto sagt, die Einladung sei abgelaufen? Frag das Träger-Büro oder das moto-Team nach einer neuen Einladung.",
      "Du kennst das Passwort deines vorhandenen moto-Kontos nicht mehr? Wähle in der Anmeldung des Träger-Portals `Passwort vergessen?`.",
    ],
    related: [HELP_TOPICS.traegerLogin, HELP_TOPICS.traegerProfile],
  };
}
