import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** Problemartikel: fehlende Bereiche haengen an den Schaltern der OGS. */
export function parentFeatureMissingTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentFeatureMissing,
    title: "Eine Funktion ist für mich nicht verfügbar",
    question: "Warum fehlt mir ein Bereich im Elternportal?",
    summary: "Jede OGS schaltet selbst frei, was Eltern sehen und tun dürfen.",
    group: "probleme",
    audience: "parent",
    icon: "EyeSlash",
    steps: [
      "Prüfe, ob der Bereich hinter `Mehr` liegt.",
      "Fehlt er auch dort, nutzt deine OGS ihn nicht.",
      "Brauchst du ihn, schreibe der OGS eine Nachricht.",
    ],
    result: "Die OGS kann die Funktion für deine Schule einschalten.",
    notes: [
      "moto blendet einen Bereich aus, statt ihn zu sperren. Ein fehlender Eintrag ist kein Fehler.",
      "`Elternbriefe` und `Mittagessen` gibt es nur, wenn deine Schule sie führt.",
    ],
    differences: [
      "Manche Dinge darfst du nur ansehen, nicht ändern. Dann fehlt der Knopf, nicht der Bereich.",
      "Hat dein Kind keinen Platz in der OGS, fehlen für dieses Kind Abholung, Betreuungszeiten, Essen und Nachrichten an die OGS. Krankmeldung, Elternbriefe und Elternsprechtag nutzt du wie gewohnt.",
    ],
    troubleshootingDetails: [
      "Das Ändern von Angaben ist deaktiviert? Schreibe der OGS, was geändert werden soll.",
    ],
    related: [
      HELP_TOPICS.parentMessages,
      HELP_TOPICS.parentChildData,
      HELP_TOPICS.parentChildMissing,
    ],
  };
}
