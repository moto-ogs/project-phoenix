import type { HelpTopic, HelpPresenceMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function emergencyTopic(presenceMode: HelpPresenceMode): HelpTopic {
  const locationDescription =
    presenceMode === "detailed"
      ? "Bei detaillierter Anwesenheit zeigt die Liste den aktuellen Ort oder Raum des Kindes."
      : presenceMode === "binary"
        ? "Bei einfacher Anwesenheit zeigt die Liste `Anwesend` statt eines Raums."
        : "Je nach Arbeitsweise deiner OGS zeigt die Liste einen Raum oder nur `Anwesend`.";

  return {
    id: HELP_TOPICS.emergency,
    title: "Eine Notfallliste drucken",
    question: "Wie drucke ich eine Notfallliste?",
    summary:
      "Nutze die Liste zum Beispiel bei einem geplanten Feueralarm. Damit prüfst du am Sammelplatz, ob alle anwesenden Kinder da sind.",
    group: "kinder",
    audience: ["caregiver", "lead"],
    icon: "ShieldAlert",
    requirements: ["Dein Konto hat das Recht `Benutzerinformationen ansehen`."],
    steps: [],
    instructionGroups: [
      {
        title: "Die Notfallliste drucken",
        description: "Dein Gerät ist mit einem Drucker verbunden.",
        steps: [
          "Öffne unten in der Seitenleiste `Notfall`.",
          "Wähle `Notfallliste drucken`.",
          "Wähle im Druckfenster den passenden Drucker.",
          "Prüfe die Einstellungen im Druckfenster.",
          "Starte den Druck.",
        ],
      },
      {
        title: "Die Notfallliste als PDF speichern",
        steps: [
          "Öffne unten in der Seitenleiste `Notfall`.",
          "Wähle `PDF herunterladen`.",
        ],
      },
    ],
    result: [
      "Die Liste enthält alle Kinder, die beim Erstellen anwesend sind, mit ihrer Klasse und wichtigen Kontakten.",
      locationDescription,
      "Die Liste enthält auch die hinterlegten `Gesundheitsinfos`.",
      "`Nicht hinterlegt` bedeutet: Es fehlen Gesundheitsinfos, eine Allergie ist trotzdem möglich.",
    ].join(" "),
    notes: [
      "Erstelle im Notfall eine neue Liste. Ein älterer Ausdruck kann veraltet sein.",
      "Lasse den Ausdruck nicht offen liegen.",
    ],
    related: [
      HELP_TOPICS.studentSearch,
      HELP_TOPICS.dayLog,
      HELP_TOPICS.ownGroups,
    ],
  };
}
