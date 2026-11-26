import type { HelpTopic, HelpPresenceMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function roomsTopic(presenceMode: HelpPresenceMode): HelpTopic {
  if (presenceMode === "binary") {
    return {
      id: HELP_TOPICS.rooms,
      title: "Räume und ihre aktuelle Belegung ansehen",
      question: "Wo sehe ich Räume und ihre aktuelle Belegung?",
      summary: "Bei einfacher Anwesenheit ordnet moto Kinder keinen Räumen zu.",
      group: "gruppen",
      audience: ["caregiver", "lead"],
      icon: "DoorOpen",
      steps: [
        "Öffne `Alle Kinder`.",
        "Prüfe dort, welche Kinder anwesend oder abwesend sind.",
      ],
      result:
        "Der Bereich `Räume` wird nicht angezeigt. moto speichert dann keinen Aufenthaltsort.",
      related: [HELP_TOPICS.webAttendance, HELP_TOPICS.studentSearch],
    };
  }
  if (presenceMode === "unknown") {
    return {
      id: HELP_TOPICS.rooms,
      title: "Räume und ihre aktuelle Belegung ansehen",
      question: "Wo sehe ich Räume und ihre aktuelle Belegung?",
      summary:
        "Der Bereich ist nur sichtbar, wenn deine OGS Aufenthaltsorte erfasst.",
      group: "gruppen",
      audience: ["caregiver", "lead"],
      icon: "DoorOpen",
      steps: [
        "Prüfe, ob `Räume` in der Seitenleiste steht.",
        "Ist der Bereich vorhanden? Öffne dort einen Raum und prüfe die Belegung.",
        "Fehlt der Bereich? Öffne `Alle Kinder`, um die Anwesenheit zu prüfen.",
      ],
      result:
        "Raumbelegungen werden nur bei detaillierter Anwesenheit angezeigt.",
      related: [HELP_TOPICS.activeSupervision, HELP_TOPICS.webAttendance],
    };
  }

  return {
    id: HELP_TOPICS.rooms,
    title: "Räume und ihre aktuelle Belegung ansehen",
    question: "Wo sehe ich Räume und ihre aktuelle Belegung?",
    summary:
      "Prüfe, welche Räume frei oder belegt sind und wer sich dort befindet.",
    group: "gruppen",
    audience: ["caregiver", "lead"],
    icon: "DoorOpen",
    steps: [],
    instructionGroups: [
      {
        title: "Einen Raum und seine Belegung ansehen",
        // #4372: die drei Begriffe einheitlich erklärt.
        description:
          "`Belegt` heißt: Im Raum läuft gerade eine Aktivität. `Frei` heißt: Gerade ist kein Kind im Raum. Ein offener Raum ist für Ortswechsel freigegeben, auch wenn dort nichts läuft. Unter `Aktuelle Aufsicht` stehen nur Aufsichten, die gerade laufen.",
        steps: [
          "Öffne `Räume` in der Seitenleiste.",
          // #4372 (01.14): offene Räume stehen als eigene Gruppe oben;
          // #8130 benennt die übrigen nach dem, was sie trennt.
          "Gibt es offene Räume, stehen sie oben unter `Offene Räume`. Dorthin dürfen Kinder jederzeit.",
          "Alle anderen stehen darunter unter `Räume für Aktivitäten`. Dort sind Kinder nur, solange eine Aktivität läuft.",
          "Klappe eine Gruppe über den Pfeil rechts ein oder aus.",
          "Suche den Raum über `Raum suchen...`.",
          // Live geprueft: kein Knopf `Filter`, sondern ein Umschalter
          // `Alle` / `Belegt` / `Frei` und eine Auswahl `Alle Gebäude`.
          "Oder wähle oben `Belegt` oder `Frei`.",
          "Grenze über `Alle Gebäude` auf ein Gebäude ein.",
          "Wähle einen Raum aus.",
          "Prüfe die aktuelle Aktivität, die Aufsicht und die Kinder im Raum.",
          // #4372: offene Räume sind nur noch über `Räume` erreichbar.
          "Bei einem offenen Raum wähle oben `Zur Aufsicht`. Dort siehst du alle Kinder im Raum.",
          "Wähle bei Bedarf ein Kind, um seine Angaben zu öffnen.",
        ],
      },
      // #4768: Reiter `Plan` mit den Terminen des Raums laut Betreuungsplan.
      {
        title: "Sehen, wann ein Raum laut Plan frei ist",
        description:
          "Der Reiter `Plan` zeigt die Termine des Betreuungsplans in diesem Raum. Ändern kannst du den Plan dort nicht.",
        steps: [
          "Öffne `Räume` und wähle einen Raum aus.",
          "Wähle den Reiter `Plan`.",
          "Wähle oben `Tag` oder `Woche`. Mit den Pfeilen wechselst du den Zeitraum.",
          "`Frei` heißt: In dieser Zeit ist im Raum nichts geplant.",
          "Ein durchgestrichener Termin mit `Abgesagt` belegt den Raum nicht.",
          "Wähle `Im Betreuungsplan ansehen`, um den Plan dieses Raums dort zu öffnen. Planende sehen dort `Im Betreuungsplan bearbeiten`.",
          "Für den PDF-Aushang brauchst du auch das Recht, die Kinderliste zu sehen.",
          "Für einen Aushang öffnest du oben rechts das Menü mit den drei Punkten. Wähle `Raumplan als PDF`. Du erhältst die angezeigte Woche als PDF.",
        ],
      },
      // #6953: Kinder direkt in diesen Raum anmelden.
      {
        title: "Kinder in diesen Raum anmelden",
        description:
          "Abwesende Kinder werden angemeldet und sind sofort in diesem Raum. Beaufsichtigst du den Raum selbst, holst du auch anwesende Kinder aus anderen Räumen dazu.",
        steps: [
          "Öffne `Räume` und wähle den Raum aus.",
          "Wähle bei `Kinder im Raum` den Knopf `Kinder anmelden`.",
          "Suche die Kinder über Name, Klasse oder Gruppe.",
          "Kreuze die Kinder an. Rechts steht, wo das Kind gerade ist.",
          "Wähle unten den Knopf mit der Zahl der Kinder, zum Beispiel `2 Kinder anmelden`.",
        ],
      },
      {
        title: "Kinder ohne Raum in einen Raum setzen",
        description:
          "Führst du selbst die Aufsicht, stehen nur deine Räume zur Wahl. Mit dem Recht für alle Räume steht die ganze Liste da. Dann stehen auch offene Räume in der Liste, mit dem Zusatz `(offener Raum)`. So bleibt ein Kind nach seinem Angebot im Raum, ohne an einem Angebot teilzunehmen. Dieselbe Karte steht auch unter `Alle Kinder`, wenn du dort nach `Unterwegs` filterst.",
        steps: [
          "Wähle oben die Karte `Unterwegs`.",
          "Wähle die gewünschten Kinder aus.",
          "Wähle unter `Zielraum` den Raum aus.",
          "Wähle `In Raum setzen`.",
        ],
      },
    ],
    result:
      "Du siehst die aktuelle Belegung des Raums. Unter `Unterwegs` stehen anwesende Kinder, die noch keinem Raum zugeordnet sind. Die Anzeige ändert sich, sobald Kinder den Raum wechseln.",
    troubleshootingDetails: [
      "Ist `Kinder anmelden` ausgegraut? Dann läuft im Raum gerade keine Aufsicht und er ist nicht freigegeben. Sobald dort eine Aufsicht läuft, kannst du Kinder anmelden.",
      "Steht unter `Zielraum` `Keine aktiven Räume`? Dann läuft gerade keine Aufsicht, in die du Kinder setzen kannst.",
      "Fehlt unter `Unterwegs` die Auswahl der Kinder? Dann erfasst deine OGS die Anwesenheit nicht über die App. Frage deine Leitung.",
      "Fehlt der Reiter `Plan` oder `Raumplan als PDF`? Frag deine Leitung, ob sie deinen Zugang prüft.",
    ],
    related: [HELP_TOPICS.activeSupervision, HELP_TOPICS.changeLocation],
  };
}
