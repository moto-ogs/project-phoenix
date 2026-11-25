import type { HelpTopic, HelpPresenceMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

// OGS-Leitung und Verwaltung. Geruest nach der Informationsarchitektur
// (#2229, Abschnitt 7): Einrichtung zuerst, danach die wiederkehrende
// Verwaltung. Die Ablaeufe sind noch nicht Schritt fuer Schritt gegen die App
// geprueft, deshalb bleiben es Entwuerfe.
//
// Was eine Leitung genauso erledigt wie eine Betreuungskraft, steht nicht
// hier: `login`, `installApp`, `studentSearch`, `parentMessage`,
// `parentRequests`, `dayLog` und `sharedFiles` tragen beide Rollen in
// `audience` und erscheinen dadurch in beiden Seitenleisten.
/**
 * Raumkatalog unter `/database/rooms`. Die Seite selbst haengt an keiner
 * Einstellung: sie steht weder in `BINARY_HIDDEN_HREFS` noch in
 * `NFC_ONLY_HREFS` (sidebar.tsx), und jede Gruppe bekommt ueber
 * `groups.config.tsx` einen Raum zugewiesen -- auch bei einfacher Anwesenheit.
 *
 * Zwei Felder wirken aber nur bei detaillierter Anwesenheit: `scanBinary`
 * (backend/modules/devicescan/internal/application/scan.go) schaltet nur die
 * Anwesenheit um und legt keinen Raumbesuch an, und `checkRoomCapacity`
 * (checkin.go) zaehlt genau diese offenen Raumbesuche.
 */
export function roomsCatalogTopic(presenceMode: HelpPresenceMode): HelpTopic {
  const tracksRooms = presenceMode !== "binary";
  return {
    id: HELP_TOPICS.leadRooms,
    title: "Räume anlegen",
    question: "Wie lege ich die Räume der OGS an?",
    summary: "Lege jeden Raum einmal an. Gruppen brauchen einen Raum.",
    group: "einrichten",
    audience: "lead",
    icon: "Building2",
    // Kein `requirements`: wer die Leitungshilfe liest, hat die Rechte der
    // Leitung. Der Fall „Bereich fehlt trotzdem" steht bei den Problemen,
    // wo er zu einer Handlung fuehrt.
    steps: [],
    instructionGroups: [
      {
        title: "Einen Raum anlegen",
        steps: [
          "Klappe in der Seitenleiste `Verwaltung` auf.",
          "Öffne `Datenverwaltung` und danach `Räume`.",
          "Wähle oben rechts `+ Raum`.",
          "Trage bei `Raumname` den Namen des Raums ein.",
          "Wähle eine `Kategorie`.",
          "Trage bei Bedarf `Gebäude` und `Etage` ein.",
          "Wähle bei Bedarf eine `Farbe`.",
          "Wähle `Erstellen`.",
        ],
      },
      {
        title: "Einen Raum ändern",
        steps: [
          "Öffne `Räume` und wähle den Raum aus der Liste.",
          "Ändere die Angaben unter `Stammdaten`.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Einen Raum sperren",
        description:
          "Zum Beispiel bei einem Wasserschaden. In der Zeit kannst du den Raum für neue Termine nicht wählen. Termine, die schon im Raum liegen, bleiben dort.",
        steps: [
          "Öffne `Räume` und wähle den Raum aus der Liste.",
          "Öffne den Reiter `Stammdaten`.",
          "Wähle bei `Sperren` den Knopf `Raum sperren`.",
          "Trage den `Grund` ein und wähle `Von` und `Bis`.",
          "Prüfe die Liste `Termine in dieser Zeit`. Verlege diese Termine im Raumplan selbst.",
          "Wähle `Sperren`.",
        ],
      },
      {
        title: "Eine Sperre aufheben",
        steps: [
          "Öffne beim Raum den Reiter `Stammdaten`.",
          "Öffne bei `Sperren` das Menü neben der Sperre.",
          "Wähle `Sperre aufheben` und bestätige mit `Aufheben`.",
        ],
      },
      {
        title: "Einen Raum löschen",
        description:
          "moto zeigt vorher, wo der Raum noch genutzt wird. Hat der Raum schon Termine oder Anwesenheiten, archiviert moto ihn. Der Verlauf behält dann den Raum.",
        steps: [
          "Öffne `Räume` und wähle den Raum aus der Liste.",
          "Wähle oben rechts `Löschen`.",
          "Lies, was mit dem Raum passiert.",
          "Bestätige mit `Ja, löschen` oder `Ja, archivieren`.",
        ],
      },
    ],
    result:
      "Der Raum steht sofort zur Auswahl. Du kannst ihn einer Gruppe zuweisen.",
    notes: [
      "Die Farbe erscheint später an jedem Ort-Schild dieses Raums.",
      "Oben rechts fasst du die Liste unter `Gruppieren` nach `Gebäude`, `Etage` oder `Keine` zusammen.",
      ...(tracksRooms
        ? [
            "`Maximale Belegung` begrenzt, wie viele Kinder gleichzeitig im Raum sind.",
            "Mit `Offener Raum` dürfen Kinder den Raum jederzeit als Ziel wählen. Eine Aufsicht ersetzt das nicht.",
            "Ein heute gesperrter Raum fehlt am Tablet. Eine Aktivität kann dort nicht starten.",
          ]
        : [
            "`Maximale Belegung` und `Offener Raum` wirken bei dir nicht. Deine OGS hält nur fest, ob ein Kind da ist.",
          ]),
    ],
    differences: [
      "Auf dem Handy steht statt `+ Raum` ein rundes Plus unten rechts.",
      "`Schulhof`, `WC` und `Toilette` legt moto selbst an. Ihre Namen sind fest, und `Löschen` fehlt.",
      "Beim `WC` und bei der `Toilette` fehlen zusätzlich `Farbe` und `Offener Raum`.",
    ],
    troubleshootingDetails: [
      "Fehlt `Datenverwaltung` in der Seitenleiste? Dann fehlen dir die Leitungsrechte. Frage deine Leitung.",
      "Lässt sich ein Raum nicht löschen? Dann wird er noch genutzt. Der Dialog nennt Aktivitäten, Termine, Gruppen und Geräte. Wähle dort zuerst einen anderen Raum.",
      ...(tracksRooms
        ? [
            "Meldet moto oder das Tablet, der Raum ist voll? Dann ist `Maximale Belegung` erreicht. Erhöhe die Zahl hier. Ist dagegen die Aktivität voll, ändere `Maximale Teilnehmer` unter `Aktivitäten`.",
          ]
        : []),
    ],
    related: [
      HELP_TOPICS.leadGroups,
      HELP_TOPICS.leadActivities,
      HELP_TOPICS.dataManagement,
    ],
  };
}
