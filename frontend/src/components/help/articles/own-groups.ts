import type { HelpTopic, HelpPresenceMode, HelpGroupMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function ownGroupsTopic(
  presenceMode: HelpPresenceMode,
  groupMode: HelpGroupMode,
): HelpTopic {
  if (groupMode === "open_care") {
    return {
      id: HELP_TOPICS.ownGroups,
      title: "Gruppen ansehen",
      question: "Wie sehe ich meine Gruppen an?",
      summary:
        "Bei offener Betreuung gibt es keine festen eigenen Gruppen in moto.",
      group: "gruppen",
      audience: ["caregiver", "lead"],
      icon: "UsersThree",
      steps: [
        "Öffne `Alle Kinder`.",
        "Nutze die Suche oder die Filter für die benötigten Kinder.",
      ],
      result:
        "Du siehst die Kinder der OGS gemeinsam. Der Bereich `Gruppen` wird nicht angezeigt.",
      related: [HELP_TOPICS.studentSearch, HELP_TOPICS.webAttendance],
    };
  }
  if (groupMode === "unknown") {
    return {
      id: HELP_TOPICS.ownGroups,
      title: "Gruppen ansehen",
      question: "Wie sehe ich meine Gruppen an?",
      summary:
        "Ob du eigene Gruppen siehst, hängt von der Arbeitsweise deiner OGS ab.",
      group: "gruppen",
      audience: ["caregiver", "lead"],
      icon: "UsersThree",
      steps: [
        "Prüfe, ob `Gruppen` in der Seitenleiste steht.",
        "Ist der Bereich vorhanden? Wähle dort die gewünschte Gruppe.",
        "Fehlt der Bereich? Öffne `Alle Kinder` und nutze Suche und Filter.",
      ],
      result:
        "Du siehst die Kinder entweder in festen eigenen Gruppen oder in einer gemeinsamen Kinderliste.",
      related: [HELP_TOPICS.studentSearch, HELP_TOPICS.missingChildOrGroup],
    };
  }

  const statusResult =
    presenceMode === "detailed"
      ? "Die Karten zeigen die geplanten Zeiten und den aktuellen Aufenthaltsort der Kinder."
      : "Die Karten zeigen die geplanten Zeiten und die Anwesenheit der Kinder.";

  return {
    id: HELP_TOPICS.ownGroups,
    title: "Gruppen ansehen",
    question: "Wie sehe ich meine Gruppen an?",
    summary: "Wähle eine Gruppe und siehst du ihre Kinder.",
    group: "gruppen",
    audience: ["caregiver", "lead"],
    icon: "UsersThree",
    steps: [
      "Öffne `Gruppen` in der Seitenleiste.",
      "Wähle die gewünschte Gruppe. Deine eigene Gruppe ist mit `Meine Gruppe` markiert.",
      "Prüfe die Zahlen für `krank` und `entschuldigt`.",
      "Suche bei Bedarf über `Name suchen...` nach einem Kind.",
      // Live geprueft: die Seite hat keinen Knopf `Filter`, sondern einen
      // Umschalter fuer die Reihenfolge und eine Auswahl fuer den Ort.
      "Ordne die Liste nach `Alphabetisch`, `Nächste Ankunft` oder `Nächste Abholung`.",
      "Grenze über `Alle Orte` auf einen Aufenthaltsort ein.",
      "Wähle die Karte eines Kindes, um seine Angaben zu öffnen.",
    ],
    result: statusResult,
    differences: [
      "Siehst du nur eine Gruppe? Dann öffnet moto sie direkt, ohne Auswahl.",
      "Ist für eine Gruppe keine Gruppenleitung eingetragen, fehlt diese Zeile auf ihrer Karte.",
      "Eine vorübergehend übernommene Gruppe ist mit `Vertretung` markiert.",
      "In der Seitenleiste stehen unter `Gruppen` deine eigenen Gruppen. Dahinter steht, wie viele Kinder gerade da sind. Hast du eine andere Gruppe geöffnet, steht sie markiert darunter.",
      "Fehlt eine Gruppe? Bitte deine Leitung, deine Gruppenzuordnung zu prüfen.",
      // Einstellung „Kinder nur über ‚Alle Kinder‘ finden“ (#1321).
      "Fehlt `Gruppen` in der Navigation? Öffne `Alle Kinder` und wähle oben `Meine Gruppe`. Die Gruppenseite öffnest du im Menü mit den drei Punkten unter `Zur Gruppenseite`.",
    ],
    // Einstellung „Angebote auf der Kinderkarte“ (#6487), standardmäßig aus.
    notes: [
      "Die Karten können auch die Angebote des Tages zeigen, zum Beispiel „14:00–15:00 Töpfer-AG“. Deine Leitung schaltet das in den Einstellungen bei `Angebote auf der Kinderkarte` ein.",
    ],
    troubleshooting: HELP_TOPICS.missingChildOrGroup,
    related: [
      HELP_TOPICS.transferGroup,
      HELP_TOPICS.activeSupervision,
      HELP_TOPICS.studentSearch,
    ],
  };
}
