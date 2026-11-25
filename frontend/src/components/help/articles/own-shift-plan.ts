import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";
import {
  OWN_STAFF_PROFILE_TROUBLESHOOTING,
  SIMPLE_NAV_DIFFERENCE,
} from "../help-article-shared";

// Eigener Dienstplan (#3821): eigene Seite unter `Team`, nur lesend.
export function ownShiftPlanTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.ownShiftPlan,
    title: "Eigenen Dienstplan ansehen",
    question: "Wo sehe ich meinen Dienstplan für die Woche?",
    summary:
      "Sieh deine Schichten der Woche, die Stunden pro Dienstart und dein Soll.",
    group: "arbeitszeit",
    audience: ["caregiver", "lead"],
    icon: "CalendarCheck",
    steps: [
      "Klappe in der Seitenleiste `Team` auf und öffne `Mein Dienstplan`.",
      "Wechsle mit den Pfeilen zur gewünschten Woche. `Diese Woche` bringt dich zurück.",
    ],
    result:
      "Du siehst jede Schicht im Wochenraster. Darunter stehen die Stunden pro Tag und pro Dienstart.",
    notes: [
      "Oben stehen die geplanten Stunden, dein `Soll` und die `Differenz`.",
      "In der `Zeiterfassung` führt oben der Knopf `Mein Dienstplan` ebenfalls hierher.",
      "Das Soll ist dasselbe wie in der Zeiterfassung. Feiertage und Schließtage sind schon eingerechnet.",
      "Ist eine Woche leer, nennt die Seite deine nächste Schicht. `Zur nächsten Schicht` bringt dich zu dieser Woche.",
    ],
    differences: [
      "Auf dem Handy findest du `Mein Dienstplan` unten unter `Mehr`. Dort stehen die Schichten als Liste pro Tag statt im Wochenraster.",
      "Du kannst den Plan hier nur ansehen. Änderungen trägt die Leitung im Dienstplan ein.",
      "Auf dem Handy erscheinen Samstag und Sonntag nur mit einer Schicht. Bei einem Sonntagsdienst kann im Wochenraster auch der Samstag erscheinen.",
      SIMPLE_NAV_DIFFERENCE,
    ],
    troubleshootingDetails: [
      "`Mein Dienstplan` fehlt? Dann plant deine OGS die Schichten nicht in moto.",
      OWN_STAFF_PROFILE_TROUBLESHOOTING,
    ],
    related: [HELP_TOPICS.trackWorkTime, HELP_TOPICS.mySchedule],
  };
}
