import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Der Assistent „Erste Schritte“ für neue Schulen (#2832). Er öffnet sich nur
 * Personen mit `config:update`, solange die Schule nicht fertig ist. Die
 * Beschriftungen stammen aus `components/school-setup/`.
 */
export function firstStepsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadFirstSteps,
    title: "Erste Schritte mit moto",
    question: "Wie führt mich moto durch den Start?",
    summary:
      "Eine neue OGS geht die ersten Schritte mit einer Checkliste durch.",
    group: "einrichten",
    audience: "lead",
    icon: "ClipboardList",
    requirements: [
      "Deine OGS ist neu bei moto.",
      "Du darfst die Einstellungen deiner OGS ändern.",
    ],
    steps: [
      "Melde dich an. Unten rechts öffnet sich die Checkliste `Erste Schritte mit moto`.",
      "Der nächste Schritt ist aufgeklappt. Wähle `Zeig es mir`.",
      "moto zeigt dir in der Seitenleiste den Weg zur Seite und dann jede Stelle. Klicke die hervorgehobene Stelle an.",
      "Ist der Schritt erledigt, bekommt er einen Haken. Der nächste Schritt klappt auf.",
      "Sind alle Schritte erledigt, wähle `Abschließen`.",
    ],
    result:
      "Die ersten Einträge stehen, und die Checkliste verschwindet. Die übrigen Daten legst du mit den Anleitungen hier in der Hilfe an.",
    notes: [
      "Jeden Schritt kannst du mit `Überspringen` auslassen.",
      "Ein Schritt ist erledigt, sobald es den ersten Eintrag gibt, zum Beispiel das erste Kind. Die übrigen legst du danach genauso an.",
      "Deine OGS nutzt die Zeiterfassung? Dann gibt es den Schritt `Arbeitszeitmodelle eintragen`. Er zeigt, wie viele Personen noch kein Soll haben. Erledigt ist er erst, wenn jede Person mit Zeitkonto ein Soll hat.",
      "Du kannst die Checkliste einklappen. Unten rechts steht dann `Erste Schritte` mit der Zahl der offenen Schritte.",
      "Du kannst jeden Schritt in der Checkliste aufklappen, auch in anderer Reihenfolge.",
      "Ob moto auch den Raum erfasst, stimmt das moto-Team mit dir ab.",
      "Du möchtest die Anwesenheit mit NFC-Armbändern erfassen? Dann melde dich beim moto-Team.",
      "Du hast eine Liste aller Kinder? Starte die Tour zu `Erstes Kind anlegen`. Öffne dort das Menü mit den drei Punkten. Wähle `Importieren`. Dann zeigt die Tour den Import.",
      "Deine OGS nutzt die Eltern-App nicht? Dann überspringe `Erste Eltern einladen`.",
      "Der Stand gilt für die ganze OGS. Andere Leitungen sehen denselben Stand.",
    ],
    differences: [
      "In einem Chat fehlt unten der Knopf `Erste Schritte`. So bleibt `Senden` frei. Auf den anderen Seiten ist er wieder da.",
    ],
    troubleshootingDetails: [
      "Die Tour ist plötzlich weg? Sie endet, wenn du eine andere Seite öffnest. Mit `Zeig es mir` startest du sie neu.",
      "Du hast `Nicht mehr anzeigen` gewählt? Die Checkliste kommt nicht wieder. Die Anleitungen zu jedem Schritt stehen hier in der Hilfe, zum Beispiel unter `Weitere Themen`.",
      "Du wechselst aus dem Träger-Portal in die OGS und siehst keine Checkliste? Wer `Nicht mehr anzeigen` einmal gewählt hat, sieht sie in keiner OGS des Trägers mehr. Die Leitungen vor Ort sehen sie weiter.",
    ],
    related: [
      HELP_TOPICS.leadGoLive,
      HELP_TOPICS.leadInviteStaff,
      HELP_TOPICS.leadCreateStudent,
      HELP_TOPICS.leadInviteGuardians,
      HELP_TOPICS.leadStaffRecord,
    ],
  };
}
