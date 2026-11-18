import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function sharedFilesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.sharedFiles,
    title: "Eine gemeinsame Datei öffnen oder hochladen",
    question: "Wie öffne oder teile ich eine gemeinsame Datei?",
    summary: "Nutze die gemeinsame Dateiablage deiner OGS.",
    group: "team",
    audience: ["caregiver", "lead"],
    icon: "FolderOpen",
    steps: [],
    instructionGroups: [
      {
        title: "Eine Datei öffnen",
        steps: [
          "Klappe in der Seitenleiste `Team` auf und öffne `Dateien`.",
          "Wähle links unter `Ordner` den passenden aus.",
          "Suche die Datei in der Liste.",
          // Live geprueft: die Aktionen liegen im Zeilenmenue und heissen
          // `Öffnen` und `Herunterladen`.
          "Öffne am Ende der Zeile das Menü mit den drei Punkten.",
          "Wähle `Öffnen` oder `Herunterladen`.",
        ],
      },
      {
        title: "Eine Datei hochladen",
        steps: [
          "Öffne den passenden Ordner.",
          "Wähle `Dateien auswählen`.",
          "Wähle die Datei auf deinem Gerät aus.",
          "Warte auf die Bestätigung.",
        ],
      },
    ],
    result:
      "Die Datei steht den berechtigten Personen im Ordner zur Verfügung.",
    differences: [
      "Welche Ordner du siehst, hängt von deiner Rolle ab.",
      "Fehlt `Dateien auswählen`? Dann darfst du in diesem Ordner nur lesen.",
    ],
    notes: [
      "Speichere persönliche Angaben nur in einem dafür vorgesehenen und geschützten Ordner.",
      "Lege keine zweite Datei mit fast gleichem Namen an. Prüfe zuerst, ob bereits eine aktuelle Fassung vorhanden ist.",
    ],
    related: [HELP_TOPICS.missingMenu, HELP_TOPICS.leadMissingMenu],
  };
}
