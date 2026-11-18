import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Pruefung einer eingegangenen Anmeldung, `/admin/enrollments/[id]`. Die vier
 * Entscheidungen stehen in DECISION_ACTIONS (admin-enrollment-detail.tsx:100).
 */
export function enrollmentReviewTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.enrollments,
    title: "Eingegangene Anmeldungen prüfen",
    question: "Wie prüfe ich eine neue Anmeldung?",
    summary: "Du prüfst die Angaben und entscheidest je Kind.",
    group: "anmeldeverwaltung",
    audience: "lead",
    icon: "ListChecks",
    steps: [
      "Klappe in der Seitenleiste `Eltern` auf.",
      "Öffne `Anmeldungen` und danach `Überblick`.",
      "Wähle bei der Phase `Anmeldungen ansehen`.",
      "Öffne eine Anmeldung aus der Liste.",
      "Prüfe die `Angaben der Kinder` und die `Zusatzfragen (Eltern)`.",
      "Wähle eine Entscheidung: `Bestätigen`, `Warteliste`, `Ablehnen` oder `Zur Prüfung`.",
    ],
    result:
      "Die Eltern sehen die Entscheidung bei ihrer Anmeldung. Bei `Bestätigen` wird das Kind übernommen.",
    notes: [
      "Du entscheidest je Kind. Eine Anmeldung kann mehrere Kinder enthalten.",
      // #6053, #6148 (manuelle Anmeldung)
      "Ist schon ein Kind mit diesem Namen und Geburtsdatum angemeldet, fragt moto beim `Bestätigen` nach. Wähle `Bestehendes Kind verwenden`, verlängert moto nur die Anmeldung dieses Kindes. Die Eltern aus der Anmeldung bekommen dadurch keinen Zugang. Ist es ein anderes Kind, wähle `Als neues Kind anlegen`. Dieselbe Frage kommt, wenn du ein Kind selbst mit `Kind anlegen und freigeben` anmeldest.",
      // #6247: dasselbe Kind von beiden Eltern angemeldet.
      "Haben zwei Eltern dasselbe Kind angemeldet? Dann steht bei der zweiten Anmeldung `ist in dieser Phase schon angemeldet`. Mit `Anmeldung öffnen` siehst du die erste Anmeldung. Ist es dasselbe Kind, wähle `Als doppelt ablehnen`. Die Eltern lesen dann nur, dass ihr Kind schon angemeldet ist. Trage den zweiten Elternteil danach in der Akte des Kindes ein.",
      // #6837
      "Hast du ein Angebot nach der Anmeldung geändert, etwa Preis oder Tage? Dann steht beim Angebot `Seit der Anmeldung geändert` mit der Wahl der Eltern. Beim `Bestätigen` fragt moto nach. Mit `Neue Angaben bestätigen` gelten die neuen Angaben. Informiere die Familie über die Änderung.",
      // #6041
      "Ist der Start eines bestätigten Kindes für später geplant, steht es erst ab dem Start unter `Alle Kinder`. Vorher findest du es unter `Datenverwaltung` und danach `Kinderdaten`.",
      // #6043: Wiederanmeldung vor dem Start der Betreuung.
      "Wird ein Kind schon betreut und beginnt die Anmeldung später? Dann gelten Abholzeiten, Betreuungstage und Heimweg daraus erst ab dem Start. Bis dahin bleiben die bisherigen. Das Datum steht beim Kind. Steht der Hinweis nach dem Start noch da, gelten weiter die bisherigen. Melde dich dann beim moto-Team.",
      // #5934
      "Unter `E-Mails an die Familie` siehst du, ob die Mails zu dieser Anmeldung angekommen sind. Steht dort `Adresse prüfen`, sprich die Familie direkt an.",
      "Auf der Seite der Phase steht unter `Freie Plätze je Angebot`, wie viele Plätze noch frei sind. `Belegt` zählt die Kinder am vollsten Tag bis zum Ende der Phase.",
      "Hochgeladene Nachweise stehen bei `Zusatzfragen (Eltern)`. Mit `Öffnen` siehst du die Datei in einem neuen Tab.",
      "Hat die Vorlage `Unterschrift erforderlich`, steht die Unterschrift der Eltern im Abschnitt `Unterschrift`. Mit `Nachweis als PDF` lädst du den Anmeldenachweis mit der Unterschrift herunter.",
      "Mit `Statusseite öffnen` siehst du, was die Eltern sehen.",
      // #5102: Auswirkung nach einer Korrektur unter `Nachbearbeitung`.
      "Angebote eines bestätigten Kindes änderst du unter `Nachbearbeitung` mit `Bearbeiten`. Danach steht dort `Auswirkung auf den Betreuungsplan`.",
      "Unter `Automatisch angepasst` stehen Regeltermine, die moto selbst geändert hat.",
      "Unter `Nicht angepasst, weil von Hand gepflegt` steht das Kind an abgemeldeten Tagen weiter im Plan. Mit `Dort auch entfernen` nimmst du es dort ab diesem Datum heraus. Vergangene Termine bleiben.",
      "Unter `Abholzeit weicht von der Buchung ab` gilt an einem Tag noch eine von Hand eingetragene Abholzeit. Mit `Gebuchte Zeiten übernehmen` gilt die gebuchte Zeit. Steht ein Datum dabei, gilt sie erst ab diesem Tag.",
      // #5497
      "Steht dort ein Enddatum, gibt es danach wieder eine passende Buchung. Das Kind wird dann nur bis zu diesem Tag herausgenommen.",
      "Hast du die Seite schon verlassen? Der Hinweis bleibt im `Betreuungsplan` unter `Ohne passende Buchung eingeplant`.",
      // #5137
      "Plant ein Regeltermin alle Kinder einer Klasse, eines Jahrgangs oder einer Gruppe, steht dort `Mit Angebot verbinden`. Entfernen hilft dort nicht: Bei der nächsten Planung steht das Kind wieder im Plan.",
      "Offene Rückfragen der Eltern stehen im Bereich `Anfragen`.",
      "Die Zahl an `Anmeldungen` zeigt, wie viele neue Anmeldungen du noch nicht gelesen hast.",
      "Gelesen gilt nur für dich. Dein Team hat eine eigene Zahl.",
      "Wenn du eine Anmeldung öffnest, gilt sie als gelesen.",
      "Offene Anmeldungen in aktiven Phasen markierst du im Menü `⋮` als gelesen oder ungelesen.",
      "Im Menü `⋮` oben im `Überblick` wählst du `Alle als gelesen markieren`.",
      "Ändern Eltern ihre Anmeldung, ist sie wieder ungelesen.",
      "Du möchtest bei jeder neuen Anmeldung eine E-Mail? Wähle im Menü `⋮` oben im `Überblick` `E-Mail an mich bei neuer Anmeldung`.",
      "Ein Haken zeigt: Die E-Mail ist eingeschaltet. Noch einmal wählen schaltet sie aus. Das gilt nur für dich.",
      "Die E-Mail geht an deine E-Mail-Adresse in moto.",
    ],
    differences: [
      "Der Überblick zählt je Phase, wie viele Eingänge offen, bestätigt und abgelehnt sind.",
      "Auf dem Handy erscheint nur ein Hinweis. Die Prüfung läuft am Computer.",
    ],
    troubleshootingDetails: [
      "Steht dort `Dieser Elternteil darf das Kind nicht mehr anmelden`, prüfe Name und Geburtsdatum. Ist das Kind schon angemeldet, wähle `Bestehendes Kind verwenden`. Die Eltern bekommen dadurch keinen Zugang. `Als neues Kind anlegen` wählst du nur, wenn es ein anderes Kind ist. Bei einer Anmeldung nur für angemeldete Kinder gibt es diese Wahl nicht. Passt kein Kind, lehne die Anmeldung ab.",
      "Eine Anmeldung war versehentlich abgelehnt? Wähle `Anmeldung wiederherstellen`.",
      "Bei einem Nachweis steht `Keine Berechtigung zum Öffnen`? Dann fehlt dir das Recht `Nachweise aus Anmeldungen ansehen`. Frage deine Leitung.",
      "Bei einem Nachweis steht `Nachweis gelöscht (Löschfrist abgelaufen)`? Die Frist ist vorbei. Bitte die Eltern bei Bedarf um einen neuen Nachweis.",
      "Bei der Unterschrift steht `Der gespeicherte Eintrag wurde nachträglich verändert`? Dann passt die Unterschrift nicht mehr zu ihrer Prüfsumme. Wende dich an das moto-Team.",
      "Beim Bestätigen erscheint `Das Kinderkontingent deiner Schule ist voll`? Dann bleibt die Anmeldung offen. Für weitere Kinder melde dich beim moto-Team.",
      "Kinder, die schon aktiv oder vorgemerkt sind, kannst du auch bei vollem Kinderkontingent verlängern.",
      "Bei einer Anmeldung steht `Wegen Kinderkontingent offen`? Beim Schuljahreswechsel war das Kinderkontingent voll. Das Kind wurde nicht automatisch verlängert. Entscheide selbst.",
      "Trotz Haken kommt keine E-Mail? Schau im Spam-Ordner nach.",
    ],
    related: [
      HELP_TOPICS.leadEnrollmentSetup,
      HELP_TOPICS.leadEnrollmentCleanup,
      HELP_TOPICS.parentRequests,
    ],
  };
}
