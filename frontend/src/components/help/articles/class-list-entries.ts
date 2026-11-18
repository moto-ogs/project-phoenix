import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Klassenlisteneintraege unter `/database/students/class-list` (#2382):
 * Kinder ohne OGS-Betreuung, damit Klassenlisten vollstaendig sind.
 */
export function classListEntriesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadClassListEntries,
    title: "Kinder ohne OGS-Betreuung erfassen",
    question: "Wie erfasse ich Kinder, die nicht in der OGS sind?",
    summary: "Für vollständige Klassenlisten erfasse auch diese Kinder.",
    group: "kinderdaten",
    audience: "lead",
    icon: "ClipboardList",
    steps: [],
    instructionGroups: [
      {
        title: "Einen Eintrag anlegen",
        steps: [
          "Öffne `Datenverwaltung` und danach `Kinderdaten`.",
          "Öffne oben rechts das Menü mit den drei Punkten.",
          "Wähle `Klassenliste`.",
          "Wähle oben rechts `+ Eintrag`.",
          "Trage Vorname, Nachname und Klasse ein.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Viele Einträge auf einmal",
        steps: [
          "Öffne `Klassenliste`.",
          "Öffne oben das Menü mit den drei Punkten.",
          "Wähle `Sammelimport`.",
          "Folge den Schritten auf der Seite.",
        ],
      },
    ],
    result:
      "Das Kind erscheint auf den Klassenlisten, aber nicht in der Betreuung.",
    notes: [
      "Du kannst ein Kind auch beim Anlegen über `Nur Klassenliste` erfassen.",
      "Schreibe die Klasse genau wie bei den regulären Kindern.",
    ],
    differences: [
      "Oben steht, dass deine Schule Kinder ohne OGS-Platz als eigene Kinder führt, und `+ Eintrag` fehlt? Dann hat das moto-Team das eingeschaltet. Die Einträge sind dabei zu Kindern geworden. Neue Kinder legst du in den `Kinderdaten` mit `Ohne OGS-Platz` an. Ein `Sammelimport` legt sie ebenfalls als Kinder an.",
      "Ein Eintrag trägt `Mögliche Dublette`? Dann gibt es ein reguläres Kind mit demselben Namen in derselben Klasse.",
      "Ein Eintrag trägt `In moto angelegt`? Dann ist es ein reguläres Kind. Gepflegt wird es unter `Kinderdaten`.",
    ],
    troubleshootingDetails: [
      "Kommt das Kind doch in die Betreuung? Ordne den Eintrag dem regulären Kind zu. Der Eintrag verschwindet dann aus der Klassenliste.",
    ],
    related: [
      HELP_TOPICS.leadCreateStudent,
      HELP_TOPICS.leadDayLists,
      HELP_TOPICS.leadManageStudent,
    ],
  };
}
