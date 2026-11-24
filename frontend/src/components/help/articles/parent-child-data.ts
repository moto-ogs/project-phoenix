import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Bereich `Angaben zum Kind` (i18n `parentMasterData`). Drei Arten von
 * Feldern: direkt aenderbar, nur auf Anfrage, und Gesundheitshinweise, die
 * sofort gespeichert werden. Dazu der Widerruf der Foto-Einwilligung
 * (i18n `parentChild.consents`), auch nach Betreuungsende (#6494), und der
 * Weg über die OGS ohne Widerrufsrecht im Portal (#6650).
 */
export function parentChildDataTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentChildData,
    title: "Angaben zu meinem Kind ansehen und ändern",
    question: "Wie ändere ich die Angaben zu meinem Kind?",
    summary: "Manches änderst du selbst. Anderes prüft die OGS zuerst.",
    group: "mein-kind",
    audience: "parent",
    icon: "FileText",
    steps: [],
    instructionGroups: [
      {
        title: "Die Angaben öffnen",
        steps: ["Tippe unten auf `Mein Kind`.", "Wähle den Reiter `Angaben`."],
      },
      {
        title: "Name, Geburtsdatum oder Klasse ändern",
        steps: [
          "Gehe zum Abschnitt `Persönliche Angaben`.",
          "Tippe auf `Änderungen anfragen`.",
          "Ändere nur die Angaben, die nicht mehr stimmen.",
          "Tippe auf `Anfrage an OGS senden`.",
        ],
      },
      {
        title: "Gesundheitshinweise eintragen",
        steps: [
          "Gehe zum Abschnitt `Gesundheit`.",
          "Trage bei `Gesundheitshinweise und Allergien` ein, was wichtig ist.",
          "Die Eingabe wird automatisch gespeichert.",
        ],
      },
      {
        title: "Foto-Einwilligung widerrufen",
        steps: [
          "Gehe zum Abschnitt `Einwilligungen und Bestätigungen`.",
          "Tippe bei `Foto-Einwilligung` auf `Widerrufen`.",
          "Tippe auf `Jetzt widerrufen`.",
        ],
      },
      {
        // #3844: wenn der Träger den Eltern-Stopp eingeschaltet hat oder das Kind gestoppt ist.
        title: "Raumverlauf und Stimmung stoppen",
        description:
          "Diese Zeile siehst du, wenn deine Schule das erlaubt oder dein Kind schon gestoppt ist.",
        steps: [
          "Gehe zum Abschnitt `Einwilligungen und Bestätigungen`.",
          "Tippe bei `Raumverlauf und Stimmung` auf `Stoppen`.",
          "Tippe auf `Jetzt stoppen`.",
          "moto löscht sofort, in welchen Räumen dein Kind war. Danach speichert moto keine Räume und keine Stimmung mehr. Die Betreuung sieht weiter, wo dein Kind gerade ist. Schon gespeicherte Stimmungen löscht moto erst nach der üblichen Frist.",
          "Mit `Wieder speichern` hebst du den Stopp für dein Kind auf. Deine Schule entscheidet, ob Raumverlauf und Stimmung gespeichert werden. Gelöschtes kommt nicht zurück.",
        ],
      },
    ],
    result:
      "Unter dem Feld steht dann `Beantragte Änderung` mit dem neuen Wert und `In Prüfung`. Bis zur Bestätigung gilt der Wert darüber.",
    notes: [
      "Gesundheitshinweise gehen sofort an das Team, ohne Prüfung.",
      "Du möchtest eine offene Anfrage ändern? Tippe unter `Beantragte Änderung` auf `Anfrage bearbeiten`.",
      "Mit der Foto-Einwilligung darf die OGS dein Kind fotografieren und ein Foto von deinem Kind in moto speichern.",
      "Nach dem Widerruf löscht moto ein gespeichertes Foto deines Kindes.",
      "Der Widerruf gilt sofort. Er gilt auch, wenn dein Kind in den Ferien an einer anderen Schule betreut wird. Das Team dort sieht dann sofort, dass keine Einwilligung vorliegt.",
      "Nach dem letzten Betreuungstag löscht moto das Foto und die Foto-Einwilligung in der Nacht danach von selbst. Bis dahin kannst du weiter widerrufen. Neu geben kannst du die Einwilligung dann nicht mehr.",
    ],
    differences: [
      "Unter einem Feld steht schon `Beantragte Änderung`? Dann wartet diese Änderung noch auf die OGS.",
      "Bei `Raumverlauf und Stimmung` steht `Gestoppt`, aber es gibt keinen Knopf? Dann hebt die OGS den Stopp auf.",
    ],
    troubleshootingDetails: [
      "Du siehst bei `Foto-Einwilligung` kein `Widerrufen` oder hast kein Elternportal? Sage der OGS Bescheid. Die OGS trägt den Widerruf für dich ein.",
      "moto sagt, das Bearbeiten sei deaktiviert? Dann nimmt deine OGS keine Änderungen über die App an. Schreibe ihr eine Nachricht.",
    ],
    related: [
      HELP_TOPICS.parentGuardians,
      HELP_TOPICS.parentChildOverview,
      HELP_TOPICS.parentFeatureMissing,
    ],
  };
}
