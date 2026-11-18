import type { HelpTopic, HelpPresenceMode, HelpGroupMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Einstiegs-Checkliste. Verweist nur, statt Schritte zu wiederholen
 * (Informationsarchitektur Abschnitt 7). Alle drei Einstellungen wirken hier:
 * ohne NFC entfaellt die Geraetevorbereitung, bei einfacher Anwesenheit gibt
 * es im Testlauf keine Aufsicht, und bei offener Betreuung keine Gruppe.
 */
export function goLiveTopic(
  presenceMode: HelpPresenceMode,
  groupMode: HelpGroupMode,
  nfcEnabled: boolean | null,
): HelpTopic {
  const usesGroups = groupMode !== "open_care";
  const tracksRooms = presenceMode !== "binary";
  const usesNfc = nfcEnabled !== false;
  return {
    id: HELP_TOPICS.leadGoLive,
    title: "moto für den ersten Betreuungstag vorbereiten",
    question: "Was muss ich vor dem Start erledigen?",
    summary: "Arbeite diese Liste einmal von oben nach unten ab.",
    group: "einrichten",
    audience: "lead",
    icon: "ListChecks",
    steps: [],
    instructionGroups: [
      {
        title: "In dieser Reihenfolge einrichten",
        description:
          "Jeder Punkt hat eine eigene Anleitung. Die Reihenfolge zählt, weil ein Schritt den vorigen braucht.",
        steps: [
          "Lege die `Räume` an.",
          "Lege dein Team an und lade es ein.",
          ...(usesGroups
            ? [
                "Lege die `Gruppen` an. Jede Gruppe bekommt einen Raum und eine Gruppenleitung.",
              ]
            : []),
          "Übernimm die Kinder aus einer Liste. Oder lege sie einzeln an.",
          "Trage die Betreuungszeiten der Kinder ein.",
          "Trage unter `Schuljahr und Kalender` Schuljahr, Ferien und Schließtage ein.",
          ...(usesNfc ? ["Richte die NFC-Geräte und die Armbänder ein."] : []),
          "Prüfe zum Schluss die `Einstellungen` deiner OGS.",
        ],
      },
      {
        title: "Vor dem ersten Tag einmal durchspielen",
        steps: [
          "Melde dich mit einem Leitungskonto an.",
          ...(usesGroups
            ? ["Öffne eine Gruppe und prüfe die zugeordneten Kinder."]
            : ["Prüfe unter `Alle Kinder` drei Kinder."]),
          ...(tracksRooms
            ? ["Starte eine Aufsicht und beende sie wieder."]
            : ["Melde ein Kind an und wieder ab."]),
          "Melde ein Kind krank und hebe die Meldung wieder auf.",
          "Weise dein Team kurz ein.",
        ],
        ordered: false,
      },
    ],
    result:
      "Sind alle Punkte erledigt, kann dein Team am ersten Tag ohne Vorbereitung starten.",
    notes: [
      "Du musst nicht alles an einem Tag schaffen. Die Liste bleibt gültig.",
      "Lade dein Team früh ein. Als `Gruppenleitung` wählbar ist nur, wer die Einladung schon angenommen hat.",
    ],
    troubleshootingDetails: [
      "Ein Punkt fehlt dir in der Seitenleiste? Dann fehlen dir die Leitungsrechte. Frage deine Leitung.",
    ],
    related: [
      HELP_TOPICS.leadFirstSteps,
      HELP_TOPICS.leadRooms,
      ...(usesGroups ? [HELP_TOPICS.leadGroups] : []),
      HELP_TOPICS.leadInviteStaff,
      HELP_TOPICS.leadCreateStudent,
      HELP_TOPICS.leadCareTimes,
      ...(usesNfc ? [HELP_TOPICS.leadTabletSetup] : []),
      HELP_TOPICS.settings,
    ],
  };
}
