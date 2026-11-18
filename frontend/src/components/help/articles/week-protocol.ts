import type { HelpGroupMode, HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Wochenprotokoll (#4769): moto hält jeden Abend den Tag der Gruppe fest. Ab
 * Freitagabend ergänzt die Gruppenleitung die Woche und schließt sie ab.
 */
export function weekProtocolTopic(groupMode: HelpGroupMode): HelpTopic {
  // Ohne feste Gruppen gibt es ein Protokoll für die ganze Schule.
  const openCare = groupMode === "open_care";
  return {
    id: HELP_TOPICS.weekProtocol,
    title: "Das Wochenprotokoll ergänzen",
    question: "Wie ergänze und schließe ich das Wochenprotokoll ab?",
    summary: openCare
      ? "moto schreibt jede Woche ein Protokoll für die ganze Schule. Du ergänzt es und schließt es ab."
      : "moto schreibt jede Woche ein Protokoll für jede Gruppe. Die Gruppenleitung ergänzt es und schließt es ab.",
    group: "gruppen",
    audience: ["caregiver", "lead"],
    icon: "Notebook",
    requirements: [
      openCare
        ? "Du arbeitest im Team der Schule."
        : "Du leitest die Gruppe oder vertrittst sie. Die Leitung sieht die Protokolle aller Gruppen.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Das Protokoll öffnen",
        steps: [
          ...(openCare
            ? [
                "Klappe in der Seitenleiste `Planung` auf und öffne `Wochenprotokolle`.",
              ]
            : [
                "Öffne deine Gruppe unter `Gruppen`.",
                "Wähle oben `Weitere Aktionen` und dann `Wochenprotokolle`.",
              ]),
          "Wähle die Woche.",
        ],
      },
      {
        title: "Ergänzen und abschließen",
        steps: [
          "Wähle `Ergänzen`. Das geht ab Freitagabend.",
          "Schreibe bei einem Tag oder bei der Woche, was wichtig war.",
          "Wähle `Speichern`.",
          "Wähle `Abschließen` und bestätige mit `Abschließen`.",
        ],
      },
    ],
    result:
      "Das Protokoll ist abgeschlossen und ändert sich nicht mehr. Mit `PDF herunterladen` lädst du es als PDF.",
    notes: [
      "Jeden Abend hält moto fest, wer da war, wer fehlte und warum, welche Blöcke gelaufen oder ausgefallen sind und welche Hinweise der Leitung galten.",
      "Gesundheitsangaben stehen nicht im Protokoll. Bei einem fehlenden Kind steht nur der Grund, wie in der Tagesauswertung.",
      "Ältere Protokolle bleiben in der Liste. moto löscht sie nach der Frist für die Anwesenheit deiner Schule.",
    ],
    differences: [
      "Steht oben `Woche läuft`? Dann ist die Woche noch nicht vorbei. Ab Freitagabend kannst du ergänzen.",
      "Schließt niemand ab, schließt moto das Protokoll nach der folgenden Woche mit den bisherigen Ergänzungen ab.",
      "Steht bei einem Tag `Dieser Tag wurde nicht festgehalten`? Dann fehlen die Zahlen für diesen Tag. Schreibe das Wichtigste in die Ergänzung.",
    ],
    related: [HELP_TOPICS.ownGroups, HELP_TOPICS.dayLog],
  };
}
