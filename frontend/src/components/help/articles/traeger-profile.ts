import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/konto` (#4693): der eigene Name im Träger-Büro. */
export function traegerProfileTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerProfile,
    title: "Eigenen Namen ändern",
    question: "Wie ändere ich meinen Namen im Träger-Portal?",
    summary:
      "Dein Name steht im Exportprotokoll und im Verlauf jeder Rechnung. So sehen andere im Träger-Büro, wer etwas getan hat.",
    group: "einstieg",
    audience: "traeger",
    icon: "UserCircle",
    steps: [
      "Öffne oben rechts das Profil-Menü.",
      "Wähle `Konto`.",
      "Wähle bei `Name` den Knopf `Bearbeiten`.",
      "Trage bei `Dein Name` deinen Namen ein.",
      "Wähle `Speichern`.",
    ],
    result:
      "Oben rechts steht sofort dein Name. Neue Einträge im Exportprotokoll und im Verlauf der Rechnungen zeigen ihn auch. Du selbst siehst dort „von dir“.",
    notes: [
      "Im Protokoll und im Verlauf steht deine E-Mail-Adresse nie. Du siehst sie im Profil-Menü unter deinem Namen und unter `Konto` bei `Anmeldung`.",
      "Deinen Namen gibst du schon beim Annehmen der Einladung an.",
      "Wer die Rolle `Leitung` hat, kann Namen auch unter `Mitglieder und Rollen` eintragen.",
      "Unter `Meine vertrauten Geräte` stehen die Geräte, die du dir beim Anmelden gemerkt hast. Öffne das Menü am Gerät und wähle `Entfernen`. Dort fragt moto beim nächsten Anmelden wieder nach dem Code.",
    ],
    troubleshootingDetails: [
      "Oben rechts steht deine E-Mail-Adresse statt eines Namens? Du hast noch keinen Namen. Trage ihn unter `Konto` ein.",
      "Im Protokoll steht „von einem Konto ohne Namen“? Diese Person hat noch keinen Namen. Sie kann ihn unter `Konto` eintragen.",
      "Im Protokoll steht „von einem gelöschten Konto“? Das Konto gibt es nicht mehr. Der Name lässt sich nicht mehr zeigen.",
    ],
    related: [HELP_TOPICS.traegerInvitation, HELP_TOPICS.traegerAccounts],
  };
}
