import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger` (#4654): Absprung in eine Schule des Trägers. */
export function traegerSchoolSwitchTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerSchoolSwitch,
    title: "In eine Schule wechseln",
    question: "Wie arbeite ich in einer Schule meines Trägers?",
    summary:
      "Du öffnest jede Schule deines Trägers, ohne sich dort neu anzumelden.",
    group: "einstieg",
    audience: "traeger",
    icon: "ArrowsLeftRight",
    requirements: ["Du hast die Rolle `Schulzugang`."],
    steps: [
      "Wähle in der Navigation `Schulen`.",
      "Wähle bei der Schule `Schul-App öffnen`. Das geht auch in der Ansicht der Schule.",
    ],
    result:
      "moto öffnet die Schule in einem neuen Tab. Dort hast du dieselben Rechte wie die Verwaltung der Schule. Mit `Zurück zur Träger-App` kommst du zurück zur Liste deiner Schulen.",
    notes: [
      "Du kannst mehrere Schulen in mehreren Tabs offen haben.",
      "Hast du in einem anderen Tab die Schule gewechselt? Dann stellt moto diesen Tab beim nächsten Klick wieder auf seine Schule um. Dieser Klick wird nicht ausgeführt. Wiederhole ihn danach.",
      "Eine neue Schule deines Trägers kannst du sofort öffnen. Niemand muss dich dafür freischalten.",
      "Jedes Öffnen steht im Protokoll der Schule.",
    ],
    differences: [
      "Auf Handy und Tablet steht `Zurück zur Träger-App` unter `Mehr`.",
      "Du siehst kein `Schul-App öffnen`? Dann hast du nicht die Rolle `Schulzugang`. Eine Person mit der Rolle `Leitung` kann sie dir geben.",
    ],
    troubleshootingDetails: [
      "moto zeigt `Die Schule konnte nicht geöffnet werden.`? Der Link gilt nur kurz und nur einmal. Öffne die Schule noch einmal im Träger-Portal.",
      "moto sagt, die Schule gehöre nicht zu deinem Träger? Lade die Seite neu. Fehlt die Schule dann, wende dich an das moto-Team.",
      "moto bittet dich, dich neu anzumelden? Melde dich im Träger-Portal neu an und öffne die Schule noch einmal.",
      "moto sagt `Diese Schule verlangt jetzt eine Anmeldung mit Code.`? Das kann auch in einem Tab der Schule kommen. Wähle `Mit Code neu anmelden`. Melde dich im Träger-Portal an. Gib nach dem Passwort den Code aus deiner E-Mail ein. Öffne die Schule dann noch einmal.",
    ],
    related: [HELP_TOPICS.traegerLogin, HELP_TOPICS.traegerSchoolView],
  };
}
