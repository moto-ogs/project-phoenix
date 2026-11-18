import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/vertretung`. Heisst in Seitenleiste und Kopfzeile `Vertretungsplan` (#4778). */
export function substitutionPlanTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadSubstitutionPlan,
    title: "Eine Vertretung planen",
    question: "Wie plane ich eine Vertretung?",
    summary: "Du trägst ein, wer einen Einsatz übernimmt.",
    group: "planung",
    audience: "lead",
    icon: "Repeat",
    steps: [
      "Klappe in der Seitenleiste `Planung` auf.",
      "Öffne `Vertretungsplan`.",
      "Wähle oben den Tag. Die Zahl an einem Tag zeigt, wie viele Lücken dort offen sind.",
      "Wähle unter `Offene Lücken` bei dem Termin `Besetzen`.",
      "Wähle die Person, die übernimmt.",
      "Wähle `Vertretung speichern`.",
    ],
    result:
      "Der Termin steht jetzt unter `Schon geregelt`. Die vertretende Person sieht den Einsatz unter `Mein Kalender`.",
    notes: [
      "Mit `Sammel-Vertretung` trägst du mehrere Einsätze auf einmal ein.",
      "Auch ein `Dienst` ohne Kinder lässt sich vertreten. Sind weniger Personen da als unter `Benötigtes Personal` eingetragen, zeigt der Plan eine Lücke.",
    ],
    differences: [
      "Mit `Woche` siehst du alle Tage untereinander. Tippe auf einen Tag, um ihn einzeln zu öffnen.",
      "Steht bei dir `Details` statt `Besetzen`? Dann darfst du den Plan ansehen, aber nicht ändern.",
      "Am Telefon steht der Zeitplan eingeklappt unter der Liste. Tippe auf `Tag als Zeitplan`.",
      "Steht bei einer Lücke `Niemand eingeteilt`? Dann teilst du das Personal im Betreuungsplan ein.",
      "`Übergaben` im `Tagesbetrieb` ist etwas anderes: dort übergibst du Gruppen für heute. Unter `Vertretungen heute` siehst du dort auch die Vertretungen des Tages.",
    ],
    troubleshootingDetails: [
      "Fehlt der Termin? Dann ist er noch nicht im Betreuungsplan angelegt.",
      "Eine externe Person steht nicht zur Wahl? Externe Personen übernehmen keine Vertretung.",
    ],
    related: [
      HELP_TOPICS.leadCarePlan,
      HELP_TOPICS.leadDutyRoster,
      HELP_TOPICS.leadWorkTimeReview,
    ],
  };
}
