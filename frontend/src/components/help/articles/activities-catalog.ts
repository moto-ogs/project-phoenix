import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Aktivitaetenkatalog unter `/database/activities`. Nur mit NFC: die Seite
 * gehört im Modul-Register (lib/module-register.ts) zu NFC-Anwesenheit.
 * Deshalb auch in NFC_ONLY_TOPIC_IDS.
 */
export function activitiesCatalogTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadActivities,
    title: "Aktivitäten anlegen",
    question: "Wie lege ich Aktivitäten an?",
    summary:
      "Aktivitäten sind Angebote neben der Gruppe, zum Beispiel eine AG.",
    group: "einrichten",
    audience: "lead",
    icon: "Sparkles",
    steps: [],
    instructionGroups: [
      {
        title: "Eine Aktivität anlegen",
        steps: [
          "Klappe in der Seitenleiste `Verwaltung` auf.",
          "Öffne `Datenverwaltung` und danach `Aktivitäten`.",
          "Wähle oben rechts `+ Aktivität`.",
          "Trage bei `Name` die Bezeichnung des Angebots ein.",
          "Wähle eine `Kategorie`.",
          "Trage bei Bedarf `Maximale Teilnehmer` ein.",
          "Wähle bei Bedarf einen `Hauptbetreuung`.",
          "Wähle `Erstellen`.",
        ],
      },
      {
        title: "Eine Aktivität ändern",
        steps: [
          "Öffne `Aktivitäten` und wähle die Aktivität aus der Liste.",
          "Ändere die Angaben unter `Stammdaten`.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Eine Aktivität löschen",
        steps: [
          "Öffne `Aktivitäten` und wähle die Aktivität aus der Liste.",
          "Wähle oben rechts `Löschen`.",
          "Bestätige mit `Ja, löschen`.",
        ],
      },
    ],
    result:
      "Die Aktivität steht sofort zur Auswahl. Dein Team kann sie am Tablet starten.",
    notes: [
      "`Maximale Teilnehmer` steht zunächst auf 20. Leere das Feld für keine Begrenzung.",
      "Über `Kategorie` filterst du die Liste auf eine Art von Angebot.",
    ],
    differences: [
      "Auf dem Handy steht statt `+ Aktivität` ein rundes Plus unten rechts.",
      "`Schulhof Freispiel` und `WC` legt moto selbst an. Deine Namen sind fest, und `Löschen` fehlt.",
    ],
    troubleshootingDetails: [
      "Fehlt `Datenverwaltung` in der Seitenleiste? Dann fehlen dir die Leitungsrechte. Frage deine Leitung.",
      "Fehlt die passende `Kategorie`? Lege sie in der `Datenverwaltung` unter `Terminkategorien` an.",
      "Meldet moto oder das Tablet, die Aktivität ist voll? Dann ist `Maximale Teilnehmer` erreicht. Steht bei ihr `Überbucht`, sind sogar mehr Kinder da als erlaubt. Es kommen erst wieder Kinder dazu, wenn es weniger sind. Oder du erhöhst die Zahl. Die Grenze des Raums hilft hier nicht.",
    ],
    related: [
      HELP_TOPICS.leadRooms,
      HELP_TOPICS.leadCarePlan,
      HELP_TOPICS.dataManagement,
    ],
  };
}
