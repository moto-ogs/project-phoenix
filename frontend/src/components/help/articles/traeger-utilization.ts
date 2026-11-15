import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/auslastung` (#4713): wie voll die Plätze über Wochen und Monate waren. */
export function traegerUtilizationTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerUtilization,
    title: "Auslastung über die Zeit",
    question: "Wie voll waren meine Schulen in den letzten Wochen und Monaten?",
    summary:
      "Die Auslastung zeigt, wie viele Plätze Ihre Schulen, ihre Betreuungsformen und ihre Räume im gewählten Zeitraum belegt hatten.",
    group: "einstieg",
    audience: "traeger",
    icon: "TrendUp",
    requirements: [
      "Das Recht „Berichte lesen“. Für die Namen der Kinder brauchen Sie zusätzlich „Verträge verwalten“.",
    ],
    steps: [
      "Wählen Sie in der Navigation `Auslastung`.",
      "Wählen Sie oben den Zeitraum, zum Beispiel `Dieses Schuljahr`. Mit den Pfeilen springen Sie einen Zeitraum vor oder zurück.",
      "Wählen Sie bei Bedarf eine Schule. Ohne Auswahl sehen Sie alle Schulen zusammen.",
      "Wählen Sie einen Reiter: `Schulen`, `Betreuungsformen` oder `Räume`.",
      "Wählen Sie eine Zeile der Tabelle. Das Diagramm zeigt dann den Verlauf dieser Zeile.",
      "Wählen Sie über dem Diagramm `Tage`, `Wochen` oder `Monate`.",
      "Wählen Sie `Herunterladen` und dann `CSV`, um alle Zahlen je Tag als Tabelle zu speichern.",
    ],
    result:
      "Sie sehen, wie voll die Plätze im Durchschnitt waren, an welchem Tag am meisten los war und welche Betreuungsformen voll waren.",
    instructionGroups: [
      {
        title: "Kinder mit Namen ansehen",
        description:
          "Die Zahlen sind immer zusammengefasst. Die Namen sehen Sie nur für eine Schule und nur, wenn Sie sie öffnen.",
        steps: [
          "Wählen Sie oben eine Schule oder im Reiter `Schulen` eine Zeile.",
          "Wählen Sie unten bei `Kinder mit Namen` den Knopf `Namen anzeigen`.",
          "Sie sehen für jedes Kind, an wie vielen Betreuungstagen es da war. moto zählt ab dem ersten Check-in der Schule im Zeitraum.",
        ],
        ordered: true,
      },
    ],
    notes: [
      "„Belegt“ zählt die gebuchten Kinder der Betreuungsformen, für die die Schule Plätze festgelegt hat.",
      "„Anwesend“ zählt die Kinder mit Check-in. Ein Tag ohne Check-in, etwa in den Ferien, hat keine Zahl.",
      "Der heutige Tag zählt bei „Anwesend“ und bei den Räumen erst, wenn er vorbei ist.",
      "Bei den Räumen zählt „Gleichzeitig“ die meisten Kinder zur selben Zeit.",
      "Die Kinder von heute sehen Sie unter `Belegung`.",
      "Wenn Sie die Namen öffnen, steht das im Zugriffsprotokoll der Schule.",
    ],
    differences: [
      "Steht `Check-ins gibt es erst ab …`, hat die Schule für die Tage davor keine Check-ins. Dann zeigt moto für diese Tage keine Anwesenheit.",
      "Steht `Raumbesuche gibt es erst ab …`, bewahrt die Schule Raumbesuche nur wenige Wochen auf. Ältere Zahlen gibt es nicht mehr.",
      "Fehlen die Räume einer Schule, ist dort das Anwesenheitsprotokoll ausgeschaltet. Dann zählt moto keine Raumbesuche.",
      "Steht bei `Kinder mit Namen` nur ein Hinweis, fehlt Ihnen das Recht „Verträge verwalten“. Es gehört zur Rolle Verwaltung.",
    ],
    image: "/help/screens/traeger-auslastung.webp",
    imageAlt:
      "Die Seite Auslastung: oben Zeitraum und Schule, darunter vier Kennzahlen und der Verlauf der belegten Plätze als Diagramm.",
    related: [
      HELP_TOPICS.traegerOccupancy,
      HELP_TOPICS.traegerKeyDateCounts,
      HELP_TOPICS.traegerSchoolComparison,
    ],
  };
}
