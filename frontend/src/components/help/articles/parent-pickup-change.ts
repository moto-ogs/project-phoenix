import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Abholzeit fuer einen Tag (i18n `parentChildCare.pickup`). Immer Anfrage.
 * Seit #3945 auch die Abholart, wenn die Schule das erlaubt; dann heisst der
 * Knopf `Abholung für ... ändern`.
 */
export function parentPickupChangeTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentPickupChange,
    title: "Die Abholung für einen Tag ändern",
    question:
      "Wie ändere ich die Abholzeit oder die Abholart für einen einzelnen Tag?",
    summary:
      "Du fragst eine andere Abholzeit oder Abholart an. Der Wochenplan bleibt.",
    group: "mein-kind",
    audience: "parent",
    icon: "Clock3",
    steps: [
      "Tippe unten auf `Mein Kind`.",
      "Tippe unter `Heute` auf `Abholzeit für ... ändern`.",
      "Wähle bei `Tag` den betroffenen Tag.",
      "Trage bei `Abholzeit` die neue Zeit ein, zum Beispiel 15:30.",
      "Holt jemand anderes ab? Wähle bei `Wer holt ab?` die Person.",
      // #8162: eine Person, die keine Kontaktperson ist.
      "Ist die Person nicht bei deinen Kontakten? Wähle `Andere Person` und schreib bei `Name der Person` den Namen auf.",
      "Trage bei `Grund für die Änderung` kurz ein, warum.",
      "Hast du eine Person gewählt, unterschreibe die Erlaubnis im Feld. Tippe auf `Unterschrift bestätigen`.",
      "Tippe auf `Anfrage senden`.",
    ],
    result:
      "Die Änderung gilt erst, nachdem die OGS sie bestätigt hat. Danach bekommt das Team deines Kindes einen Hinweis. Der reguläre Wochenplan bleibt unverändert. Eine gewählte Person darf nur an diesem Tag abholen. An dem Tag steht sie bei `Heute anders` mit `Von dir eingetragen`.",
    differences: [
      "Steht dort `Abholung für ... ändern`? Dann kannst du auch die Abholart ändern. Wähle bei `Abholart an diesem Tag` zum Beispiel `Wird abgeholt`. Lasse `Abholzeit` leer, wenn die Uhrzeit gleich bleibt.",
      "Hat die OGS die Abholart für den Tag schon festgelegt? Dann steht sie im Fenster. Für eine Änderung schreibe der OGS.",
      "Wählst du `Geht allein` für den Tag? Dann unterschreibe auch diese Erlaubnis.",
    ],
    notes: [
      "Der Grund ist Pflicht und darf höchstens 255 Zeichen lang sein.",
      "Bei `Wer holt ab?` stehen deine Kontakte und `Andere Person`. Eine andere Person zeigt bei der Abholung ihren Ausweis. Nach dem Tag löscht moto sie beim Kind. In deiner Anfrage und im Nachweis bleibt der Name stehen.",
      "Nach dem Senden findest du bei der Anfrage `Nachweis (PDF)`. Darin stehen deine Erklärung und deine Unterschrift.",
      "Soll sich die Zeit dauerhaft ändern? Dann frage eine Änderung der Betreuung an.",
    ],
    troubleshootingDetails: [
      "moto sagt, das Ändern der Abholzeit sei für diese OGS nicht aktiviert? Dann schreibe der OGS eine Nachricht.",
      "`Wer holt ab?` fehlt? Dann hast du bei `Abholart an diesem Tag` zum Beispiel `Geht allein` gewählt. Wer allein geht, wird nicht abgeholt.",
      "moto sagt, die Frist für heute ist vorbei? Dann änderst du die Abholung für heute nicht mehr. Schreib der OGS eine Nachricht. Spätere Tage kannst du weiter ändern.",
      "moto sagt, die Betreuung ist für heute schon zu Ende? Dann änderst du die Abholzeit für heute nicht mehr, auch wenn dein Kind noch im Unterricht ist. Andere Tage kannst du weiter ändern.",
    ],
    related: [
      HELP_TOPICS.parentCareChange,
      HELP_TOPICS.parentReportAbsence,
      HELP_TOPICS.parentGuardians,
    ],
  };
}
