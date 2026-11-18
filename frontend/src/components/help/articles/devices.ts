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
          "Lies oben, ob das Gerät `Online` oder `Offline` ist und wann es sich zuletzt gemeldet hat.",
          "Lies bei `Raum`, wo das Gerät steht.",
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
        title: "Ein Gerät sperren",
        description:
          "Zum Beispiel, wenn ein Tablet verschwunden ist oder nicht benutzt werden soll. Du kannst es jederzeit wieder entsperren.",
        steps: [
          "Wähle das Gerät aus der Liste.",
          "Wähle unter `Zugang` die Schaltfläche `Sperren`.",
          "Zum Entsperren wähle im gelben Hinweis `Entsperren`.",
        ],
      },
      {
        title: "Nachsehen, wer ein Gerät geändert hat",
        description:
          "Zum Beispiel, wenn ein Gerät plötzlich gesperrt ist oder anders heißt.",
        steps: [
          "Wähle das Gerät aus der Liste.",
          "Wähle den Reiter `Verlauf`.",
          "Lies, wer das Gerät wann angelegt, geändert, gesperrt oder entsperrt hat.",
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
      "Du siehst für jedes Gerät, ob es erreichbar ist, wo es steht und wer es zuletzt geändert hat.",
    notes: [
      "Steht oben `Noch nie verbunden`, hat sich das Gerät noch nie bei moto gemeldet.",
      "Änderungen durch das moto-Team stehen im `Verlauf` als `moto-Support`.",
      "Nach dem Anlegen zeigt moto einmalig einen Zugangscode. Nur das Gerät braucht ihn.",
      "Gib diesen Code nicht weiter. Er ist danach nicht mehr zu sehen.",
      "Ein gesperrtes Gerät kann sich sofort nicht mehr anmelden. Es bleibt mit Raum und bisherigen Anwesenheiten in der Liste und zeigt `Gesperrt`.",
      "Ein entferntes Gerät kann sich nicht mehr anmelden. Bisherige Anwesenheiten bleiben erhalten.",
    ],
    differences: [
      "Arbeitet deine OGS ohne NFC, fehlt `Geräte` in der `Datenverwaltung`.",
    ],
    troubleshootingDetails: [
      "Ein Gerät meldet sich nicht? Wähle es aus und prüfe oben `Online` oder `Offline` und den `Status`.",
      "`Offline` und der Strom stimmt? Prüfe das WLAN am Standort des Geräts.",
      "Ein Gerät meldet „gesperrt“ oder „nicht aktiv“? Prüfe, ob in der Liste `Gesperrt` steht, und wähle `Entsperren`.",
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
