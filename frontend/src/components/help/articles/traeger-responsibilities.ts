import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/einstellungen/zustaendigkeiten` und der Reiter
 * „Zuständigkeiten“ einer Schule (#4811): Träger, Schulträger oder Gemeinde
 * für Verträge, Abrechnung und Personal, mit den Angaben der Stelle je
 * Schule.
 */
export function traegerResponsibilitiesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerResponsibilities,
    title: "Zuständigkeiten festlegen",
    question:
      "Wie lege ich fest, wer Verträge schließt, abrechnet und Personal anstellt?",
    summary:
      "Je Schule ist dein Träger, der Schulträger oder die Gemeinde zuständig. Du legst das für alle Schulen fest und trägst Name und Anschrift der Stelle bei der Schule ein.",
    group: "konfiguration",
    audience: "traeger",
    icon: "Building2",
    requirements: ["Deine Rolle im Träger-Büro ist Verwaltung."],
    steps: [],
    instructionGroups: [
      {
        title: "Für alle Schulen festlegen",
        description: "Ohne deine Wahl ist dein Träger für alles zuständig.",
        steps: [
          "Wähle unten in der Navigation `Einstellungen` und dann `Zuständigkeiten`.",
          "In der Karte `Für alle Schulen` wählst du je Frage eine Stelle: `Träger`, `Schulträger` oder `Gemeinde`.",
          "moto speichert die Wahl sofort. Unter `Je Schule` siehst du, wer an jeder Schule zuständig ist.",
        ],
      },
      {
        title: "Schulträger oder Gemeinde einer Schule eintragen",
        description:
          "Eine Stelle ist erst zuständig, wenn ihr Name und ihre Anschrift bei der Schule stehen. Bis dahin bleibt dein Träger zuständig.",
        steps: [
          "Wähle unter `Je Schule` die Schule. Der Reiter `Zuständigkeiten` der Schule öffnet sich.",
          "Wähle in der Karte `Schulträger` oder `Gemeinde` den Knopf `Angaben eintragen`.",
          "Trage Name, Straße, Postleitzahl und Ort ein. Die Ansprechperson ist freiwillig.",
          "Rechnet die Stelle mit den Eltern ab? Dann trage auch Gläubiger-ID und Bankverbindung ein.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Eine Schule weicht ab",
        description:
          "Den eigenen Wert einer Schule stellst du in der Schul-App ein, nicht im Träger-Portal.",
        steps: [
          "Öffne die Schule und wähle `Schul-App öffnen`.",
          "Wähle in der Schul-App `Einstellungen` und den Bereich `Zuständigkeiten`.",
          "Wähle die Stelle. Im Träger-Portal steht bei der Schule dann `Eigener Wert`.",
        ],
      },
    ],
    result:
      "Neue Betreuungsverträge der Schule nennen die zuständige Stelle als Absender und, wenn die Vertragsbedingungen keinen Vertragspartner nennen, als Vertragspartner. Die Personalakte nennt sie beim Einsatzort als Arbeitgeber.",
    notes: [
      "Schon verschickte Verträge bleiben, wie sie sind. Auch Erinnerungen und die Seite zum Unterschreiben nennen weiter die Stelle, die den Vertrag ausgestellt hat.",
      "Auf dem Vertrag einer anderen Stelle stehen das Logo und die Fußzeile deines Trägers nicht.",
      "Rechnungen, Bescheide und Lastschriften stellt moto noch mit den Angaben deines Trägers aus. Die Wahl bei `Wer rechnet mit den Eltern ab?` bereitet den Wechsel vor.",
      "Stellt eine Gemeinde oder ein Schulträger an, wählst du unter `Lohnexport` > `Einrichtung`: eine Lohndatei für den ganzen Träger oder eine je Arbeitgeber.",
    ],
    troubleshootingDetails: [
      "Bei einer Schule steht `Angaben fehlen`? Die gewählte Stelle hat dort noch keinen Namen und keine Anschrift. Trage sie bei der Schule ein.",
      "Bei `Abrechnung` steht `Bankdaten fehlen`? Trage Gläubiger-ID und Bankverbindung bei der Stelle ein. Beides muss da sein.",
      "Du kannst nichts ändern? Dir fehlt die Rolle `Verwaltung`.",
      "Bei einer Schule steht `Eigener Wert` und du willst den Wert deines Trägers? Den eigenen Wert ändert und entfernt nur die Schule in ihren Einstellungen.",
    ],
    related: [
      HELP_TOPICS.traegerSettings,
      HELP_TOPICS.traegerCareContracts,
      HELP_TOPICS.traegerStaffRecords,
      HELP_TOPICS.traegerPayrollExport,
      HELP_TOPICS.traegerSchoolView,
    ],
  };
}
