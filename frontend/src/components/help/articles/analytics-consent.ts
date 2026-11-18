import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Eigene Einwilligung zur Nutzungsanalyse (#4901): der Dialog nach dem Login
 * und der Schalter zum Ändern. Eine Frage für alle Rollen, je Portal ein Weg.
 */
export function analyticsConsentTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.analyticsConsent,
    title: "Nutzungsanalyse erlauben oder ablehnen",
    question: "Darf moto zählen, wie ich die App nutze?",
    summary:
      "Das entscheidest nur du. Wenn du ablehnst, kannst du moto genauso nutzen.",
    group: "einstieg",
    // Das Träger-Portal (#4649) erfasst nichts und fragt deshalb nicht.
    audience: ["caregiver", "lead", "parent", "teacher"],
    icon: "ChartLine",
    steps: [],
    instructionGroups: [
      {
        title: "Nach der Anmeldung",
        description:
          "moto fragt einmal, ob es zählen darf, welche Seiten und Schaltfläche nutzen. Namen und Eingaben sieht moto dabei nicht.",
        steps: ["Wähle `Erlauben` oder `Ablehnen`."],
      },
      {
        title: "Später ändern im OGS-Portal",
        steps: [
          "Öffne oben rechts dein `Profil`.",
          "Gehe zu `Nutzungsanalyse`.",
          "Schalte `Nutzungsanalyse erlauben` ein oder aus.",
        ],
      },
      {
        title: "Später ändern in der Eltern-App",
        steps: [
          "Tippe unten auf `Mehr` und dann auf `Einstellungen`.",
          "Schalte bei `Nutzungsanalyse` den Schalter ein oder aus.",
        ],
      },
      {
        title: "Später ändern in moto schule",
        steps: [
          "Öffne `Einstellungen`.",
          "Schalte bei `Nutzungsanalyse` den Schalter ein oder aus.",
        ],
      },
    ],
    result:
      "Deine Wahl gilt für dein Konto, in jeder Schule. Schalte aus, endet die Zählung sofort.",
    notes: [
      "Deine Schule kann die Nutzungsanalyse für alle ausschalten. Dann fragt moto dich nicht. Deine Wahl gilt wieder, sobald die Schule einschaltet.",
      "Im OGS-Portal gilt deine Wahl auch für Aufzeichnungen, wenn deine Schule sie erlaubt. Texte, Eingaben und Bilder sind darin unkenntlich.",
      "Du hast die Frage über das Kreuz oben rechts geschlossen? Dann zählt moto nichts. moto fragt beim nächsten Öffnen noch einmal.",
    ],
    differences: [
      "Am Computer steht `Einstellungen` in der Eltern-App in der Navigation statt hinter `Mehr`.",
    ],
    related: [],
  };
}
