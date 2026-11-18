import type { HelpTopic, HelpPresenceMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Der Bereich `Geräte` der Einstellungen. Alle diese Schalter haengen an NFC
 * (`DependsOn` in backend/services/config/defaults/devices.go und
 * operations.go), stehen bei
 * einfacher Anwesenheit aber trotzdem da: `scanBinary` schaltet nur die
 * Anwesenheit um und fragt kein Ziel ab. Deshalb sagt der Artikel das zuerst.
 */
export function nfcSettingsTopic(presenceMode: HelpPresenceMode): HelpTopic {
  const tracksRooms = presenceMode !== "binary";
  return {
    id: HELP_TOPICS.leadNfcSettings,
    title: "Einstellen, was das Tablet anzeigt",
    question: "Wo stelle ich die NFC-Tablets ein?",
    summary: tracksRooms
      ? "Du setzt die Geräte-PIN und legst fest, wohin Kinder auschecken dürfen."
      : "Du setzt die PIN, mit der sich dein Team am Tablet anmeldet.",
    group: "nfc",
    audience: "lead",
    icon: "SlidersHorizontal",
    steps: [],
    instructionGroups: [
      {
        title: "Die Geräte-PIN setzen",
        description:
          "Ohne Geräte-PIN kann sich dein Team nicht am Tablet anmelden. Lege die PIN vor dem ersten Betreuungstag fest.",
        steps: [
          "Wähle unten in der Seitenleiste `Einstellungen`.",
          "Wähle den Bereich `Geräte`.",
          "Trage unter `Geräte-PIN` eine vierstellige Zahl ein. Leichte PINs wie 1234, 1111 oder 1212 nimmt moto nicht an.",
          "Gib die neue PIN an dein Team weiter.",
        ],
      },
      ...(tracksRooms
        ? [
            {
              title: "Die Ziele beim Auschecken festlegen",
              description:
                "Diese Schalter bestimmen, welche Knöpfe ein Kind am Tablet sieht, wenn es sein Armband ein zweites Mal auflegt.",
              steps: [
                "Bleibe im Bereich `Geräte`.",
                "Schalte `„Raumwechsel“ am Tablet anbieten` ein, wenn Kinder den Raum wechseln dürfen.",
                "Schalte `„Schulhof“ am Tablet anbieten` und `„Toilette“ am Tablet anbieten` nach Bedarf ein.",
              ],
              ordered: false,
            },
            {
              title: "Festlegen, ab wann Kinder nach Hause dürfen",
              description:
                "Alles dazu steht im Bereich `Geräte` unter `„Nach Hause“ am Tablet`.",
              steps: [
                "Trage bei `„Nach Hause“ ab Uhrzeit` eine Uhrzeit ein. Bei `Jederzeit` geht `nach Hause` den ganzen Tag.",
                "Soll die Abholzeit jedes Kindes zählen? Dann schalte `Abholzeit jedes Kindes beachten` ein.",
                "Trage bei `„Nach Hause“ vor der Abholzeit (Minuten)` ein, wie früh das Kind gehen darf. Bei 15 Minuten und Abholzeit 16:00 geht es ab 15:45.",
                "Schalte `„Nach Hause“ in jedem Raum anzeigen` aus, wenn Kinder nur aus dem Gruppenraum und vom Schulhof nach Hause dürfen.",
              ],
            },
          ]
        : []),
    ],
    result:
      "moto speichert jede Änderung sofort. Das Tablet übernimmt sie beim nächsten Start.",
    notes: [
      "Findest du eine Einstellung nicht? Nutze oben `Einstellung suchen`.",
      ...(tracksRooms
        ? [
            "`Schulhof` und `Toilette` legen jeweils einen passenden Raum mit an.",
            "`Name und Belegung bei vollem Raum` nennt am Tablet, welcher Raum voll ist.",
          ]
        : []),
    ],
    differences: [
      // Der Grund, warum eine OGS mit einfacher Anwesenheit hier fast nichts
      // einstellen kann: das Tablet fragt kein Ziel ab.
      ...(presenceMode === "binary"
        ? [
            "Deine OGS hält nur fest, ob ein Kind da ist. Dann wirkt hier nur die `Geräte-PIN`.",
            "Die Knöpfe zum Auschecken und die Einstellungen zu `nach Hause` ändern bei dir nichts.",
          ]
        : []),
      "Arbeitet deine OGS ohne NFC, gibt es den Bereich `Geräte` in den `Einstellungen` nicht.",
      "Die `Geräte-PIN` darf nur ändern, wer die OGS verwaltet.",
    ],
    troubleshootingDetails: [
      "Die neue PIN klappt am Tablet nicht? Starte das Tablet neu.",
      "Du findest den Bereich `Geräte` nicht? Dann arbeitet deine OGS ohne NFC.",
    ],
    related: [
      HELP_TOPICS.nfcCheckIn,
      HELP_TOPICS.leadDevices,
      HELP_TOPICS.settings,
      HELP_TOPICS.leadTabletSetup,
    ],
  };
}
