import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function editStudentTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.editStudent,
    title: "Angaben oder Betreuungszeiten eines Kindes ändern",
    question: "Wie ändere ich Angaben oder Betreuungszeiten eines Kindes?",
    summary:
      "Ändere persönliche Angaben, den Wochenplan oder einen einzelnen Tag.",
    group: "kinder",
    audience: "caregiver",
    icon: "FileText",
    steps: [],
    instructionGroups: [
      {
        title: "Persönliche Angaben ändern",
        steps: [
          "Suche das Kind unter `Alle Kinder`.",
          "Öffne das Kind und wähle `Stammdaten`.",
          "Wähle `Bearbeiten`.",
          "Ändere die benötigten Angaben.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Regelmäßige Betreuungszeiten ändern",
        description:
          "Der Wochenplan gilt ab sofort für alle kommenden Wochen. Schon eingetragene Ausnahmen bleiben bestehen.",
        steps: [
          "Öffne beim Kind den Reiter `Betreuungszeiten`.",
          "Wähle oben rechts `Wochenplan`.",
          "Setze bei den Betreuungstagen einen Haken.",
          "Trage je Tag `Ankunft` und `Abholung` ein.",
          "Kommt das Kind an einem Betreuungstag nicht? Lass `Abholung` leer.",
          "Öffne `Notizen`. Trage den Hinweis unter `Notiz zum Tag (jede Woche)` ein.",
          "Wähle `Speichern`.",
        ],
      },
      {
        // #6650: Widerruf über die Schule für Eltern ohne Elternportal.
        // Der Haken bleibt auch bei ausgeschalteten Kinderfotos sichtbar,
        // solange eine Einwilligung hinterlegt ist (student-photo-section.tsx).
        title: "Foto-Einwilligung für Eltern widerrufen",
        description:
          "Für Eltern ohne Elternportal. Prüfe vorher, ob die Person für das Kind sprechen darf.",
        steps: [
          "Öffne das Kind und wähle `Stammdaten`.",
          "Wähle `Bearbeiten`.",
          "Entferne beim Foto den Haken bei `Einwilligung der Eltern liegt vor`.",
          "Wähle `Speichern`.",
        ],
      },
      {
        // Live geprueft: jede Tageskarte hat oben rechts den Knopf
        // `Ausnahme`. Ankunft und Abholung haben je drei Auswahlfelder.
        title: "Nur einen Tag ändern",
        description:
          "Eine Ausnahme gilt nur an diesem Tag. Die festen Zeiten der Woche bleiben unverändert.",
        steps: [
          "Öffne beim Kind den Reiter `Betreuungszeiten`.",
          "Wähle bei Bedarf `Vorherige Woche` oder `Nächste Woche`.",
          "Wähle auf der Karte des Tages `Ausnahme`.",
          "Wähle unter `Ankunft` `Regulär`, `Andere Zeit` oder `Kommt nicht`.",
          "Wähle unter `Abholung` `Regulär`, `Andere Zeit` oder `Keine Abholung`.",
          // #3945: eigener Abschnitt unter Ankunft und Abholung.
          "Geht das Kind an diesem Tag anders nach Hause? Wähle unter `Abholart` zum Beispiel `Wird abgeholt`. `Wie im Wochenplan` nimmt die Änderung zurück.",
          "Trage bei Bedarf unter `Hinweise nur für diesen Tag` etwas ein.",
          "Wähle `Speichern`.",
        ],
      },
    ],
    result:
      // #3946: student-card.tsx (dayHomeChange) zeigt unten einen orangen Streifen.
      "Die gespeicherten Angaben gelten sofort. Eine Notiz ohne Abholzeit steht auf der Kinderkarte unter `Kommt heute nicht`. Eine andere Abholart steht an diesem Tag auf der Kinderkarte und in der Klassenansicht. Eine Ausnahme ändert den regelmäßigen Wochenplan nicht. Gilt heute eine andere Gehzeit oder Abholart, steht unten auf der Kinderkarte ein oranger Hinweis, zum Beispiel `Gehzeit heute geändert`.",
    differences: [
      "Die Kennzeichnung `Für Eltern sichtbar` zeigt Angaben, die Eltern sehen.",
      "Kommen die Betreuungstage aus Buchungen? Dann lassen sich die Tage nicht auswählen. Ändere nur Zeiten an gebuchten Tagen.",
      "Fehlt `Bearbeiten` oder `Wochenplan`? Frage deine Leitung nach den nötigen Rechten.",
      // #5618: care-schedule-manager.tsx (hiddenBookedPickup), Knopf im Tagesdialog.
      // #5643: Braucht ein früherer Tag die Zeit noch, lehnt das Backend ab
      // (students.pickup_reset_still_needed) und nennt den Tag.
      "Steht bei `Abholung` zum Beispiel `Gebucht 16:00 Uhr`? Dann gilt eine von Hand eingetragene Zeit statt der gebuchten. Wähle den Tag und dann `Gebuchte Abholzeit übernehmen`. Das gilt ab sofort für diesen Wochentag in jeder Woche, auch vor dem gewählten Tag. Braucht ein früherer Tag die eingetragene Zeit noch, nennt moto den Tag, ab dem das Übernehmen geht.",
    ],
    notes: [
      // #6855, #7707: pickup-change-alert.tsx über den Bereichen der Kinderakte,
      // die Markierung in care-schedule-manager.tsx.
      "Gibt es eine neue Abholzeit, die du noch nicht kennst? Dann steht oben in der Kinderakte `Abholzeit an einzelnen Tagen geändert`. Dort stehen Tag, Uhrzeit und `Neu`. Mit dem Öffnen des Kindes geht der Zähler bei `Neu für dich` zurück. Mit dem X schließt du den Hinweis. Er kommt erst bei einer neuen Änderung wieder.",
      "Jeden geänderten Tag findest du unter `Betreuungszeiten`. Bei `Abholung` steht die neue Uhrzeit. Die normale Zeit ist durchgestrichen. Daneben steht `Ausnahme`. Liegt der Tag in einer späteren Woche, blättere mit `Nächste Woche` dorthin.",
      "Nach einem Widerruf löscht moto das Foto des Kindes. Nach dem letzten Betreuungstag löscht moto Foto und Foto-Einwilligung in der Nacht danach von selbst.",
      "Steht unter dem Feld `Ankunft` die Auswahl `Nach Schulstunde`? Wähle zum Beispiel `5. Stunde`. moto trägt die passende Uhrzeit ein.",
      // #3371: Knopf erscheint nur mit gepflegter Vorgabe unter einem leeren
      // Feld an einem Betreuungstag (care-weekly-plan-editor.tsx).
      "Steht unter einem leeren Feld zum Beispiel `16:00 Uhr eintragen`? Ein Klick trägt die übliche Zeit deiner Schule ein.",
      "Betreut deine OGS am Wochenende? Dann gilt dort der Freitagsplan. Am Wochenende zeigt die Wochenansicht dieser Woche auch Samstag und Sonntag.",
    ],
    related: [
      HELP_TOPICS.studentSearch,
      HELP_TOPICS.carePlan,
      HELP_TOPICS.dayLog,
    ],
  };
}
