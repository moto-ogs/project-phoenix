import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/parents/messages/group/…`: Gruppennachrichten der OGS lesen und
 * beantworten (#4784). Die Antwort geht nur an die OGS.
 */
export function parentGroupMessagesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentGroupMessages,
    title: "Gruppennachrichten lesen und beantworten",
    question: "Was ist eine Gruppennachricht?",
    summary:
      "Die OGS schreibt allen Eltern einer Gruppe, Klasse oder AG. Deine Antwort lesen nur die OGS.",
    group: "nachrichten",
    audience: "parent",
    icon: "UsersThree",
    steps: [
      "Tippe unten auf `Nachrichten`.",
      "Tippe unter `Gruppennachrichten der OGS` auf die Nachricht.",
      "Tippe unter `Antwort an die OGS` in das Feld `Antwort an die OGS schreiben`.",
      "Tippe rechts auf den Pfeil `Senden`.",
    ],
    result:
      "Deine Antwort steht danach im Chat mit der OGS zu deinem Kind. Andere Eltern sehen sie nicht.",
    notes: [
      "Fotos öffnest du mit einem Tipp groß. Andere Dateien lädst du mit dem Pfeil herunter. An deine Antwort kannst du mit `Foto oder Datei anhängen` selbst Dateien hängen.",
      "Du siehst nicht, welche anderen Eltern die Nachricht bekommen.",
      "Haben mehrere deiner Kinder die Nachricht bekommen? Dann wähle vor dem Senden das Kind.",
      "Unter `Antwort an die OGS` steht, wer deine Antwort lesen kann.",
    ],
    differences: [
      "Steht dort `Diese Gruppennachricht ist geschlossen`? Dann kannst du nicht mehr antworten. Schreibe der OGS im Chat zu deinem Kind.",
    ],
    related: [HELP_TOPICS.parentMessages, HELP_TOPICS.parentNotifications],
  };
}
