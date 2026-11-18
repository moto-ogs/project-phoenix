import type { HelpTopic, HelpPresenceMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function manageActivityTopic(
  presenceMode: HelpPresenceMode,
  nfcEnabled: boolean | null,
): HelpTopic {
  if (nfcEnabled === false || presenceMode === "binary") {
    return {
      id: HELP_TOPICS.manageActivity,
      title: "Eine Aktivität anlegen oder ändern",
      question: "Wie lege ich eine Aktivität an oder ändere sie?",
      summary:
        nfcEnabled === false
          ? "Der Bereich ist nicht verfügbar, weil deine OGS NFC nicht nutzt."
          : "Bei einfacher Anwesenheit gibt es keine Aktivitäten mit eigener Kinderzuordnung.",
      group: "gruppen",
      audience: "caregiver",
      icon: "Sparkles",
      steps: [
        "Nutze den `Betreuungsplan`, um geplante Angebote anzusehen.",
        // Live geprueft: der Katalog `Aktivitäten` haengt an NFC, der
        // spontane Start in `Aktuelle Aufsicht` nicht.
        "Für heute kannst du in `Aktuelle Aufsicht` eine `Spontane Aktivität starten`.",
        "Frage deine Leitung, wenn ein Angebot dauerhaft geändert werden soll.",
      ],
      result:
        "Der Menüpunkt `Aktivitäten` wird in diesem Modus nicht angezeigt.",
      related: [HELP_TOPICS.carePlan, HELP_TOPICS.activeSupervision],
    };
  }
  if (nfcEnabled === null || presenceMode === "unknown") {
    return {
      id: HELP_TOPICS.manageActivity,
      title: "Eine Aktivität anlegen oder ändern",
      question: "Wie lege ich eine Aktivität an oder ändere sie?",
      summary:
        "Der Bereich erscheint nur bei NFC und detaillierter Anwesenheit.",
      group: "gruppen",
      audience: "caregiver",
      icon: "Sparkles",
      steps: [
        "Prüfe, ob `Aktivitäten` in der Seitenleiste steht.",
        "Ist der Bereich vorhanden? Wähle `Aktivität erstellen`.",
        "Fehlt der Bereich? Frage deine Leitung nach der Arbeitsweise deiner OGS.",
      ],
      result:
        "Nur verfügbare Aktivitäten können am NFC-Tablet ausgewählt werden.",
      related: [HELP_TOPICS.activeSupervision, HELP_TOPICS.carePlan],
    };
  }

  return {
    id: HELP_TOPICS.manageActivity,
    title: "Eine Aktivität anlegen oder ändern",
    question: "Wie lege ich eine Aktivität an oder ändere sie?",
    summary:
      "Lege eine Aktivität für NFC-Tablets an oder änder eine eigene Aktivität.",
    group: "gruppen",
    audience: "caregiver",
    icon: "Sparkles",
    steps: [
      "Öffne `Aktivitäten`.",
      "Wähle die Schaltfläche `Aktivität erstellen` mit dem Plus-Symbol.",
      "Gib einen kurzen Namen ein.",
      "Wähle eine Kategorie und bei Bedarf eine maximale Anzahl an Kindern.",
      "Wähle `Aktivität erstellen`.",
      "Öffne eine eigene Aktivität und wähle `Bearbeiten`, wenn du Angaben ändern möchtest.",
    ],
    result:
      "Die Aktivität ist sofort am NFC-Tablet verfügbar. Suche und Filter helfen in der Liste.",
    differences: [
      "Eine Aktivität kann am Tablet mehrfach gewählt werden. Termine mit Uhrzeit stehen im Betreuungsplan.",
      "Aktivitäten anderer Personen kannst du ansehen, aber nicht immer bearbeiten.",
      // #4767: Plätze und Warteliste einer AG.
      "Darfst du Anfragen von Eltern entscheiden? Dann siehst du bei einer Aktivität `Plätze und Warteliste`. Dort steht, wer dabei ist und wer wartet.",
    ],
    related: [HELP_TOPICS.activeSupervision, HELP_TOPICS.carePlan],
  };
}
