import type { HelpTopic, HelpGroupMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function transferGroupTopic(groupMode: HelpGroupMode): HelpTopic {
  if (groupMode === "open_care") {
    return {
      id: HELP_TOPICS.transferGroup,
      title: "Meine Gruppe vorübergehend übergeben",
      question: "Wie übergebe ich meine Gruppe vorübergehend?",
      summary:
        "Bei offener Betreuung gibt es keine feste eigene Gruppe zum Übergeben.",
      group: "gruppen",
      audience: ["caregiver", "lead"],
      icon: "ArrowsLeftRight",
      steps: [
        "Du musst keine Gruppe übergeben.",
        "Öffne `Alle Kinder`, um mit den Kindern der OGS zu arbeiten.",
      ],
      result:
        "Alle Betreuungskräfte arbeiten ohne feste Gruppenzuordnung mit der gemeinsamen Kinderliste.",
      related: [HELP_TOPICS.ownGroups, HELP_TOPICS.studentSearch],
    };
  }
  if (groupMode === "unknown") {
    return {
      id: HELP_TOPICS.transferGroup,
      title: "Meine Gruppe vorübergehend übergeben",
      question: "Wie übergebe ich meine Gruppe vorübergehend?",
      summary: "Eine Übergabe ist nur bei festen Gruppen möglich.",
      group: "gruppen",
      audience: ["caregiver", "lead"],
      icon: "ArrowsLeftRight",
      steps: [
        "Prüfe, ob `Gruppen` in der Seitenleiste steht.",
        "Ist der Bereich vorhanden? Öffne deine Gruppe und das Menü mit den drei Punkten.",
        "Fehlt der Bereich? Dann musst du keine feste Gruppe übergeben.",
      ],
      result: "Eine andere Betreuungskraft erhält Zugriff bis zum Tagesende.",
      related: [HELP_TOPICS.ownGroups, HELP_TOPICS.missingChildOrGroup],
    };
  }

  return {
    id: HELP_TOPICS.transferGroup,
    title: "Meine Gruppe vorübergehend übergeben",
    question: "Wie übergebe ich meine Gruppe vorübergehend?",
    summary:
      "Gib einer anderen Betreuungskraft bis zum Tagesende Zugriff auf deine Gruppe.",
    group: "gruppen",
    audience: ["caregiver", "lead"],
    icon: "ArrowsLeftRight",
    requirements: ["Du bist dieser Gruppe fest zugeordnet."],
    steps: [],
    instructionGroups: [
      {
        title: "Gruppe übergeben",
        steps: [
          "Öffne deine Gruppe unter `Gruppen`.",
          "Öffne oben rechts das Menü mit den drei Punkten.",
          "Wähle `Gruppe übergeben`.",
          "Wähle unter `Übergeben an:` im Feld `Fachkraft auswählen...` die Person aus.",
          "Wähle `Übergeben`.",
        ],
      },
      {
        title: "Eine Übergabe früher beenden",
        description:
          "Eine Übergabe gilt nur für heute. Du kannst sie auch vorher beenden.",
        steps: [
          "Öffne oben rechts das Menü mit den drei Punkten.",
          "Wähle `Gruppe übergeben`.",
          "Wähle unter `Aktuell übergeben an:` neben der Person `Zurücknehmen`.",
          "Bestätige mit `Übergabe zurücknehmen`.",
        ],
      },
    ],
    result:
      "Die andere Betreuungskraft sieht die Gruppe bis zum Ende des Tages unter `Gruppen`, markiert mit `Vertretung`. Du behältst selbst den Zugriff.",
    notes: [
      "Du kannst die Gruppe an mehrere Betreuungskräfte übergeben. Wiederhole dafür die Schritte.",
      "Alle Übergaben stehen im Fenster unter `Aktuell übergeben an:`.",
    ],
    troubleshootingDetails: [
      "Fehlt der Eintrag `Gruppe übergeben` im Menü? Dann betreust du die Gruppe nur als Vertretung. Eine Vertretung kann die Gruppe nicht weitergeben.",
      "Steht dort `Keine pädagogische Fachkraft verfügbar`? Dann gibt es niemanden zum Übergeben. Frage deine Leitung.",
      // Einstellung „Kinder nur über ‚Alle Kinder‘ finden“ (#1321).
      "Fehlt `Gruppen` in der Navigation? Öffne `Alle Kinder`. Wähle im Menü mit den drei Punkten `Zur Gruppenseite`.",
    ],
    related: [HELP_TOPICS.ownGroups, HELP_TOPICS.missingChildOrGroup],
  };
}
