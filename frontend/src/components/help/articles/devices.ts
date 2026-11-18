import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/database/devices`. Nur mit NFC (NFC_ONLY_HREFS, sidebar.tsx:369). */
export function devicesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadDevices,
    title: "NFC-Geräte verwalten",
    question: "Wie verwalte ich unsere NFC-Tablets?",
    summary: "Du siehst alle Geräte deiner OGS und ihren Zustand.",
    group: "nfc",
    audience: "lead",
    icon: "Devices",
    steps: [],
    instructionGroups: [
      {
        title: "Die Geräte nachsehen",
        description:
          "Ein geliefertes Tablet steht schon in der Liste. Du musst es nicht anlegen.",
        steps: [
          "Klappe in der Seitenleiste `Verwaltung` auf.",
          "Öffne `Datenverwaltung` und danach `Geräte`.",
          "Wähle ein Gerät aus der Liste.",
          "Lies bei `Verbindung`, ob das Gerät `Online` oder `Offline` ist.",
          "Lies bei `Letzter Standort`, wo es zuletzt benutzt wurde.",
          "Lies bei `Status`, ob es `Aktiv` ist.",
        ],
      },
      {
        title: "Ein Gerät von Hand anlegen",
        description:
          "Nur nötig, wenn ein Gerät nicht in der Liste steht. Frage vorher beim moto-Team nach.",
        steps: [
          "Wähle oben rechts `+ Gerät`.",
          "Trage bei `Geräte-ID` die Kennung des Geräts ein.",
          "Wähle bei `Gerätetyp` `Terminal` oder `Info-Point`.",
          "Trage bei `Gerätename` einen Namen ein, zum Beispiel `Eingang`.",
          "Wähle `Erstellen`.",
        ],
      },
      {
        title: "Ein Gerät entfernen",
        description:
          "Zum Beispiel, wenn ein Tablet kaputt ist oder nicht mehr gebraucht wird.",
        steps: [
          "Wähle das Gerät aus der Liste.",
          "Wähle oben rechts `Entfernen`.",
          "Lies, was beim Entfernen passiert.",
          "Wähle `Ja, entfernen` und danach `Gerät entfernen`.",
        ],
      },
    ],
    result:
      "Du siehst für jedes Gerät, ob es erreichbar ist und wo es zuletzt stand.",
    notes: [
      "Steht bei `Letzter Standort` `Noch nicht verwendet`, wurde am Gerät noch nichts gescannt.",
      "Nach dem Anlegen zeigt moto einmalig einen Zugangscode. Nur das Gerät braucht ihn.",
      "Gib diesen Code nicht weiter. Er ist danach nicht mehr zu sehen.",
      "Ein entferntes Gerät kann sich nicht mehr anmelden. Bisherige Anwesenheiten bleiben erhalten.",
    ],
    differences: [
      "Arbeitet deine OGS ohne NFC, fehlt `Geräte` in der `Datenverwaltung`.",
    ],
    troubleshootingDetails: [
      "Ein Gerät meldet sich nicht? Prüfe `Verbindung` und `Status` in der Liste.",
      "`Offline` und der Strom stimmt? Prüfe das WLAN am Standort des Geräts.",
      "Entfernen klappt nicht, weil eine Sitzung läuft? Beende die Sitzung am Gerät und versuche es noch einmal.",
    ],
    related: [
      HELP_TOPICS.leadNfcSettings,
      HELP_TOPICS.leadTabletSetup,
      HELP_TOPICS.nfcProblem,
      HELP_TOPICS.leadInfoDisplays,
    ],
  };
}
