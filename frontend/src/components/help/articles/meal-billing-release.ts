import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Die Mensa-Freigabe (#4686): Die OGS-Leitung prüft am Monatsende, wer
 * gegessen hat, und gibt den Monat für die Abrechnung des Trägers frei.
 */
export function mealBillingReleaseTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadMealBillingRelease,
    title: "Mensa-Monat freigeben",
    question: "Wie gebe ich die Mensa eines Monats für die Abrechnung frei?",
    summary:
      "Am Monatsende prüfst du, wer gegessen hat. Dann gibst du den Monat frei. Erst danach rechnet der Träger die Mensa ab.",
    group: "elternarbeit",
    audience: "lead",
    icon: "ClipboardList",
    requirements: [
      "`Anmeldung zum Mittagessen` ist eingeschaltet.",
      "Du darfst den Speiseplan pflegen und Listen mit Namen sehen.",
      "Der Monat ist vorbei. Freigeben kannst du ab dem 1. des nächsten Monats.",
    ],
    steps: [
      "Öffne in der Seitenleiste `Speiseplan`.",
      "Wähle oben `Mensa-Freigabe`.",
      "Wähle den Monat. Ein Monat mit `Freigabe fehlt` wartet auf dich.",
      "Prüfe in der Liste die Spalte `Nicht da`. Dort stehen die Tage, an denen ein angemeldetes Kind nicht da war.",
      "Fehlt eine Anwesenheit, trage sie zuerst nach. Lade die Seite danach neu.",
      "Wähle `Monat freigeben` und bestätige mit `Freigeben`.",
    ],
    result:
      "Der Monat steht auf `Freigegeben`. Der Träger rechnet die Essen mit dem nächsten Monatslauf ab. Die Zahlen bleiben so. Zurücknehmen lässt sich die Freigabe nicht.",
    notes: [
      "Ein Essen zählt, wenn das Kind angemeldet und da war. Tage, an denen die Eltern abgemeldet haben, zählen nicht.",
      "Ferien, Feiertage und Schließtage zählen nie.",
      "Du kannst einen Monat später freigeben, solange alle Anwesenheiten aufbewahrt werden. Der Träger rechnet ihn dann nachträglich ab.",
    ],
    troubleshootingDetails: [
      "`Nicht mehr abrechenbar`: Die Anwesenheiten dieses Monats sind nach der Aufbewahrungsfrist gelöscht. Eine Freigabe ist nicht mehr möglich. Gib Monate deshalb bald nach dem Monatsende frei.",
      "`Seit dem Laden hat sich der Monat geändert`: Jemand hat eine Anwesenheit oder Anmeldung geändert. Prüfe die Liste noch einmal und gib dann frei.",
      "Hast du nach der Freigabe eine Anwesenheit nachgetragen, steht oben `Seit der Freigabe hat sich die Anwesenheit geändert`. Prüfe die Liste, wähle `Erneut freigeben` und nenne den Grund. Schon gestellte Rechnungen ändert das nicht. Der Träger sieht die Änderung und korrigiert die Rechnung.",
      "Du hast einen Monat mit falschen Zahlen freigegeben: Zurücknehmen geht nicht. Die Karte `Zahlen korrigieren` zeigt den Weg. Trage die Anwesenheit nach. Dann wählst du `Erneut freigeben` und nennst den Grund. Hat der Träger schon abgerechnet, storniert er die Rechnung und stellt sie neu aus.",
    ],
    related: [HELP_TOPICS.leadMealPlan],
  };
}
