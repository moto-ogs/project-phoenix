import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function installAppTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.installApp,
    title: "moto als App auf dem Handy oder Tablet hinzufügen",
    question: "Wie füge ich moto auf meinem Handy oder Tablet hinzu?",
    summary:
      "Füge moto zum Startbildschirm hinzu. Du brauchst dafür keinen App Store.",
    group: "einstieg",
    audience: ["caregiver", "lead"],
    icon: "Smartphone",
    requirements: [
      "Ein Handy oder Tablet",
      "Den Link zur moto-Seite deiner OGS",
      "Safari auf dem iPhone oder iPad oder Chrome auf einem Android-Gerät",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Auf dem iPhone oder iPad",
        steps: [
          "Öffne die moto-Seite deiner OGS in Safari.",
          "Melde dich bei moto an.",
          "Tippe auf das Teilen-Symbol. Wähle bei Bedarf zuerst `Mehr`.",
          "Wähle `Zum Home-Bildschirm`.",
          "Schalte `Als Web-App öffnen` ein. Wähle danach `Hinzufügen`.",
        ],
      },
      {
        title: "Auf einem Android-Handy oder Android-Tablet",
        steps: [
          "Öffne die moto-Seite deiner OGS in Chrome.",
          "Melde dich bei moto an.",
          "Ab dem zweiten Besuch erscheint der Hinweis `moto als App nutzen`.",
          "Wähle `App installieren`.",
          "Wähle im nächsten Fenster `Installieren`.",
        ],
      },
    ],
    result:
      "Auf deinem Startbildschirm erscheint ein neues moto-Symbol. Öffne moto künftig über dieses Symbol.",
    differences: [
      "Der Hinweis erscheint auf Android nicht? Öffne in Chrome die drei Punkte. Wähle `App installieren` oder `Zum Startbildschirm hinzufügen`.",
      "Nutzt du Samsung Internet? Wähle im Hinweis `In Chrome öffnen`. Führe die Schritte danach in Chrome aus.",
      "`Unsichere App blockiert` erscheint? moto selbst ist nicht unsicher. Aktualisiere im Play Store Chrome und Google Play. Starte das Gerät neu. Versuche es danach erneut.",
      "Arbeitest du für mehrere Einrichtungen? Füge jede Einrichtung einzeln zum Startbildschirm hinzu.",
    ],
    related: [
      HELP_TOPICS.login,
      HELP_TOPICS.mySchedule,
      HELP_TOPICS.leadGoLive,
    ],
  };
}
