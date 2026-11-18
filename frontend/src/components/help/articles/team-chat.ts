import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";
import { SIMPLE_NAV_DIFFERENCE } from "../help-article-shared";

export function teamChatTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teamChat,
    title: "Den Team-Chat nutzen",
    question: "Wie nutze ich den Team-Chat?",
    summary:
      "Schreibe einer Person oder mehreren Personen deiner Schule, auch Lehrkräften.",
    group: "team",
    audience: ["caregiver", "lead"],
    icon: "ChatsCircle",
    steps: [],
    instructionGroups: [
      {
        title: "Einer Person schreiben",
        ordered: true,
        steps: [
          "Klappe in der Seitenleiste `Team` auf und öffne `Team-Chat`.",
          "Wähle `Neue Nachricht`.",
          "Suche die Person und wähle sie aus.",
          "Schreibe deine Nachricht.",
          "Wähle `Senden`.",
        ],
      },
      {
        title: "Einen Gruppenchat anlegen",
        description:
          "Ein Gruppenchat hat einen Namen und mehrere Mitglieder, auch Lehrkräfte.",
        ordered: true,
        steps: [
          "Öffne `Team-Chat`.",
          "Wähle `Neuer Gruppenchat`.",
          "Gib einen Namen ein, zum Beispiel `Frühbetreuung`.",
          "Kreuze die Personen an. Du selbst bist automatisch dabei.",
          "Wähle `Gruppenchat anlegen`.",
        ],
      },
      {
        title: "Mitglieder ändern oder den Gruppenchat verlassen",
        description:
          "Mitglieder und Namen ändern die Person, die den Gruppenchat angelegt hat, und die OGS-Leitung, wenn sie Mitglied ist.",
        ordered: true,
        steps: [
          "Öffne den Gruppenchat.",
          "Wähle oben `Mitglieder`.",
          "Ändere den Namen, wähle `Personen hinzufügen` oder entferne eine Person über das Menü neben ihrem Namen.",
          "Mit `Gruppenchat verlassen` gehst du selbst aus dem Gruppenchat.",
        ],
      },
    ],
    result:
      "Die Nachricht erscheint in der Unterhaltung. Lehrkräfte lesen sie in moto schule.",
    differences: [
      "Nachrichten im Team-Chat können nicht nachträglich geändert oder gelöscht werden.",
      "Der Bereich fehlt? Dann hat deine OGS den Team-Chat nicht eingeschaltet.",
      "Neue Mitglieder eines Gruppenchats sehen die Nachrichten ab ihrem Beitritt, nicht die älteren.",
      SIMPLE_NAV_DIFFERENCE,
    ],
    notes: [
      "Mit `Foto oder Datei anhängen` (Büroklammer neben dem Textfeld) hängst du bis zu 5 Dateien an eine Nachricht: Fotos, PDF, Word, Excel oder PowerPoint, je höchstens 10 MB. Ein Foto öffnest du mit einem Tipp groß.",
      "Unter deiner Nachricht in einem Gruppenchat steht, wie viele sie gelesen haben. Tippe darauf, dann siehst du die Namen.",
      "Eltern können den Team-Chat nicht sehen. Für Eltern nutzt du `Nachrichten` im Bereich `Eltern`.",
      "Mit `Nur ungelesen` siehst du nur Unterhaltungen mit neuen Nachrichten.",
    ],
    related: [HELP_TOPICS.findStaff, HELP_TOPICS.parentMessage],
  };
}
