import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/database/personal`, Knopf `Löschen`. Der Knopf heisst `Endgültig
 * löschen`, der Vorgang ist aber eine Abschaltung: der Text des Dialogs sagt
 * ausdruecklich, dass Anwesenheiten und Zeiterfassung bleiben und die Person
 * erneut eingeladen werden kann. Genau das muss der Artikel sagen. Nach der
 * Zeiterfassungsfrist löscht der nächtliche Lauf die Person (#3963).
 */
export function removeStaffTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadRemoveStaff,
    title: "Eine Person aus dem Team entfernen",
    question: "Wie entferne ich jemanden aus unserem Team?",
    summary:
      "Sofort oder zum letzten Arbeitstag: Der Zugang geht aus, die bisherigen Einträge bleiben vorerst erhalten.",
    group: "personal",
    audience: "lead",
    icon: "Trash2",
    steps: [],
    instructionGroups: [
      {
        title: "Zum letzten Arbeitstag",
        description:
          "Die Person arbeitet bis dahin normal. Nach dem Ende des Tages entfernt moto sie wie beim Löschen.",
        steps: [
          "Öffne `Datenverwaltung` und danach `Personal`.",
          "Wähle die Person aus der Liste.",
          "Wähle oben rechts die drei Punkte und dann `Austritt planen`.",
          "Wähle unter `Letzter Arbeitstag` den Tag. Steht in den Stammdaten ein Vertragsende, ist es schon eingetragen.",
          "Wähle `Austritt planen`.",
        ],
        ordered: true,
      },
      {
        title: "Sofort",
        steps: [
          "Öffne `Datenverwaltung` und danach `Personal`.",
          "Wähle die Person aus der Liste.",
          "Wähle oben rechts die drei Punkte und dann `Löschen`.",
          "Lies, was mit den Angaben der Person geschieht.",
          "Tippe Vor- und Nachnamen der Person ein.",
          "Wähle `Endgültig löschen`.",
        ],
        ordered: true,
      },
    ],
    result:
      "Der Zugang ist aus. Unter `Mitarbeiter` findest du die Person nur noch mit der Auswahl `Ehemalige`. Bei einem geplanten Austritt steht bis dahin `Austritt am …` bei der Person.",
    notes: [
      "Einen geplanten Austritt kannst du bis zum letzten Arbeitstag ändern oder zurücknehmen: oben rechts die drei Punkte und dann `Austritt ändern` oder `Austritt zurücknehmen`.",
      "Eine Woche vorher und am letzten Arbeitstag erinnert moto alle, die Personen löschen dürfen.",
      "Anwesenheiten und Zeiterfassung bleiben bis zum Ende der Frist für die Zeiterfassung erhalten. So lange bleiben deine Auswertungen vollständig.",
      "Danach löscht moto die Angaben der Person. Statt des Namens steht dann „Gelöscht Benutzer“, und unter `Ehemalige` steht die Person nicht mehr. Die Frist siehst du unter `Einstellungen` und `Datenschutz` bei `Zeiterfassung aufbewahren`.",
      "Du kannst dieselbe Person später wieder einladen.",
    ],
    differences: [
      "Der Knopf heißt `Endgültig löschen`. Die bisherigen Einträge löscht moto aber erst nach der Frist.",
    ],
    troubleshootingDetails: [
      "`Endgültig löschen` lässt sich nicht wählen? Dann stimmt der eingetippte Name noch nicht.",
      "Führt die Person nach ihrem letzten Arbeitstag noch eine Aufsicht oder hat sie eine Gruppe übernommen, wartet der Austritt. Ihre Anmeldung ist trotzdem gesperrt. moto meldet sich bei dir und versucht es jede Stunde wieder. Beende die Aufsicht oder Übernahme.",
    ],
    related: [
      HELP_TOPICS.leadInviteStaff,
      HELP_TOPICS.leadStaffRecord,
      HELP_TOPICS.leadStaffPermissions,
    ],
  };
}
