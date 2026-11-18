import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Anwesenheit am Vormittag (#4790): die Lehrkraft markiert heute je Kind „Da“
 * oder „Fehlt“ und speichert. Gespeichert getrennt von der OGS-Anwesenheit.
 */
export function teacherMorningAttendanceTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherMorningAttendance,
    title: "Anwesenheit am Vormittag eintragen",
    question: "Wie trage ich ein, wer heute da ist?",
    summary: "Du markierst bei jedem Kind „Da“ oder „Fehlt“ und speicherst.",
    group: "klasse",
    audience: "teacher",
    icon: "CalendarCheck",
    steps: [
      "Öffne in der `Klassenansicht` deine Klasse für heute.",
      "Tippe bei jedem Kind auf `Da` oder `Fehlt`.",
      "Sind fast alle da? Tippe auf `Alle übrigen da`.",
      "Tippe unten auf `Anwesenheit speichern`.",
    ],
    result: "Oben steht, wie viele Kinder da sind, fehlen und noch offen sind.",
    notes: [
      "Kinder mit Meldung (`Krank`, `Entschuldigt`, `Klassenfahrt`) stehen schon auf `Fehlt`.",
      "Fehlt ein Kind ohne Meldung, steht bei ihm `Fehlt ohne Meldung`.",
      "Du kannst heute jederzeit ändern und neu speichern.",
      "Die Anwesenheit in der OGS ändert sich dadurch nicht.",
    ],
    differences: [
      "Du siehst keine Knöpfe `Da` und `Fehlt`? Eintragen geht nur heute und an Schultagen. Oder die OGS hat es ausgeschaltet.",
    ],
    troubleshootingDetails: [
      "Speichern klappt nicht und ein Kind gehört nicht mehr zur Klasse? Lade die Seite neu.",
    ],
    related: [
      HELP_TOPICS.teacherClassList,
      HELP_TOPICS.teacherClassDay,
      HELP_TOPICS.teacherFeatureMissing,
    ],
  };
}
