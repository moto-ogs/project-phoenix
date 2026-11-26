import type { HelpTopic, HelpGroupMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function parentRequestsTopic(groupMode: HelpGroupMode): HelpTopic {
  return {
    id: HELP_TOPICS.parentRequests,
    title: "Anfragen von Eltern prüfen und bearbeiten",
    question: "Wie prüfe und bearbeite ich Anfragen von Eltern?",
    summary:
      "Vergleiche die bisherigen Angaben mit dem Elternwunsch. Trage danach deine Entscheidung ein.",
    group: "team",
    audience: ["caregiver", "lead"],
    icon: "ListChecks",
    requirements: [
      "Dein Konto darf Kinderdaten bearbeiten.",
      // Wer freigibt, legt die Leitung fest (#3804): Admins, zustaendige
      // Gruppenleitungen oder das berechtigte Team.
      "Deine OGS lässt dich diese Anfragen freigeben. Das legt die Leitung fest.",
    ],
    steps: [
      "Öffne `Anfragen` in der Seitenleiste.",
      "Wähle den Tab `Eltern`.",
      "Suche nach dem Namen des Kindes oder wähle unter `Anfrageart` einen Filter.",
      "Öffne die Anfrage und vergleiche `Aktuell` mit `Gewünscht`.",
      "Wähle `Freigeben`, wenn die Änderung übernommen werden soll.",
      "Oder trage eine kurze Begründung ein und wähle `Ablehnen`.",
    ],
    result:
      "moto übernimmt die freigegebene Änderung. Die Bezugsperson sieht die Entscheidung in der Eltern-App.",
    differences: [
      // #5024: Freigeben braucht standardmäßig keine Begründung mehr.
      "Zeigt das Feld `Begründung (Pflicht)` statt `Begründung (Pflicht bei Ablehnung)`? Dann verlangt deine OGS auch beim Freigeben eine Begründung. Trage sie vorher ein.",
      "Bei einer geänderten Abholzeit zeigt moto vorher betroffene Termine an.",
      // #6990: Wochenplan seit der Anfrage geändert.
      "Steht bei einer Zeile `Eltern sahen ...`? Dann wurde der Plan nach der Anfrage geändert. Die Eltern kannten noch diesen Wert. Prüfe, ob die Anfrage noch passt.",
      // #3945: Tagesanfrage mit Abholart.
      "Eine Anfrage für einen einzelnen Tag kann die Abholzeit, die Abholart oder beides ändern. Die neue Abholart gilt nur an diesem Tag.",
      // #4780: Abholperson fuer einen Tag und Abholberechtigung je Wochentag.
      "Eine Anfrage für einen Tag kann auch eine Abholperson nennen. Nach dem Freigeben steht beim Kind für diesen Tag `Abholung durch ... (Erlaubnis der Eltern)`.",
      "Eine `Abholberechtigung` trägt eine Kontaktperson als abholberechtigt ein, an allen Tagen oder nur an bestimmten Tagen. Sie gilt erst nach dem Freigeben.",
      "Haben die Eltern unterschrieben, öffnest du mit `Nachweis (PDF)` die Erklärung und die Unterschrift.",
      // #5698: Elternmeldung für einen Tag mit Teilentschuldigung.
      "Hat die OGS einen beantragten Tag schon ab einer Uhrzeit entschuldigt? Dann steht dort `Aktuell ab ... Uhr entschuldigt`. Zum Freigeben bestätigst du zuerst `Teilentschuldigung durch Krankmeldung ersetzen` oder `Teilentschuldigung durch Entschuldigung ersetzen`.",
      // #3946: freigegebene Tagesänderung markiert die Kinderkarte.
      "Ist der Tag heute, zeigt die Kinderkarte nach dem Freigeben unten einen orangen Hinweis.",
      // #6855: freigegebene Abholzeit für einen Tag informiert das Team
      // (Typ student_pickup_changed) und markiert die Kinderakte.
      "Gibst du eine neue Abholzeit für einen Tag frei, bekommt das Team des Kindes einen Hinweis. Er steht oben in der Kopfzeile unter `Neu für dich` mit rotem Zähler. Ist es eingeschaltet, kommt er auch aufs Handy. Ein Tippen darauf öffnet das Kind.",
      "Nimmst du die Freigabe mit `Entscheidung korrigieren` zurück, bekommt das Team wieder einen Hinweis: `wieder normale Abholzeit`.",
      // #7707: Banner nur für ungesehene Änderungen, der Stand in den Betreuungszeiten.
      "Wer die Änderung noch nicht kennt, sieht oben in der Kinderakte `Abholzeit an einzelnen Tagen geändert`. Dort stehen Tag, Uhrzeit und `Neu`. Das X schließt den Hinweis. Er kommt erst bei einer neuen Änderung wieder.",
      "Unter `Betreuungszeiten` bleibt der Tag markiert: neue Uhrzeit, die normale Zeit durchgestrichen und `Ausnahme`. Die Markierung verschwindet, wenn der Tag vorbei ist oder die Ausnahme gelöscht wird.",
      // #5102: von Hand gepflegte Regeltermine nach einer Angebotsanfrage.
      "Planen von Hand gepflegte Regeltermine das Kind nach einer Angebotsanfrage weiter ein? Dann bleibt die Anfrage nach dem Freigeben offen stehen. Sie zeigt `Nicht angepasst, weil von Hand gepflegt`. Wähle `Dort auch entfernen` oder `Fertig`.",
      // Von Hand eingetragene Abholzeiten überdecken eine neue Buchung.
      "Gilt an einem Tag noch eine von Hand eingetragene Abholzeit? Dann bleibt die Anfrage ebenfalls offen. Sie zeigt `Abholzeit weicht von der Buchung ab`. Mit `Gebuchte Zeiten übernehmen` gilt die gebuchte Zeit. Steht ein Datum dabei, gilt sie erst ab diesem Tag. Bis dahin gilt die eingetragene Zeit weiter.",
      // #5137: Klassen-Regeltermine holen das Kind wieder herein.
      "Plant ein Regeltermin alle Kinder einer Klasse, eines Jahrgangs oder einer Gruppe, steht dort `Mit Angebot verbinden`. Nur so fehlt das Kind dauerhaft.",
      // #4767: Warteliste je AG; Nachrücken ist die normale Freigabe.
      "Fragen Eltern einen Platz in einer vollen AG an? Dann zeigt die Anfrage zum Beispiel `Warteliste Platz 2`. Die älteste Anfrage ist zuerst dran.",
      "Oben steht die Karte `Wartelisten`. Sie zeigt pro AG die belegten Plätze und die wartenden Kinder in Reihenfolge. `Zur Anfrage` öffnet die Anfrage des Kindes.",
      "Ist in einer AG ein Platz frei, steht dort `Platz frei` und beim ersten Kind `Als Nächstes dran`. Wähle bei seiner Anfrage `Freigeben`, dann rückt es nach.",
      "Anmeldungsänderungen öffnest du über `Prüfen`. Dafür brauchst du ein zusätzliches Recht.",
      // Ohne feste Gruppen gibt es keine Gruppenleitung, an der die
      // Freigabe haengen koennte.
      ...(groupMode === "open_care"
        ? []
        : [
            "Fehlt eine Anfrage? Je nach Einstellung deiner OGS siehst du nur Kinder deiner Gruppen.",
          ]),
    ],
    notes: [
      "Über `Historie` siehst du bereits entschiedene oder zurückgezogene Anfragen.",
    ],
    troubleshootingDetails: [
      // Live geprueft: ohne das Recht steht `Anfragen` nicht in der
      // Seitenleiste, und der Aufruf der Adresse landet auf der Startseite.
      "Fehlt `Anfragen` in der Seitenleiste? Dann darf deine Rolle keine Elternanfragen bearbeiten. Frage deine Leitung.",
    ],
    related: [
      HELP_TOPICS.parentMessage,
      HELP_TOPICS.editStudent,
      HELP_TOPICS.leadManageStudent,
    ],
  };
}
