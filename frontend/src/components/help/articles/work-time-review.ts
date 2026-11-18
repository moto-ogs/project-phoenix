import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Arbeitszeiten des Teams: Ansehen und Korrigieren unter `/time-tracking`
 * (mit `time_tracking:manage`), Antraege im Reiter `Mitarbeitende` des
 * Anfragen-Moduls (#2433).
 */
export function workTimeReviewTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadWorkTimeReview,
    title: "Arbeitszeiten des Teams prüfen",
    question: "Wie prüfe ich Arbeitszeiten, Urlaub und Korrekturen?",
    summary: "Zeiten stehen bei `Mitarbeiter`, Anträge unter `Anfragen`.",
    group: "personal",
    audience: "lead",
    icon: "Clock3",
    steps: [],
    instructionGroups: [
      {
        title: "Zeiten des Teams ansehen",
        steps: [
          "Klappe in der Seitenleiste `Team` auf.",
          "Öffne `Mitarbeiter`.",
          "Wähle oben den Reiter `Zeitkonten`.",
          "Lies in der `Einrichtungs-Übersicht` die Zahlen für `Woche` oder `Monat`.",
          "Filtere die Liste bei Bedarf nach `Minusstunden`, `Plusstunden` oder `über +20 Std.`.",
          "Die Spalte `Hinweise` zählt die Tage mit zu kurzer Pause oder mehr als 10 Std. Arbeit. Mit `Mit Hinweisen` siehst du nur diese Personen.",
          "Steht in der Spalte `Soll` der Hinweis `Kein Soll`, fehlt das Arbeitszeitmodell. Wähle die Zeile. Du landest direkt im `Arbeitszeitmodell` der Person.",
        ],
      },
      {
        title: "Eine einzelne Zeit korrigieren",
        steps: [
          "Öffne `Mitarbeiter` und wähle die Person.",
          "Wähle den Reiter `Zeiterfassung`.",
          "Öffne den Eintrag, den du ändern möchtest.",
          "Ändere die Zeiten. Unter `Pausen` änderst du jede Dauer einzeln.",
          "Trage eine `Begründung` ein. Wähle `Änderungen speichern`.",
        ],
      },
      {
        title: "Einen Antrag entscheiden",
        steps: [
          "Öffne im `Tagesbetrieb` den Bereich `Anfragen`.",
          "Wähle den Reiter `Mitarbeitende`.",
          "Öffne den Antrag.",
          "Wähle `Genehmigen`, `Ablehnen` oder stelle eine Rückfrage.",
        ],
      },
    ],
    result:
      "Die Person sieht die Entscheidung sofort in ihrer eigenen Zeiterfassung.",
    notes: [
      "Bei Einträgen ohne einzelne Pausen änderst du `Pause (Minuten)`.",
      "Laufende Pausen muss die Person zuerst beenden.",
      "Nachträge sind der Leitung vorbehalten. Dein Team kann Zeiten nicht selbst nachtragen.",
      "Wochensaldo und Stundenkonto rechnen gegen das hinterlegte Arbeitszeitmodell. Ohne Soll zählen Krankheit, Urlaub und Fortbildung 0 Stunden.",
      "`Team` → `Zeiterfassung` zeigt nur deine eigene Stempeluhr, nicht die des Teams.",
      "Mit `Monat abschließen` frierst du den Stand ein. Das geht ab dem 1. des Folgemonats.",
      "Steht bei einer Person `Schließt der Träger ab`, hat sie einen Arbeitsvertrag beim Träger. Ihren Monat schließt der Träger ab, dein Abschluss lässt sie aus. Nur der Träger öffnet ihn wieder.",
      "Ist unter `Abrechnung` der `Versand an das Lohnbüro` eingeschaltet, geht die Monatsdatei danach von selbst an das Lohnbüro.",
      "Unter einer Rückfrage und in der Historie steht, ob die Mail dazu bei der Person ankam. Kam sie nicht an, sage der Person direkt Bescheid.",
    ],
    differences: [
      "Fehlt der Reiter `Mitarbeitende`? Dann darfst du keine Anträge entscheiden.",
      "Weicht das `Ist` von den gestempelten Zeiten ab? Dann gelten Wegpackzeit oder Rundung aus den Einstellungen. Die Zeile zeigt das als Hinweis. Korrigiere nur die Uhrzeiten, moto rechnet die Zugabe neu.",
    ],
    troubleshootingDetails: [
      "Ein Krankheitstag zählt 0 Stunden? Dann fehlt das Soll. Die Monatskarte zeigt den Tag dann mit `ohne Soll`. Trage das Soll im `Arbeitszeitmodell` der Person ein. Gilt es ab dem Krankheitstag, rechnet moto die Stunden nach.",
      "Der Saldo einer Person stimmt nicht? Prüfe ihr `Arbeitszeitmodell` in der Personalakte.",
    ],
    related: [
      HELP_TOPICS.leadDutyRoster,
      HELP_TOPICS.leadPayroll,
      HELP_TOPICS.leadInviteStaff,
    ],
  };
}
