import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Die Eltern-Tour (#3747). Sie erklärt vorhandene Bereiche und speichert den
 * Stand nur für dieses Elternkonto auf diesem Gerät.
 */
export function parentFirstStepsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentFirstSteps,
    title: "Erste Schritte im Elternportal",
    question: "Wie zeigt mir moto die wichtigsten Bereiche?",
    summary:
      "Eine kurze Checkliste führt dich durch die wichtigsten Bereiche im Elternportal.",
    group: "einstieg",
    audience: "parent",
    icon: "ListChecks",
    steps: [
      "Nach der Anmeldung öffnet sich die Checkliste `Erste Schritte`.",
      "Klappe einen Punkt auf und wähle `Tour starten`.",
      "moto markiert den passenden Bereich. Tippe auf die markierte Stelle oder wähle `Weiter`.",
      "Nach der Tour bekommt der Punkt einen Haken. Du kannst danach mit einem anderen Punkt weitermachen.",
      "Sind alle Punkte erledigt, wähle `Erste Schritte abschließen`.",
    ],
    result:
      "Die Checkliste verschwindet. Alle ausführlichen Anleitungen bleiben in der Hilfe verfügbar.",
    notes: [
      "Auf dem Handy steht die Checkliste über der unteren Navigation. Du kannst sie einklappen und später wieder öffnen.",
      "Mit `Noch einmal zeigen` kannst du eine erledigte Tour wiederholen.",
      "`Angaben zu meinem Kind ändern` zeigt Angaben, Betreuungszeiten, den Heimweg und Kontakte.",
      "`moto als App auf dem Handy hinzufügen` und `Benachrichtigungen einschalten` sind zwei getrennte Touren.",
      "Der Stand gilt für dieses Elternkonto auf diesem Gerät.",
    ],
    troubleshootingDetails: [
      "Du hast `Erste Schritte ausblenden` gewählt? Dann erscheint die Checkliste auf diesem Gerät nicht mehr. Die einzelnen Anleitungen findest du weiterhin in der Hilfe.",
      "Ein Bereich fehlt? Manche Bereiche zeigt moto nur, wenn deine OGS sie nutzt.",
    ],
    related: [
      HELP_TOPICS.parentChildOverview,
      HELP_TOPICS.parentMessages,
      HELP_TOPICS.parentInstallApp,
      HELP_TOPICS.parentNotifications,
    ],
  };
}
