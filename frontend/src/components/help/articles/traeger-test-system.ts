import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** Hinweis `Testsystem` im Träger-Portal (#4658): erfundene Beispielkinder. */
export function traegerTestSystemTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerTestSystem,
    title: "Mit dem Testsystem ausprobieren",
    question: "Was ist das Testsystem?",
    summary:
      "Im Testsystem probierst du moto mit erfundenen Kindern aus. Echte Daten gehören nicht hinein.",
    group: "einstieg",
    audience: "traeger",
    icon: "PuzzlePiece",
    requirements: [
      "Das moto-Team hat für deinen Träger ein Testsystem angelegt.",
    ],
    steps: [
      "Melde dich im Träger-Portal an.",
      "Gehörst du auch zum echten Träger? Wähle den Test-Träger aus.",
      "Oben steht der Hinweis `Testsystem`. So erkennst du das Testsystem.",
      "Unter `Schulen` in der Navigation stehen die Test-Schulen. Probiere alles aus.",
    ],
    result:
      "Wenn du fertig bist, löscht das moto-Team das Testsystem mit allen Test-Schulen.",
    notes: [
      "Alle Kinder im Testsystem sind erfunden. Trage keine echten Kinder ein.",
    ],
    troubleshootingDetails: [
      "Du siehst den Hinweis `Testsystem` nicht? Dann bist du beim echten Träger. Melde dich ab und wähle den Test-Träger.",
    ],
    related: [HELP_TOPICS.traegerLogin],
  };
}
