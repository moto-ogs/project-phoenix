import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/school/nachrichten`: derselbe Team-Chat wie in der OGS, optional. */
export function teacherMessagesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherMessages,
    title: "Nachrichten an die OGS schreiben",
    question: "Wie erreiche ich die OGS?",
    summary: "Du schreibst dem OGS-Team und liest seine Antworten.",
    group: "nachrichten",
    audience: "teacher",
    icon: "MessageSquareText",
    steps: [
      "Öffne `Nachrichten`.",
      "Wähle eine Unterhaltung. Oder wähle `Neue Nachricht`.",
      "Schreibe deine Nachricht.",
      "Sende sie ab.",
    ],
    result: "Das OGS-Team bekommt deine Nachricht sofort.",
    notes: [
      "Mit `Foto oder Datei anhängen` (Büroklammer neben dem Textfeld) hängst du bis zu 5 Dateien an eine Nachricht: Fotos, PDF, Word, Excel oder PowerPoint, je höchstens 10 MB. Ein Foto öffnest du mit einem Tipp groß.",
      "Vor deiner eigenen Nachricht steht `Du:`.",
      "Hier meldest du, was die OGS wissen muss, zum Beispiel eine falsche Abholzeit.",
      "Die OGS kann dich in einen Gruppenchat aufnehmen. Er steht dann mit seinem Namen in deiner Liste. Mit `Mitglieder` und `Gruppenchat verlassen` gehst du wieder heraus.",
    ],
    differences: [
      "Fehlt `Nachrichten` ganz? Dann nutzt deine OGS diese Funktion nicht.",
    ],
    troubleshootingDetails: [
      "Geht es um die Ankunftszeit deiner Klasse? Trage die lieber direkt ein, wenn deine OGS das freigegeben hat.",
    ],
    related: [
      HELP_TOPICS.teacherNotices,
      HELP_TOPICS.teacherSettings,
      HELP_TOPICS.teacherClassDay,
    ],
  };
}
