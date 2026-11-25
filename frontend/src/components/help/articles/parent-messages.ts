import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/parents/messages`: je Kind eine Unterhaltung mit dem OGS-Team. */
export function parentMessagesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentMessages,
    title: "Nachrichten lesen und schreiben",
    question: "Wie erreiche ich die OGS?",
    summary: "Du schreibst dem OGS-Team und liest seine Antworten.",
    group: "nachrichten",
    audience: "parent",
    icon: "MessageSquareText",
    steps: [
      "Tippe unten auf `Nachrichten`.",
      "Tippe auf die Unterhaltung des Kindes.",
      "Tippe unten in das Feld `Nachricht an die OGS schreiben`.",
      "Tippe rechts auf den Pfeil `Senden`.",
    ],
    result: "Die OGS bekommt deine Nachricht sofort.",
    notes: [
      "Mit `Foto oder Datei anhängen` (Büroklammer neben dem Textfeld) hängst du bis zu 5 Dateien an eine Nachricht: Fotos, PDF, Word, Excel oder PowerPoint. Pro Datei sind höchstens 10 MB erlaubt. Ein Foto öffnest du mit einem Tipp groß.",
      "Jedes Kind hat eine eigene Unterhaltung. Oben steht, für welches Kind sie gilt.",
      "Über dem Schreibfeld steht, wer mitliest, zum Beispiel `Lesen können: du und alle Mitarbeitenden der OGS.` Auf einem großen Bildschirm steht es auch oben. Andere Bezugspersonen deines Kindes lesen deine Unterhaltung nicht.",
      "Unter deiner Nachricht steht `Gesendet` und später `Von der OGS gelesen`.",
    ],
    differences: [
      "Bei einem Kind steht `Für dieses Kind kannst du nicht schreiben`? Dann darfst du den Verlauf nur lesen.",
      "Siehst du oben `Ganzes OGS-Team` und `Nur die Leitung`? Dann bietet deine OGS das an. Tippe auf `Nur die Leitung`, wenn nur die Leitung deine Nachricht lesen soll. Über dem Schreibfeld stehen dann die Namen der Leitung.",
      "Steht in der Unterhaltung mit der Leitung `Zurzeit liest niemand aus der Leitung mit`? Dann schreibe an `Ganzes OGS-Team`. Den Verlauf kannst du weiter lesen.",
    ],
    troubleshootingDetails: [
      "moto sagt, deine Sitzung sei abgelaufen? Melde dich neu an und schicke die Nachricht erneut.",
      "Es geht um eine Abwesenheit oder eine andere Abholzeit? Nutze dafür die passende Meldung statt einer Nachricht.",
    ],
    related: [
      HELP_TOPICS.parentNews,
      HELP_TOPICS.parentNotifications,
      HELP_TOPICS.parentChildOverview,
    ],
  };
}
