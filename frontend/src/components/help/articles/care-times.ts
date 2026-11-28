import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Betreuungszeiten. Drei Wege, alle an keine der drei Einstellungen gebunden:
 * beim Anlegen (`CareWeeklyPlanModal` im Slide-over `Neues Kind`), beim
 * einzelnen Kind (`CareScheduleManager`, Knopf `Wochenplan`) und fuer mehrere
 * Kinder ueber `Auswählen` -> `Ankunftszeiten` / `Gehzeiten`
 * (students-master-detail.tsx:532).
 */
export function careTimesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadCareTimes,
    title: "Betreuungszeiten eintragen",
    question: "Wie trage ich die Betreuungszeiten eines Kindes ein?",
    summary: "Lege fest, an welchen Tagen ein Kind betreut wird.",
    group: "einrichten",
    audience: "lead",
    icon: "CalendarDays",
    steps: [],
    instructionGroups: [
      {
        title: "Den Wochenplan eines Kindes eintragen",
        steps: [
          "Öffne das Kind und wähle den Bereich `Betreuungszeiten`.",
          "Wähle `Wochenplan`.",
          "Wähle die Betreuungstage.",
          "Trage `Ankunft` und `Abholung` ein.",
          "Kommt das Kind an einem Betreuungstag nicht? Lass `Abholung` leer.",
          "Öffne `Notizen`. Trage den Hinweis unter `Notiz zum Tag (jede Woche)` ein.",
          "Wähle `Wochenplan speichern`.",
        ],
      },
      {
        title: "Zeiten für mehrere Kinder auf einmal setzen",
        steps: [
          "Öffne `Datenverwaltung` und danach `Kinderdaten`.",
          "Öffne oben das Menü mit den drei Punkten.",
          "Wähle `Auswählen`.",
          "Hake die Kinder an.",
          "Wähle `Ankunftszeiten` oder `Gehzeiten`.",
          "Trage die Zeiten ein und wähle `Speichern`.",
          "Wähle `Fertig`.",
        ],
      },
      {
        title: "Einen einzelnen Tag ändern",
        steps: [
          "Öffne beim Kind den Bereich `Betreuungszeiten`.",
          "Wähle beim gewünschten Tag `Ausnahme`.",
          "Ändere `Ankunft`, `Abholung` oder `Abholart`.",
          "Wähle `Speichern`.",
        ],
      },
      {
        // #7655: care-pickup-person-section.tsx, Anzeige in pickup-person-row.tsx.
        title: "Eintragen, wer an einem Tag abholt",
        steps: [
          "Öffne beim Kind den Bereich `Betreuungszeiten`.",
          "Wähle beim gewünschten Tag `Ausnahme`.",
          "Wähle unter `Wer holt ab?` eine abholberechtigte Person. Oder wähle `Andere Person` und trage den Namen ein.",
          "Wähle `Speichern`.",
        ],
      },
    ],
    result:
      // #3946: student-card.tsx (dayHomeChange) zeigt unten einen orangen Streifen.
      "Die Zeiten gelten sofort. Eine Notiz ohne Abholzeit steht auf der Kinderkarte unter `Kommt heute nicht`. Eine Ausnahme ändert den Wochenplan nicht. Gilt heute eine andere Gehzeit oder Abholart, steht unten auf der Kinderkarte ein oranger Hinweis, zum Beispiel `Abholart heute geändert: Wird abgeholt`.",
    notes: [
      "Ohne eigene Zeit gilt die Klassenzeit des Kindes.",
      // #3373: Ankunft nicht vor Abholung (comesOnlyIfLessonCancelled in
      // student-time-status.ts) warnt nicht mehr als überfällig.
      "Endet der Unterricht erst zur Abholzeit? Dann steht auf der Kinderkarte `Nur bei Unterrichtsausfall`. Das Kind gilt nicht als verspätet. Kommt es doch, checke es wie gewohnt ein.",
      "Den Wochenplan kannst du schon beim Anlegen des Kindes mitgeben.",
      // #7655: nur der Name wird gespeichert und nach dem Tag gelöscht.
      "Wer an diesem Tag abholt, steht auf der Kinderkarte in der Gruppe unter `Holt heute ab` und in `Heute anders`. Bei einer anderen Person steht `Ausweis prüfen` dabei. moto speichert nur den Namen und löscht ihn nach dem Tag.",
      // #8206: guardian-store cascade, Anzeige in pickup-person-row.tsx.
      "Nimmst du einer Person beim Kind das Häkchen `Abholberechtigt` weg, entfernt moto ihre eingetragenen Abholtage. Die Meldung nach dem Speichern nennt die Tage. Gilt die Abholerlaubnis an einem Tag nicht mehr, steht dort `Abholerlaubnis entzogen`.",
      // #3372: Die Auswahl erscheint nur mit gepflegten Schulstunden
      // (school-period-select.tsx) und kopiert die Uhrzeit ins Zeitfeld.
      "Schneller geht es mit `Nach Schulstunde` unter dem Feld `Ankunft`: Wähle zum Beispiel `5. Stunde`. moto trägt die passende Uhrzeit ein.",
      "Dieselbe Auswahl gibt es für eine ganze Klasse: unter `Kinderdaten` im Menü der Klasse bei `Ankunftszeit bearbeiten`.",
      "Die Auswahl erscheint, wenn unter `Einstellungen` bei `Schulstunden` Uhrzeiten stehen. Jede Schule pflegt ihre eigenen Zeiten.",
      "Änderst du später eine Schulstunde, bleiben gespeicherte Zeiten unverändert.",
      // #3371: Textfeld mit Ziffernmaske statt nativem Zeitfeld, Knopf nur
      // mit gepflegter Vorgabe (care-weekly-plan-editor.tsx).
      "Tippe nur Ziffern, zum Beispiel 1600 für 16:00 Uhr.",
      "Steht unter einem leeren Feld zum Beispiel `16:00 Uhr eintragen`? Ein Klick trägt die übliche Zeit deiner Schule ein.",
      "Die üblichen Zeiten stehen unter `Einstellungen` bei `Betreuungszeiten`. Jede Schule pflegt ihre eigenen Zeiten.",
      "Betreut deine OGS am Wochenende? Dann gilt dort der Freitagsplan. Am Wochenende zeigt die Wochenansicht dieser Woche auch Samstag und Sonntag.",
      // #5102: Angebotswechsel aus dem Wochenplan.
      "Wechselt das Kind mit dem Wochenplan das Angebot, zeigt moto danach `Auswirkung auf den Betreuungsplan`. Dort siehst du, welche Regeltermine angepasst sind und wo das Kind weiter eingeplant ist.",
    ],
    differences: [
      // Einstellung `enrollment.bookings_authoritative`, Vorgabe aus. Der
      // Satz beginnt bei dem, was zu sehen ist -- den Namen der Einstellung
      // kennt die Leserin nicht (care-weekly-plan-modal.tsx:271).
      "Lassen sich die Betreuungstage nicht anhaken? Dann bestimmen bei dir die gebuchten Betreuungsangebote, wann ein Kind da ist.",
      "An einem Tag ohne Buchung sind `Ankunft` und `Abholung` grau. `Notiz zum Tag (jede Woche)` bleibt frei.",
    ],
    troubleshootingDetails: [
      "Fehlt `Wochenplan`? Dann fehlen dir die Schreibrechte für dieses Kind.",
      "Die Tage kommen aus den Buchungen und das soll anders sein? Das kann nur das moto-Team umstellen.",
    ],
    related: [
      HELP_TOPICS.leadCreateStudent,
      HELP_TOPICS.leadManageStudent,
      HELP_TOPICS.leadCarePlan,
    ],
  };
}
