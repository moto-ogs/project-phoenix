import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/database/work-time-models` (#6891): die Arbeitszeitmodell-Vorlagen der
 * Schule. Vorher ließ sich eine Vorlage nur aus der Personalakte heraus
 * anlegen. Seit #6921 ordnet der Reiter `Personen` sie mehreren Personen auf
 * einmal zu; einzeln geht es weiter in der Personalakte.
 */
export function workTimeTemplatesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadWorkTimeTemplates,
    title: "Vorlagen für Arbeitszeitmodelle verwalten",
    question: "Wie lege ich ein Arbeitszeitmodell für viele Personen an?",
    summary:
      "Eine Vorlage legt die Soll-Stunden fest, die mehrere Mitarbeitende teilen.",
    group: "personal",
    audience: "lead",
    icon: "Hourglass",
    requirements: [
      "Sie dürfen die Zeiterfassung aller Mitarbeitenden verwalten.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Eine Vorlage anlegen",
        steps: [
          "Öffnen Sie `Datenverwaltung` und danach `Arbeitszeitmodelle`.",
          "Wählen Sie oben rechts `Vorlage`.",
          "Geben Sie einen Namen ein, zum Beispiel `Teilzeit 30 Stunden`.",
          "Wählen Sie bei `Rotation` zum Beispiel `Standard (1 Woche)` oder `A/B-Wochen (2 Wochen)`.",
          "Tragen Sie je Wochentag die Stunden ein, zum Beispiel `6`.",
          "Wählen Sie `Speichern`.",
        ],
      },
      {
        title: "Mehrere Personen auf einmal zuordnen",
        steps: [
          "Wählen Sie die Vorlage in der Liste.",
          "Öffnen Sie oben den Reiter `Personen`. Dort steht, wer die Vorlage schon nutzt.",
          "Wählen Sie `Personen zuordnen`.",
          "Wählen Sie bei `Ab wann gilt das neue Soll?` meist `Ab heute`.",
          "Setzen Sie den Haken bei allen Personen, die die Vorlage bekommen. `Alle auswählen` nimmt alle angezeigten.",
          "Wählen Sie unten zum Beispiel `3 Personen zuordnen`.",
        ],
      },
      {
        title: "Eine Person in der Personalakte zuordnen",
        steps: [
          "Klappen Sie in der Seitenleiste `Team` auf.",
          "Öffnen Sie `Mitarbeiter` und wählen Sie die Person.",
          "Wählen Sie oben `Arbeitszeitmodell` und rechts `Bearbeiten`.",
          "Wählen Sie `Vorlage zuweisen` und die Vorlage.",
          "Wählen Sie `Speichern`.",
        ],
      },
      {
        title: "Eine Vorlage ändern",
        steps: [
          "Wählen Sie die Vorlage in der Liste.",
          "Ändern Sie die Stunden.",
          "Wählen Sie `Speichern`.",
        ],
      },
    ],
    result:
      "In der Liste steht bei jeder Vorlage, wie viele Personen sie nutzen. Wer neu zugeordnet ist, hat ab dem gewählten Tag das Soll der Vorlage.",
    notes: [
      "Eine Änderung gilt ab heute für alle Personen mit dieser Vorlage. Die Seite zeigt vor dem Speichern, wie viele es sind.",
      "Über die drei Punkte wählen Sie `Nicht mehr anbieten`. Wer die Vorlage schon nutzt, behält sie. Neu zuordnen lässt sie sich dann nicht mehr.",
      "Löschen geht nur, wenn niemand die Vorlage nutzt.",
      "Mit `Früheres Datum` beginnt das neue Soll rückwirkend. Das geht nur für Personen, die noch kein Soll haben, und nie in einem abgeschlossenen Monat. Wer an diesen Tagen weniger gearbeitet hat, bekommt Minusstunden. Deshalb fragt moto vorher nach.",
    ],
    differences: [
      "Sie sehen `Arbeitszeitmodelle` nicht? Dann hat Ihre Schule die Zeiterfassung nicht gebucht, oder Ihnen fehlt das Recht dafür.",
      "Bei einer Person steht „Das Soll führt der Träger im Arbeitsvertrag“ und `Bearbeiten` fehlt: Der Träger führt ihr Soll. Änderungen macht die Personalverwaltung des Trägers.",
      "In `Personen zuordnen` lässt sich eine Person nicht anhaken: Unter ihrem Namen steht der Grund, zum Beispiel dass der Träger ihr Soll festlegt.",
      "`Personen zuordnen` ist grau: Die Vorlage wird nicht mehr angeboten. Wählen Sie über die drei Punkte zuerst `Wieder anbieten`.",
    ],
    related: [
      HELP_TOPICS.leadStaffRecord,
      HELP_TOPICS.leadTargetOverride,
      HELP_TOPICS.leadWorkTimeReview,
    ],
  };
}
