import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Anmeldung vorbereiten: Phase, Angebote und Formular. Die drei Seiten liegen
 * im Akkordeon `Anmeldungen` der Gruppe `Eltern`; die Uebersicht selbst
 * (`/admin/enrollments`) rendert ihren Inhalt erst ab `lg` (page.tsx:44).
 */
export function enrollmentSetupTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadEnrollmentSetup,
    title: "Eine Anmeldung vorbereiten",
    question: "Wie öffne ich die Anmeldung für das nächste Schuljahr?",
    summary:
      "Drei Schritte: Phase anlegen, Angebote pflegen, Formular prüfen. Zum neuen Halbjahr folgt eine Anschlussphase.",
    group: "anmeldeverwaltung",
    audience: "lead",
    icon: "CalendarPlus",
    steps: [],
    instructionGroups: [
      {
        title: "Eine Anmeldephase anlegen",
        description:
          "Die Phase kommt zuerst. Betreuungsangebote gehören immer zu einer Phase, und ohne sie bleibt die Seite `Betreuungsangebote` leer.",
        steps: [
          "Klappe in der Seitenleiste `Eltern` auf.",
          "Öffne `Anmeldungen` und danach `Anmeldephasen`.",
          "Wähle `Neue Anmeldephase`.",
          "Trage bei `Name` ein, worum es geht, zum Beispiel `Schuljahr 2026/27`.",
          "Wähle den `Typ`.",
          "Trage `Beginn` und Ende der Betreuung ein.",
          "Wähle `Erstellen`.",
        ],
      },
      {
        title: "Angebote und Formular vorbereiten",
        description:
          "Beides gehört zu der Phase, die du gerade angelegt hast. Wähle sie oben auf der Seite aus, falls du mehrere hast.",
        steps: [
          "Öffne `Betreuungsangebote` und trage ein, was buchbar sein soll.",
          "Öffne `Anmeldeformulare`. Dort steht schon ein `Basisformular`. Für die meisten OGS reicht es.",
          "Sieh es dir mit `Vorschau` an. Dort fehlen die Angebote noch.",
          "Öffne `Anmeldephasen`, dann bei der Phase das Menü mit den drei Punkten, und wähle `Vorschau mit Angeboten`. Dort siehst du das Formular mit den Angeboten, so wie die Eltern. Das geht auch, bevor die Phase aktiv ist.",
        ],
      },
      {
        title: "Die Anmeldung öffnen",
        description:
          "Die Online-Anmeldung lässt sich nur mit einer Datenschutzinformation einschalten. Eltern lesen sie im Formular.",
        steps: [
          "Öffne `Einstellungen` > `Anmeldung` und dort den Bereich `Rechtstexte`.",
          "Schalte `Datenschutzinformation im Anmeldeformular anzeigen` ein und trage deinen Text ein.",
          "Schalte im Bereich `Allgemein` die `Online-Anmeldung` ein.",
          "Prüfe im Fenster die `Empfänger für neue Anmeldungen`. Dort steht schon die Kontaktadresse deiner Schule. Du kannst sie ändern oder das Feld leer lassen. Wähle `Einschalten`.",
          "Öffne `Anmeldephasen`.",
          "Öffne bei der Phase das Menü mit den drei Punkten.",
          "Wähle `Aktivieren`.",
          "Hat das Menü `Elternlink kopieren`? Gib diesen Link an die Eltern. Sonst läuft die Anmeldung über das Elternportal.",
        ],
      },
      {
        title: "Halbjahres- oder Schuljahreswechsel",
        description:
          "Die Anmeldungen sollen weiterlaufen, und Eltern sollen umbuchen können? Dann lege eine Anschlussphase an. Verlängere dafür nicht die alte Phase. Bei Kindern, die schon betreut werden, bliebe das Betreuungsende sonst, wie es ist.",
        steps: [
          "Öffne `Anmeldephasen`.",
          "Öffne bei der laufenden Phase das Menü mit den drei Punkten.",
          "Wähle `Anschlussphase erstellen`.",
          "Trage bei `Betreuung von` und `Betreuung bis` den neuen Zeitraum ein. Ein zweites Halbjahr beginnt zum Beispiel am 01.02.",
          "Wähle den `Modus`. Bei `Anmeldungen laufen weiter (Opt-Out)` müssen Eltern nichts tun. Bei `Eltern bestätigen neu (Opt-In)` bestätigen Eltern bis zur Frist. Ohne Bestätigung wird die Anmeldung zurückgezogen. Bestätigte Anmeldungen prüfst du danach.",
          "Wähle die `Frist für die Eltern-Antwort`.",
          "Für ein Halbjahr nimmst du den Haken bei `Klassenstufe automatisch um 1 erhöhen` weg. Für ein neues Schuljahr lässt du ihn.",
          "Nur bei `Anmeldungen laufen weiter (Opt-Out)`: Sollen die Anmeldungen nach der Frist ohne deine Prüfung gelten? Dann setze den Haken bei `Vorgemerkte Anmeldungen automatisch genehmigen`.",
          "Wähle unten `Anschlussphase erstellen`.",
        ],
      },
    ],
    result:
      "Eltern melden sich über den Link oder im Elternportal an. Eingänge siehst du im `Überblick`.",
    notes: [
      "Über `Elternansicht öffnen` siehst du das Formular so wie die Eltern.",
      "Für einen Aushang oder Elternbrief gibt es den Link auch als QR-Code. Wähle im Menü der Phase `QR-Code anzeigen`, dann `Bild speichern`. Eltern scannen den Code mit der Handy-Kamera.",
      "In der Mitte des QR-Codes steht das Bild deiner Login-Seite, sonst das moto-Logo. Unter `Eigenes Bild` wählst du ein anderes.",
      "Deine Betreuung heißt nicht OGS, sondern zum Beispiel GTS? Öffne `Einstellungen`, dann den Bereich `Anmeldung`. Wähle bei `Name der Betreuung in Texten für Eltern` den passenden Namen.",
      "Das `Basisformular` fragt Elternteil, Kind, Klassenstufe und das gewünschte Betreuungsangebot ab. Brauchst du mehr, lege eine eigene Vorlage an.",
      "Eine Phase lässt sich mit einem Kalenderzeitraum verknüpfen. Dann passen die Daten automatisch.",
      "Eine Phase dauert höchstens 2 Jahre. Ihr Ende liegt höchstens 5 Jahre in der Zukunft. Ältere Phasen außerhalb dieser Grenzen bleiben, wie sie sind, solange du Beginn und Ende nicht änderst.",
      "Ändere später `Beginn` oder `Ende` der Phase, ziehen die Buchungen der Kinder mit. Das Betreuungsende von Kindern, die schon betreut werden, zieht aber nicht mit. Ein Angebotswechsel ab einem bestimmten Tag behält diesen Tag.",
      "Du verlängerst das `Ende` einer laufenden Phase? Dann endet die Betreuung schon betreuter Kinder trotzdem nicht später. Für einen neuen Zeitraum nimmst du eine Anschlussphase.",
      "Nach dem Erstellen der Anschlussphase bekommen die Eltern eine E-Mail. Darüber passen sie Angebote und Wochentage für die neue Phase an. Oder sie beenden die Betreuung zum Ende der laufenden Phase.",
      "Du ziehst das `Ende` der Phase vor? Dann nennt moto nach dem Speichern die Kinder, die schon betreut werden. Ihre Betreuung bleibt eingetragen, bis du sie beendest. Wähle dafür `Betreuung beenden`. moto schlägt das neue Ende der Phase als letzten Betreuungstag vor. Bei mehr als 500 Kindern bestätigst du mehrere Gruppen einzeln. Die übrigen Kinder bleiben bis dahin in der Liste.",
      "Bei `Betreuungsangebote` steht in der Spalte `Belegt`, wie viele Plätze gebucht sind. Bei Angeboten mit Kapazität steht auch, wie viele Plätze frei sind. Ein volles Angebot ist mit `Voll` markiert.",
      "Du hast Varianten wie „bis 13 Uhr“ und „bis 17 Uhr“? Gib ihnen bei `Pflichtauswahl` dieselbe `Gruppe (optional)` und die `Regel` `Höchstens eines pro Tag`. Dann mischen Eltern die Varianten über die Woche, aber wählen pro Tag nur eine.",
      "Trage bei jeder Variante unter `Gehzeit pro Betreuungstag` ihre Uhrzeit ein. Nach der Zusage steht sie beim Kind. Bucht ein Kind an einem Tag zwei Angebote, gilt die spätere Gehzeit.",
      "Ein Angebot nur für eine Klassenstufe, zum Beispiel Klasse 1: Setze den Haken bei `Nur für bestimmte Klassenstufen anbieten` und wähle `Klasse 1`. Ohne Haken können alle Kinder das Angebot wählen.",
      "Manche Phasen und Angebote legt dein Träger für mehrere Schulen an. Du darfst alles daran ändern oder sie ausschalten. Deine Änderungen bleiben, auch wenn der Träger später etwas ändert.",
    ],
    differences: [
      "Auf dem Handy erscheint nur ein Hinweis. Die Anmeldungen laufen am Computer.",
      "Eine Phase trägt `Aktiv` oder nichts. Nur eine aktive Phase nimmt Anmeldungen an.",
      "Gilt die Phase nur für `Nur bereits angemeldete Kinder` oder `Nur Eltern mit Konto an der Schule`, fehlen `Formular ansehen`, `Elternansicht öffnen`, der Link zum Kopieren und der QR-Code. Diese Eltern melden sich im Elternportal an.",
    ],
    troubleshootingDetails: [
      "Beim Einschalten steht `Zuerst die Datenschutzinformation eintragen`? Dann fehlt der Text oder sein Schalter ist aus. Wähle `Zur Datenschutzinformation`. Den Text darf nur eintragen, wer alle Einstellungen der Schule ändern darf.",
      "Oben steht `Datenschutzinformation fehlt`? Deine Online-Anmeldung läuft schon, aber Eltern sehen keine Datenschutzinformation. Das Formular bleibt erreichbar. Schalte unter „Rechtstexte“ die Datenschutzinformation ein und trage den Text ein. Dann verschwindet der Hinweis.",
      "Beim Beenden nennt moto Kinder, deren Betreuung nicht beendet werden kann? Wähle unter diesen Kindern `Aus Auswahl nehmen`. Danach kannst du die Betreuung der übrigen Kinder erneut prüfen und beenden.",
      "Der Überblick sagt `Noch keine Anmeldephase`? Dann lege zuerst eine Phase an.",
      "Auf `Betreuungsangebote` steht `Erst eine Anmeldephase anlegen`? Dann fehlt die Phase noch. Angebote gibt es nur innerhalb einer Phase.",
      "Oben steht `Anschlussphase fehlt`? Dann laufen die Buchungen aus. Wähle `Anschlussphase erstellen`.",
      "Beim Speichern steht `Der neue Zeitraum passt nicht zur geänderten Buchung von …`? Das genannte Kind wechselt sein Angebot ab einem Tag im alten Zeitraum. Der neue Zeitraum würde diese Buchung leeren. Passe zuerst die Angebote dieses Kindes an.",
      "Fehlt `Anmeldungen` in der Seitenleiste? Der Bereich ist der Leitung vorbehalten.",
      "Eine Phase oder ein Angebot lässt sich nicht löschen, weil es vom Träger kommt? Schalte es stattdessen aus. Entfernen kann es nur dein Träger.",
      "Eine Phase lässt sich nicht löschen, weil es Anmeldungen zu ihr gibt? Wähle stattdessen `Deaktivieren`. Die Anmeldungen bleiben so erhalten.",
    ],
    related: [
      HELP_TOPICS.leadEnrollmentForm,
      HELP_TOPICS.enrollments,
      HELP_TOPICS.leadEnrollmentExport,
      HELP_TOPICS.leadCalendarPeriods,
      HELP_TOPICS.leadEndCare,
    ],
  };
}
