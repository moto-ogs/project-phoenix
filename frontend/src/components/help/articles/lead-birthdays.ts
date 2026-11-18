import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Die beiden Geburtstags-Schalter der Schule (#1542) stehen seit #3737 in
 * `Einstellungen` unter `Startseite für alle`, direkt an der Karte
 * `Geburtstage`. Beschriftungen live geprüft.
 */
export function leadBirthdaysTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadBirthdays,
    title: "Geburtstage auf der Startseite zeigen",
    question: "Wie zeige ich Geburtstage auf der Startseite?",
    summary:
      "Die Startseite zeigt, wer in dieser Woche Geburtstag hat. Du legst fest, ob auch das Team dabei ist.",
    group: "konfiguration",
    audience: "lead",
    icon: "Sparkles",
    steps: [
      "Öffne unten in der Seitenleiste `Einstellungen`.",
      "Wähle oben `Startseite für alle`.",
      "Gehe zur Karte `Geburtstage`.",
      "Schalte `Geburtstage auf der Startseite` ein oder aus.",
      "Sollen auch Mitarbeitende erscheinen? Schalte `Geburtstage von Mitarbeitenden mitanzeigen` ein.",
      "Wähle `Speichern`.",
    ],
    result:
      "Die Karte `Geburtstage` zeigt die Geburtstage der Woche. Mitarbeitende erscheinen ohne Geburtsjahr.",
    notes: [
      "Jede Person kann sich im eigenen Profil von der Anzeige abmelden.",
      "Kinder ohne hinterlegtes Geburtsdatum erscheinen nicht.",
    ],
    differences: [
      "Sind die Geburtstage ausgeschaltet, fehlen die Vorgabe für die Karte und der Schalter für Mitarbeitende.",
      "Du siehst `Startseite für alle` nicht? Dann fehlt dir das Recht, Einstellungen zu ändern.",
    ],
    related: [HELP_TOPICS.leadParentVisibility],
  };
}
