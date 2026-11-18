import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Hausaufgaben (#4796): die Lehrkraft trägt sie für ihre Klasse und einen
 * Tag ein und sieht je Kind die Rückmeldung der OGS aus der Lernzeit.
 */

export function teacherHomeworkTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherHomework,
    title: "Hausaufgaben eintragen",
    question: "Wie trage ich Hausaufgaben für meine Klasse ein?",
    summary:
      "Du trägst ein, was die Klasse an einem Tag tun soll. Die OGS meldet je Kind zurück.",
    group: "klasse",
    audience: "teacher",
    icon: "NotePencil",
    steps: [],
    instructionGroups: [
      {
        title: "Hausaufgaben eintragen",
        steps: [
          "Öffne in der `Klassenansicht` deine Klasse und den Tag.",
          "Tippe unter `Hausaufgaben` auf `Hausaufgaben eintragen`.",
          "Schreibe bei Bedarf das `Fach (freiwillig)`.",
          "Schreibe unter `Was ist zu tun?`, was die Kinder machen sollen.",
          "Tippe auf `Speichern`.",
        ],
      },
      {
        title: "Einen Eintrag ändern oder löschen",
        steps: [
          "Tippe beim Eintrag auf die drei Punkte.",
          "Wähle `Ändern` oder `Löschen`.",
        ],
      },
      {
        title: "Die Rückmeldung der OGS lesen",
        steps: [
          "Öffne in der `Klassenansicht` den Tag der Hausaufgaben.",
          "Beim Kind steht `Hausaufgaben: Fertig`, `Nicht fertig` oder `War schwer`.",
          "Eine Notiz der OGS steht unter dem Namen, mit `OGS:` davor.",
        ],
      },
    ],
    result:
      "Die OGS sieht die Hausaufgaben in der Lernzeit bei jedem Kind der Klasse.",
    notes: [
      "Für einen Tag kannst du mehrere Einträge machen, zum Beispiel einen je Fach.",
      "Jede Lehrkraft der Klasse kann alle Einträge ändern oder löschen. Auch die Einträge der anderen.",
      "Führst du selbst eine Lernzeit unter `Meine Aufsichten`? Dann gibst du die Rückmeldung dort mit `Hausaufgaben`.",
      "Eltern sehen weder die Hausaufgaben noch die Rückmeldung.",
    ],
    differences: [
      "Fehlen `Hausaufgaben eintragen` und die drei Punkte? Dann darf deine Rolle keine Hausaufgaben eintragen. Frage die OGS.",
    ],
    related: [
      HELP_TOPICS.teacherClassList,
      HELP_TOPICS.teacherClassDay,
      HELP_TOPICS.teacherSupervision,
    ],
  };
}
