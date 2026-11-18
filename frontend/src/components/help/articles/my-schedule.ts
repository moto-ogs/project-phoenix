import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";
import {
  OWN_STAFF_PROFILE_TROUBLESHOOTING,
  SIMPLE_NAV_DIFFERENCE,
} from "../help-article-shared";

export function myScheduleTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.mySchedule,
    title: "Meine Termine und Einsätze ansehen",
    question: "Wo sehe ich meine Termine und Einsätze?",
    summary:
      "Prüfe persönliche Termine, geplante Schichten und deine Einsätze im Betreuungsplan.",
    group: "tagesplanung",
    audience: ["caregiver", "lead"],
    icon: "CalendarDays",
    steps: [],
    instructionGroups: [
      {
        title: "Termine und Einsätze ansehen",
        steps: [
          "Klappe in der Seitenleiste `Team` auf und öffne `Mein Kalender`.",
          "Bleibe im Tab `Meine Termine`.",
          "Wähle oben `Tag`, `Woche` oder `Monat`.",
          "Nutze die Pfeile oder `Heute`, um zum gewünschten Zeitraum zu wechseln.",
          "Wähle einen Eintrag, um Uhrzeit, Ort und weitere Angaben zu sehen.",
        ],
      },
      {
        title: "Die Farben verstehen",
        ordered: false,
        steps: [
          "Grün zeigt Termine und Einladungen.",
          "Blau zeigt deine Einsätze im Betreuungsplan.",
          "Orange zeigt deine Schichten aus dem Dienstplan.",
          "Lila zeigt Schultermine. Eine Lehrkraft hat sie in moto schule eingetragen, zum Beispiel einen Ausflug. Die Art steht im geöffneten Termin.",
          "Türkis zeigt gesetzliche Feiertage. Sie gelten für die ganze Schule und lassen sich nicht ändern.",
        ],
      },
      {
        title: "Den Kalender abonnieren",
        description:
          "Nutze das Abo, wenn du hauptsächlich deinen persönlichen Kalender verwendest. Neue und geänderte Einträge aus moto erscheinen dort automatisch.",
        steps: [
          "Gehe unter dem Kalender zum Bereich `Kalender abonnieren`.",
          "Wähle `Abo-Link anzeigen`.",
          "Wähle `Im Kalender abonnieren`. Oder kopiere den Link in deinen persönlichen Kalender.",
          "Der Link ist persönlich und wird nur einmal angezeigt. Gib ihn nicht weiter.",
        ],
      },
    ],
    result:
      "Du hast einen Überblick über deine Termine und Einsätze. Das Kalender-Abo übernimmt neue, geänderte und abgesagte Einträge automatisch.",
    notes: [
      "Mit `Sa/So` blendest du das Wochenende ein. Eine Zahl zeigt, dass dort Einträge liegen.",
      "Bei einer Einladung wählst du im geöffneten Termin `Zusagen` oder `Absagen`. Bei einer Reihe wählst du vorher unter `Deine Antwort gilt für`, ob die Antwort nur für diesen Termin oder für `Alle Termine` gilt.",
      "`Teilnehmer` zeigt bei einer Reihe die Antworten für den geöffneten Termin.",
      "Beim Anlegen und Bearbeiten wählst du unter `Wer sieht die Teilnehmerübersicht?`, wer die Antworten sieht. Bei `Alle Eingeladenen` sehen Eltern nur, wie viele zugesagt und abgesagt haben, keine Namen.",
      "Lege einen Termin an und wähle `Alle Lehrkräfte`. Dann sehen die Lehrkräfte ihn in moto schule.",
      "Ging zu deinem Termin eine E-Mail an Eltern, siehst du im geöffneten Termin unter `E-Mails an die Eltern`, ob sie angekommen ist. Kam eine Mail nicht an, steht dort, bei wem.",
    ],
    differences: [
      "Das Kalender-Abo ist nur zum Lesen. Änderungen in deinem persönlichen Kalender werden nicht an moto übertragen.",
      SIMPLE_NAV_DIFFERENCE,
    ],
    troubleshootingDetails: [OWN_STAFF_PROFILE_TROUBLESHOOTING],
    related: [HELP_TOPICS.carePlan, HELP_TOPICS.trackWorkTime],
  };
}
