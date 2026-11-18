import type { HelpTopic, HelpPresenceMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function changeLocationTopic(presenceMode: HelpPresenceMode): HelpTopic {
  if (presenceMode === "binary") {
    return {
      id: HELP_TOPICS.changeLocation,
      title: "Den Aufenthaltsort eines Kindes ändern",
      question: "Wie ändere ich den Aufenthaltsort eines Kindes?",
      summary:
        "Bei einfacher Anwesenheit erfasst moto keine Räume oder Aufenthaltsorte.",
      group: "kinder",
      audience: "caregiver",
      icon: "Eye",
      steps: [
        "Öffne das Kind unter `Alle Kinder`.",
        "Wähle `Anmelden` oder `Abmelden`.",
      ],
      result:
        "moto zeigt nur, ob das Kind `Anwesend` oder `Zuhause` ist. Ein Raum wird nicht gespeichert.",
      related: [HELP_TOPICS.webAttendance, HELP_TOPICS.studentSearch],
    };
  }
  if (presenceMode === "unknown") {
    return {
      id: HELP_TOPICS.changeLocation,
      title: "Den Aufenthaltsort eines Kindes ändern",
      question: "Wie ändere ich den Aufenthaltsort eines Kindes?",
      summary:
        "Ob moto Aufenthaltsorte erfasst, hängt von der Arbeitsweise deiner OGS ab.",
      group: "kinder",
      audience: "caregiver",
      icon: "Eye",
      steps: [
        "Prüfe, ob der Bereich `Räume` in der Seitenleiste steht.",
        "Ist der Bereich vorhanden? Öffne den aktuellen Raum des Kindes und wähle einen neuen Zielraum.",
        "Fehlt der Bereich? Dann erfasst moto nur, ob das Kind anwesend ist.",
      ],
      result:
        "moto zeigt den neuen Raum nur bei einer OGS mit detaillierter Anwesenheit.",
      related: [HELP_TOPICS.webAttendance, HELP_TOPICS.rooms],
    };
  }

  return {
    id: HELP_TOPICS.changeLocation,
    title: "Ein Kind in einen anderen Raum verschieben",
    question: "Wie verschiebe ich ein Kind in einen anderen Raum?",
    summary: "Ändere den Raum eines anwesenden Kindes.",
    group: "kinder",
    audience: "caregiver",
    icon: "MapPin",
    requirements: [
      "Deine OGS erfasst die Räume der Kinder.",
      "Das Kind ist anwesend.",
      "Du beaufsichtigst den aktuellen Raum oder den Zielraum.",
      "Im Zielraum läuft eine Aufsicht, oder er ist ein offener Raum.",
    ],
    steps: [
      "Öffne `Räume`.",
      "Öffne den aktuellen Raum des Kindes.",
      "Wähle das Kind unter `Kinder im Raum` aus.",
      "Wähle unter `Zielraum` den neuen Raum.",
      "Wähle `In Raum setzen`.",
    ],
    result: "moto zeigt sofort den neuen Raum. Der bisherige Raumbesuch endet.",
    notes: ["Du kannst mehrere Kinder auswählen und gemeinsam verschieben."],
    differences: [
      "Hat das Kind noch keinen Raum? Wähle auf `Räume` die Karte `Unterwegs`. Wähle dort das Kind und den Zielraum.",
      // #5026: dieselbe Karte steht auf „Alle Kinder“.
      "Oder filtere unter `Alle Kinder` nach `Unterwegs`. Wähle dann oben die Karte `Unterwegs`.",
      "Steht hinter dem Zielraum `(offener Raum)`? Dort braucht es keine Aufsicht. Das Kind nutzt den Raum dann, ohne an einem Angebot teilzunehmen.",
      "Fehlt der Zielraum? Prüfe dort `Aktuelle Aufsicht`.",
      "Beaufsichtigst du keinen der beiden Räume? Bitte eine zuständige Aufsicht. Oder frage deine Leitung.",
    ],
    troubleshooting: HELP_TOPICS.missingChildOrGroup,
    related: [
      HELP_TOPICS.webAttendance,
      HELP_TOPICS.rooms,
      HELP_TOPICS.activeSupervision,
    ],
  };
}
