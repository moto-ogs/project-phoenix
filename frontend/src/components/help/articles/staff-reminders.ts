import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** Die ganze Liste der Erinnerungen unter `/reminders` (#7568). */
export function staffRemindersTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.staffReminders,
    title: "Erinnerungen ansehen",
    question: "Was steht heute noch an?",
    summary:
      "Hier siehst du anstehende und überfällige Abholungen und Aktivitäten.",
    group: "tagesplanung",
    audience: ["caregiver", "lead"],
    icon: "Bell",
    steps: [
      "Die Überschrift zeigt, worum es geht. Zum Beispiel `Anstehende Abholung`.",
      "Die Uhrzeit rechts zeigt, wann etwas ansteht.",
      "`Überfällige` heißt: Die Zeit ist schon vorbei.",
      "Unter `AG dauert länger` stehen Aktivitäten, die noch laufen.",
    ],
    notes: [
      "Am Computer öffnest du die Liste in der Glocke mit `Alle ansehen`.",
      "Auf dem Handy wählst du `Mehr`, `Benachrichtigungen` und `Alle ansehen`.",
    ],
    related: [HELP_TOPICS.staffNotifications, HELP_TOPICS.dayPlan],
  };
}
