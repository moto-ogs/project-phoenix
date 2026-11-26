import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/einstellungen/zustaendigkeiten` und der Reiter
 * „Zuständigkeiten“ einer Schule (#4811): Träger, Schulträger oder Gemeinde
 * für Verträge, Abrechnung und Personal, mit den Angaben der Stelle je
 * Schule. Beide Fälle der Abrechnung (#8040): die Stelle rechnet selbst ab,
 * oder der Träger.
 */
export function traegerResponsibilitiesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerResponsibilities,
    title: "Zuständigkeiten festlegen",
    question:
      "Wie lege ich fest, wer Verträge schließt, abrechnet und Personal anstellt?",
    summary:
      "Pro Schule ist dein Träger, der Schulträger oder die Gemeinde zuständig. Du legst das für alle Schulen fest und trägst die Angaben der Stelle bei der Schule ein. Rechnet eine Stelle selbst ab, stellt sie ihre Schreiben mit eigener Gläubiger-ID aus.",
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
          "In der Karte `Für alle Schulen` wählst du pro Frage eine Stelle: `Träger`, `Schulträger` oder `Gemeinde`.",
          "moto speichert die Wahl sofort. Unter `Pro Schule` siehst du, wer an jeder Schule zuständig ist.",
        ],
      },
      {
        title: "Schulträger oder Gemeinde einer Schule eintragen",
        description:
          "Eine Stelle ist erst zuständig, wenn ihr Name und ihre Anschrift bei der Schule stehen. Bis dahin bleibt dein Träger zuständig.",
        steps: [
          "Wähle unter `Pro Schule` die Schule. Der Reiter `Zuständigkeiten` der Schule öffnet sich.",
          "Wähle in der Karte `Schulträger` oder `Gemeinde` den Knopf `Angaben eintragen`.",
          "Trage Name, Straße, Postleitzahl und Ort ein. Die Ansprechperson ist freiwillig.",
          "Rechnet die Stelle mit den Eltern ab? Dann trage auch Gläubiger-ID und Bankverbindung ein.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Fall 1: Schulträger oder Gemeinde rechnet selbst ab",
        description:
          "Die Stelle stellt Rechnungen und Bescheide in eigenem Namen aus und zieht Lastschriften mit ihrer eigenen Gläubiger-ID auf ihr eigenes Konto ein.",
        steps: [
          "Wähle bei `Wer rechnet mit den Eltern ab?` die Stelle: für alle Schulen hier, für eine Schule in der Schul-App.",
          "Trage bei der Schule Name, Anschrift, Gläubiger-ID und Bankverbindung der Stelle ein. Erst dann rechnet sie ab. Unter `Pro Schule` steht sonst `Bankdaten fehlen`.",
          "Unter `Abrechnung durch …` siehst du, was der Stelle noch fehlt. Jede Zeile führt dorthin, wo du es einträgst.",
          "Lege in `Einstellungen` › `Abrechnung` die Nummernkreise der Stelle fest. Lege einen für Ferien und einen für Monatsbeiträge an. Nimm ein eigenes Kürzel.",
          "Prüfe in `Einstellungen` › `Dokumentarten` das Schreiben der Stelle. Ohne deine Wahl stellt sie einen Gebührenbescheid aus. Dafür braucht die Vorlage `Bescheid` eine Rechtsbehelfsbelehrung.",
          "Familien, die per Lastschrift zahlen, brauchen ein neues Mandat für die Stelle. Ein Mandat für deinen Träger gilt nicht für sie. Erfasse die neuen Mandate unter `Abrechnung` › `Lastschrift`.",
          "Gib den nächsten Lauf frei. Die Schreiben der Schule nennen die Stelle als Absender, mit ihrem Konto und ihrer Gläubiger-ID.",
          "Im Lauf steht unter `Lastschrift von …` eine eigene Datei der Stelle. Lade sie herunter und gib sie an die Stelle weiter. Die Stelle reicht sie bei ihrer Bank ein. Bestätige es danach hier.",
        ],
      },
      {
        title: "Fall 2: Dein Träger rechnet ab",
        description: "So ist es ohne deine Wahl.",
        steps: [
          "Wähle bei `Wer rechnet mit den Eltern ab?` den `Träger`, oder lass die Frage beim Standard.",
          "Dein Träger braucht Briefkopf, Bankverbindung, Gläubiger-ID und Nummernkreise in den `Einstellungen`. Die Startseite zeigt, was noch fehlt.",
          "Die Mandate der Familien gelten für die Gläubiger-ID deines Trägers.",
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
      "Neue Betreuungsverträge der Schule nennen die zuständige Stelle als Absender und, wenn die Vertragsbedingungen keinen Vertragspartner nennen, als Vertragspartner. Neue Rechnungen und Bescheide nennen die Stelle, die abrechnet, mit ihrem Konto und ihrer Gläubiger-ID. Die Personalakte nennt die Stelle beim Einsatzort als Arbeitgeber.",
    notes: [
      "Schon verschickte Verträge bleiben, wie sie sind. Auch Erinnerungen und die Seite zum Unterschreiben nennen weiter die Stelle, die den Vertrag ausgestellt hat.",
      "Auf dem Vertrag einer anderen Stelle stehen das Logo und die Fußzeile deines Trägers nicht.",
      "Ein Wechsel gilt für Schreiben, die danach freigegeben werden. Ausgestellte Rechnungen, Bescheide und Lastschriften behalten ihren Absender und ihre Gläubiger-ID. Ein Storno nimmt den Absender seiner Rechnung.",
      "Haben Geschwister an zwei Schulen verschiedene Stellen, bekommt die Familie zwei Schreiben und braucht zwei Mandate. In den Ferien rechnet die Stelle der Schule ab, die das Kind besucht.",
      "Sollstellung und DATEV-Datei enthalten nur die Schreiben deines Trägers. Die Schreiben einer Stelle, die selbst abrechnet, bucht sie in ihrem eigenen Haushalt.",
      "Stellt eine Gemeinde oder ein Schulträger an, wählst du unter `Lohnexport` > `Einrichtung`: eine Lohndatei für den ganzen Träger oder eine pro Arbeitgeber.",
    ],
    troubleshootingDetails: [
      "Bei einer Schule steht `Angaben fehlen`? Die gewählte Stelle hat dort noch keinen Namen und keine Anschrift. Trage sie bei der Schule ein.",
      "Bei `Abrechnung` steht `Bankdaten fehlen`? Trage Gläubiger-ID und Bankverbindung bei der Stelle ein. Beides muss da sein. Bis dahin rechnet dein Träger ab.",
      "Die Freigabe meldet einen fehlenden Nummernkreis? Die Stelle braucht ein eigenes Muster. Lege es in `Einstellungen` › `Abrechnung` fest.",
      "moto lehnt eine Gläubiger-ID ab, weil sie schon bei einer anderen Schule steht? Eine Gläubiger-ID gehört zu genau einem Konto. Trag dort dasselbe Konto ein.",
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
