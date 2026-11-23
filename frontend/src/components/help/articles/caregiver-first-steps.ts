import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Die Checkliste „Erste Schritte“ für Betreuungskräfte (#3748). Sie öffnet
 * sich nur Personen ohne `config:update`, die neu dazukommen, sobald die
 * Schule eine Gruppe oder ein Kind hat. Die Beschriftungen stammen aus
 * `components/staff-onboarding/`.
 */
export function caregiverFirstStepsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.caregiverFirstSteps,
    title: "Erste Schritte im Arbeitsalltag",
    question: "Wie zeigt mir moto die wichtigsten Handgriffe?",
    summary:
      "Eine Checkliste zeigt dir Schritt für Schritt, wo du was in moto findest.",
    group: "einstieg",
    audience: "caregiver",
    icon: "ClipboardList",
    requirements: ["Du bist neu im Team deiner OGS."],
    steps: [
      "Melde dich an. Unten rechts öffnet sich die Checkliste `Erste Schritte mit moto`.",
      "Der nächste Schritt ist aufgeklappt. Wähle `Zeig es mir`.",
      "moto zeigt dir den Weg in der Seitenleiste und dann die wichtigen Stellen. Klicke die hervorgehobene Stelle an oder wähle `Weiter`.",
      "Am Ende der Tour wählst du `Fertig`. Der Schritt bekommt einen Haken.",
      "Sind alle Schritte erledigt, wähle `Abschließen`.",
    ],
    result:
      "Du kennst die wichtigsten Handgriffe, und die Checkliste verschwindet. Alle Anleitungen bleiben hier in der Hilfe.",
    notes: [
      "Jeden Schritt kannst du mit `Überspringen` auslassen.",
      "Einen erledigten Schritt siehst du dir mit `Noch einmal zeigen` wieder an.",
      "Du kannst die Checkliste einklappen. Unten rechts steht dann `Erste Schritte` mit der Zahl der offenen Schritte.",
      "Die Tour zeigt nur. Sie meldet kein Kind an und stempelt dich nicht ein.",
      "Arbeitest du in mehreren OGS? Dein Stand gilt in allen. Was du in einer OGS erledigt hast, ist auch in den anderen erledigt.",
    ],
    differences: [
      "Welche Schritte du siehst, hängt von deiner OGS ab. Ohne feste Gruppen fehlt zum Beispiel `Meine Gruppe ansehen`.",
      "`Meine Gruppe ansehen` erscheint erst, wenn dir eine Gruppe zugeordnet ist.",
      "In einem Chat ist `Erste Schritte` ausgeblendet, damit `Senden` frei bleibt. Auf jeder anderen Seite ist es wieder da.",
    ],
    troubleshootingDetails: [
      "Die Checkliste erscheint nicht? Sie kommt erst, wenn deine OGS eine Gruppe oder ein Kind in moto hat. Wer schon vor der Checkliste mit moto gearbeitet hat, bekommt sie nicht.",
      "Die Tour ist plötzlich weg? Sie endet, wenn du eine andere Seite öffnest. Mit `Zeig es mir` starte sie neu.",
      "Du hast `Nicht mehr anzeigen` gewählt? Die Checkliste kommt in keiner deiner OGS wieder. Die Anleitungen stehen hier in der Hilfe.",
    ],
    related: [
      HELP_TOPICS.appOverview,
      HELP_TOPICS.studentSearch,
      HELP_TOPICS.webAttendance,
      HELP_TOPICS.trackWorkTime,
    ],
  };
}
