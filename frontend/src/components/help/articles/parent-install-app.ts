import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Eltern-Fassung des App-Themas. Der Samsung-Hinweis ist echt und steht in
 * den Einstellungen wie im Installationshinweis (i18n `pwaInstallHint`).
 */
export function parentInstallAppTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentInstallApp,
    title: "moto als App hinzufügen",
    question: "Wie bekomme ich moto auf meinen Startbildschirm?",
    summary: "Du fügst moto zum Startbildschirm hinzu. Ohne App Store.",
    group: "einstieg",
    audience: "parent",
    icon: "Smartphone",
    steps: [],
    instructionGroups: [
      {
        title: "Auf dem iPhone oder iPad",
        steps: [
          "Öffne moto in Safari.",
          "Tippe unten auf `Teilen`.",
          "Tippe auf `Zum Home-Bildschirm`.",
        ],
      },
      {
        title: "Auf einem Android-Gerät",
        steps: [
          "Öffne moto in Chrome.",
          "Öffne das Browser-Menü.",
          "Tippe auf `App installieren` oder `Zum Startbildschirm hinzufügen`.",
        ],
      },
    ],
    result: "moto öffnet sich danach im Vollbild, ohne Browserleiste.",
    notes: [
      "Manchmal bietet moto die Installation direkt an. Dann genügt ein Tippen auf `App installieren`.",
    ],
    differences: [
      "Nutzt du Samsung Internet? Installiere moto darüber nicht. Öffne moto in Chrome und melde dich dort an.",
    ],
    troubleshootingDetails: [
      "Du findest den Punkt im Menü nicht? Prüfe, ob du wirklich in Safari oder Chrome bist.",
      "Benachrichtigungen kommen erst an, wenn moto auf dem Startbildschirm liegt.",
    ],
    related: [
      HELP_TOPICS.parentNotifications,
      HELP_TOPICS.parentLogin,
      HELP_TOPICS.parentChildOverview,
    ],
  };
}
