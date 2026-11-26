import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";
import { unavailableNfcTopic, unknownNfcTopic } from "../help-article-shared";

export function nfcWorkTimeTopic(nfcEnabled: boolean | null): HelpTopic {
  if (nfcEnabled === null) {
    return unknownNfcTopic(
      HELP_TOPICS.nfcWorkTime,
      "Die eigene Arbeitszeit mit dem Armband erfassen",
      "Wie erfasse ich meine Arbeitszeit mit dem Armband?",
      "Timer",
      [HELP_TOPICS.trackWorkTime, HELP_TOPICS.nfcProblem],
    );
  }
  if (!nfcEnabled) {
    return unavailableNfcTopic(
      HELP_TOPICS.nfcWorkTime,
      "Die eigene Arbeitszeit mit dem Armband erfassen",
      "Wie erfasse ich meine Arbeitszeit mit dem Armband?",
      "Timer",
      [HELP_TOPICS.trackWorkTime, HELP_TOPICS.nfcProblem],
    );
  }

  return {
    id: HELP_TOPICS.nfcWorkTime,
    title: "Die eigene Arbeitszeit mit dem Armband erfassen",
    question: "Wie erfasse ich meine Arbeitszeit mit dem Armband?",
    summary: "Stemple dich am NFC-Tablet ein, aus oder in eine Pause.",
    group: "nfc",
    audience: ["caregiver", "lead"],
    icon: "Timer",
    requirements: ["Dein persönliches, aktives NFC-Armband"],
    steps: [
      "Öffne im `Menü` den Bereich `Mitarbeiter-Stempeln`.",
      "Wähle `Armband scannen` und halte dein Armband an den NFC-Sensor.",
      "Wähle `Einstempeln`.",
      "Scanne das Armband erneut, um `Pause starten`, `Pause beenden` oder `Ausstempeln` zu wählen.",
      "Gib bei einer Abweichung vom Dienstplan den verlangten Grund ein.",
    ],
    result:
      "Der neue Status erscheint am Tablet. Die Buchung steht auch in deiner `Zeiterfassung` in der moto-App.",
    differences: [
      "Kinderarmbänder und nicht zugewiesene Armbänder funktionieren für die persönliche Arbeitszeit nicht.",
      "Eine laufende Pause wird als `In Pause` angezeigt.",
      "Deine Schule kann das Einstempeln erst kurz vor deiner Schicht erlauben. Dann zeigt das Tablet, ab wann es geht.",
      "Deine Schule kann das Stempeln in der moto-App ausschalten. Dann stempelst du nur hier am Tablet. Die Leitung stempelt weiter in der App.",
    ],
    notes: [
      "Am Tablet gibt es keine Wahl des Arbeitsorts. Wer dort einstempelt, ist in der OGS. Arbeitest du unterwegs, stemple in der moto-App unter `Zeiterfassung` ein. Geht das an deiner Schule nicht, trägt die Leitung die Zeit nach.",
    ],
    troubleshooting: HELP_TOPICS.nfcProblem,
    related: [HELP_TOPICS.trackWorkTime, HELP_TOPICS.tagAssignment],
  };
}
