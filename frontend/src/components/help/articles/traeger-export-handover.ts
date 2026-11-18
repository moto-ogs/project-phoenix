import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function traegerExportHandoverTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerExportHandover,
    title: "Exporte an Empfänger übergeben",
    question:
      "Wie schickt moto die Dateien direkt an Kämmerei oder Steuerbüro?",
    summary:
      "moto kann die Sollstellung, die DATEV-Datei und die Lastschriftdatei selbst beim Empfänger ablegen. Jede Datei geht an genau einen Empfänger, zum Beispiel die Sollstellung an die Kämmerei und die DATEV-Datei an das Steuerbüro. Herunterladen kannst du die Dateien weiterhin.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "FolderOpen",
    requirements: [
      "Deine Rolle im Träger-Büro ist Abrechnung.",
      "Jeder Empfänger hat dir Adresse, Benutzername, Passwort, Zielordner und Fingerabdruck genannt.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Empfänger eintragen",
        description: "Das machst du einmal je Empfänger.",
        steps: [
          "Wähle `Abrechnung`, dann den Reiter `Exporte`.",
          "Wähle oben rechts das Menü mit den drei Punkten und dann `Empfänger der Exporte`. Wähle dort `Empfänger hinzufügen`.",
          "Gib einen `Name` ein, zum Beispiel „Kämmerei“.",
          "Trage `Adresse`, `Port`, `Benutzername`, `Passwort`, `Zielordner` und `Fingerabdruck` ein.",
          "Wähle `Empfänger anlegen`. In der Liste `Empfänger` steht er dann mit `Bereit`.",
        ],
      },
      {
        title: "Dateien zuordnen",
        description: "So legst du fest, welche Datei an wen geht.",
        steps: [
          "Öffne über das Menü mit den drei Punkten oben rechts `Empfänger der Exporte`.",
          "Wähle unter `Welche Datei geht wohin` bei jeder Datei einen Empfänger. `Nur herunterladen` heißt: moto übergibt diese Datei nicht.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Datei übergeben",
        steps: [
          "Wähle `Abrechnung`, dann den Reiter `Exporte`.",
          "Wähle beim Lauf das Menü mit den drei Punkten. Wähle unter `Übergabe` `Sollstellung übergeben` oder `DATEV-Datei übergeben`. Im Menü steht, an welchen Empfänger die Datei geht.",
          "Kommt die Datei an, zeigt moto eine kurze Meldung mit dem Dateinamen und dem Empfänger.",
          "Die Lastschriftdatei übergibst du bei der Lastschrift des Laufs mit `Übergeben`.",
        ],
      },
    ],
    result:
      "Die Datei steht im `Exportprotokoll` mit dem Vermerk `An Kämmerei übergeben` (mit dem Namen deines Empfängers). Unter `Letzte Übergaben` steht jeder Versuch mit Empfänger und Ergebnis. Ging die letzte Übergabe schief, zeigt die Liste `Empfänger` das beim Empfänger an.",
    notes: [
      "Jede Übergabe ist eine neue Datei mit neuer Nummer, wie ein Download.",
      "Ist dieselbe Datei schon bei diesem Empfänger, fragt moto vorher nach. So bucht die Kämmerei nichts doppelt. Ein anderer Empfänger hatte die Datei noch nicht, dann fragt moto nicht.",
      "Hat der Empfänger eine DATEV-Datei verloren, wähle beim Lauf das Menü mit den drei Punkten und dann `Alle DATEV-Buchungen erneut übergeben`. Kam eine DATEV-Datei nicht an, enthält die nächste ihre Buchungen wieder.",
      "Das Passwort speichert moto verschlüsselt. Es wird nie wieder angezeigt. Änderst du Adresse, Port, Benutzername oder Fingerabdruck, gib es noch einmal ein.",
      "Mit `Empfänger entfernen` auf der Seite des Empfängers löschst du Adresse und Passwort. Seine Dateien kannst du danach nur herunterladen, bis du sie einem anderen Empfänger zuordnest. Der Verlauf der Übergaben bleibt.",
    ],
    differences: [
      "Im Menü des Laufs fehlt `Übergabe`? Dir fehlt das Recht `Finanz-Export`, oder moto konnte den Empfänger nicht lesen. Lade die Seite neu. Die Lastschriftdatei übergibst du auch ohne dieses Recht.",
      "Im Menü steht `Empfänger einrichten` oder `Empfänger zuordnen`? Diese Datei hat noch keinen Empfänger, oder beim Empfänger fehlen Angaben oder die Übergabe ist ausgeschaltet. Das Menü nennt den Grund.",
    ],
    troubleshootingDetails: [
      "`Nicht angekommen` mit dem Hinweis auf den Fingerabdruck? Frage beim Empfänger nach dem Fingerabdruck für den RSA-Schlüssel.",
      "`Die Anmeldung wurde abgelehnt`? Prüfe Benutzername und Passwort.",
      "`Ergebnis unklar`? Frage beim Empfänger nach, ob die Datei da ist. Erst dann übergibst du sie noch einmal.",
      "`Diese Adresse ist nicht erlaubt`? moto übergibt nur an Adressen im Internet, nicht ins eigene Netz.",
    ],
    related: [
      HELP_TOPICS.traegerFinanceExports,
      HELP_TOPICS.traegerDatevExport,
      HELP_TOPICS.traegerSepaDebitFile,
    ],
  };
}
