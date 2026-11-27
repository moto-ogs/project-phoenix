import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/parents/children/<id>/elternsprechtag`: Termin buchen (#4801). */
export function parentConferenceTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentConference,
    title: "Einen Termin am Elternsprechtag buchen",
    question: "Wie buche ich einen Termin bei der Lehrkraft?",
    summary:
      "Bietet die Lehrkraft einen Elternsprechtag an, buchst du eine freie Zeit für dein Kind.",
    group: "nachrichten",
    audience: "parent",
    icon: "CalendarPlus",
    steps: [
      "Tippe unten auf `Mein Kind`.",
      "Hast du mehrere Kinder, wähle oben das Kind.",
      "Wähle bei `Elternsprechtag` die Schaltfläche `Termin buchen`.",
      "Tippe unter `Freie Zeiten` auf eine Uhrzeit.",
    ],
    result:
      "Der Termin ist gebucht. Er steht in deinem Kalender, und du bekommst eine Nachricht.",
    notes: [
      "Du buchst einen Termin pro Kind. Hast du zwei Kinder in der Klasse, buche für jedes Kind einzeln.",
      "Tippe auf eine andere Zeit, um deinen Termin zu verschieben. Mit `Termin absagen` sagst du ab.",
    ],
    differences: [
      "Du siehst Zeiten ohne Schaltflächen? Für dieses Kind darfst du nicht buchen. Frage bei Bedarf die Schule.",
      "Du siehst nur freie Zeiten. Was andere Familien gebucht haben, siehst du nicht.",
      "Ändert die Lehrkraft den Tag oder sagt ihn ab, bekommst du eine Nachricht.",
    ],
    troubleshootingDetails: [
      "Du siehst keinen `Elternsprechtag`? Dann bietet die Lehrkraft der Klasse zurzeit keinen an.",
      "Du kannst nicht mehr buchen oder absagen? Bis 24 Stunden vor dem Termin ist das in der App möglich. Danach wende dich direkt an die Lehrkraft.",
    ],
    related: [HELP_TOPICS.parentCalendar, HELP_TOPICS.parentChildOverview],
  };
}
