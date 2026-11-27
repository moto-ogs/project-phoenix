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
      "Du darfst die Zeiterfassung aller Mitarbeitenden verwalten.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Eine Vorlage anlegen",
        steps: [
          "Öffne `Datenverwaltung` und danach `Arbeitszeitmodelle`.",
          "Wähle oben rechts `Vorlage`.",
          "Gib einen Namen ein, zum Beispiel `Teilzeit 30 Stunden`.",
          "Wähle bei `Rotation` zum Beispiel `Standard (1 Woche)` oder `A/B-Wochen (2 Wochen)`.",
          "Trage pro Wochentag die Stunden ein, zum Beispiel `6`.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Mehrere Personen auf einmal zuordnen",
        steps: [
          "Wähle die Vorlage in der Liste.",
          "Öffne oben den Reiter `Personen`. Dort steht, wer die Vorlage schon nutzt.",
          "Wähle `Personen zuordnen`.",
          "Wähle bei `Ab wann gilt das neue Soll?` meist `Ab heute`.",
          "Setze den Haken bei allen Personen, die die Vorlage bekommen. `Alle auswählen` nimmt alle angezeigten.",
          "Wähle unten zum Beispiel `3 Personen zuordnen`.",
        ],
      },
      {
        title: "Eine Person in der Personalakte zuordnen",
        steps: [
          "Klappe in der Seitenleiste `Team` auf.",
          "Öffne `Mitarbeitende` und wähle die Person.",
          "Wähle oben `Arbeitszeitmodell` und rechts `Bearbeiten`.",
          "Wähle `Vorlage zuweisen` und die Vorlage.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Eine Vorlage ändern",
        steps: [
          "Wähle die Vorlage in der Liste.",
          "Ändere die Stunden.",
          "Wähle `Speichern`.",
        ],
      },
    ],
    result:
      "In der Liste steht bei jeder Vorlage, wie viele Personen sie nutzen. Wer neu zugeordnet ist, hat ab dem gewählten Tag das Soll der Vorlage.",
    notes: [
      "Eine Änderung gilt ab heute für alle Personen mit dieser Vorlage. Die Seite zeigt vor dem Speichern, wie viele es sind.",
      "Über die drei Punkte wählst du `Nicht mehr anbieten`. Wer die Vorlage schon nutzt, behält sie. Neu zuordnen lässt sie sich dann nicht mehr.",
      "Löschen geht nur, wenn niemand die Vorlage nutzt.",
      "Mit `Früheres Datum` beginnt das neue Soll rückwirkend. Das geht nur für Personen ohne bisheriges Soll. Der Start liegt nie in einem abgeschlossenen Monat. Wer an diesen Tagen weniger gearbeitet hat, bekommt Minusstunden. Deshalb fragt moto vorher nach.",
    ],
    differences: [
      "Du siehst `Arbeitszeitmodelle` nicht? Dann hat deine Schule die Zeiterfassung nicht gebucht, oder dir fehlt das Recht dafür.",
      "Bei einer Person steht „Das Soll führt der Träger im Arbeitsvertrag“ und `Bearbeiten` fehlt: Der Träger führt ihr Soll. Änderungen macht die Personalverwaltung des Trägers.",
      "In `Personen zuordnen` lässt sich eine Person nicht anhaken: Unter ihrem Namen steht der Grund, zum Beispiel dass der Träger ihr Soll festlegt.",
      "`Personen zuordnen` ist grau: Die Vorlage wird nicht mehr angeboten. Wähle über die drei Punkte zuerst `Wieder anbieten`.",
    ],
    related: [
      HELP_TOPICS.leadStaffRecord,
      HELP_TOPICS.leadTargetOverride,
      HELP_TOPICS.leadWorkTimeReview,
    ],
  };
}
