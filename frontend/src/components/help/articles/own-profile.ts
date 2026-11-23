import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/profile`: die eigene Seite jeder Person im Team (#7568). Abschnitte aus
 * `profile/page.tsx` und `components/settings/*-section.tsx`.
 */
export function ownProfileTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.ownProfile,
    title: "Dein Profil",
    question: "Wo ändere ich meine eigenen Angaben?",
    summary:
      "Im Profil stehen deine Angaben, dein Passwort und deine Benachrichtigungen.",
    group: "einstieg",
    audience: ["caregiver", "lead"],
    icon: "NotePencil",
    steps: [
      "Am Computer öffnest du oben rechts dein Profil. Auf dem Handy wählst du unten `Mehr` und dann `Profil`.",
      "Unter `Persönliche Daten` wählst du `Bearbeiten`, um deinen Namen zu ändern. Dann wähle `Speichern`.",
      "Unter `Passwort` wählst du `Ändern`.",
      "Mit `Profilbild ändern` oben wählst du ein neues Bild.",
      "Unter `Benachrichtigungen` legst du fest, worüber moto dich informiert.",
    ],
    notes: [
      "Weiter unten stehen auch deine Nachweise, deine Passkeys und deine vertrauten Geräte.",
      "Deine E-Mail-Adresse änderst du hier nicht. Frage dafür deine Leitung.",
    ],
    related: [
      HELP_TOPICS.staffNotifications,
      HELP_TOPICS.analyticsConsent,
      HELP_TOPICS.login,
    ],
  };
}
