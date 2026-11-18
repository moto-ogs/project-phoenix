import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/betreuungsplan`. Vier Ansichten (`Tag`, `Woche`, `Monat`, `Serien`), das
 * Aendern bleibt Admins vorbehalten -- ohne das Recht traegt die Kopfzeile
 * `Nur ansehen` (betreuungsplan-view.tsx:1630).
 */
export function leadCarePlanTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadCarePlan,
    title: "Einen Betreuungsplan erstellen",
    question: "Wie plane ich die Woche der Betreuung?",
    summary: "Der Betreuungsplan legt fest, wer wann welche Kinder betreut.",
    group: "planung",
    audience: "lead",
    icon: "Table",
    steps: [
      "Klappe in der Seitenleiste `Planung` auf.",
      "Öffne `Betreuungsplan`.",
      "Wähle oben die Ansicht `Tag`, `Woche`, `Monat` oder `Serien`.",
      "Blättere mit den Pfeilen zur gewünschten Woche.",
      "Lege die Termine der Woche an.",
      "Prüfe zum Schluss die gemeldeten Konflikte.",
    ],
    result: "Dein Team sieht den Plan unter `Heute` und unter `Mein Kalender`.",
    notes: [
      "Ein Regeltermin wiederholt sich. Die Ansicht `Serien` zeigt alle Regeltermine.",
      // #5102: Hand-Kinderlisten folgen keiner Abmeldung; #5137: Klassen-
      // Regeltermine führen zu „Mit Angebot verbinden“.
      "Wählst du die Kinder eines Regeltermins von Hand oder über Klasse, Jahrgang oder Gruppe aus, folgt er keiner Abmeldung. Nach einer Abmeldung nennt moto diese Regeltermine. Bei einer Liste von Hand wählst du dort `Dort auch entfernen`, bei Klasse, Jahrgang oder Gruppe `Mit Angebot verbinden`.",
      // #5102: der Hinweis bleibt nach dem Neuladen im Betreuungsplan.
      "Hast du dort nichts gewählt, steht das Kind in der Ansicht `Serien` unter `Ohne passende Buchung eingeplant`. Wähle `Entfernen` oder `Bleibt so`. Die Startseite zeigt dazu `Kinder ohne passende Buchung`.",
      // #5497: eine spätere Buchung beendet die Lücke.
      "Gibt es später wieder eine passende Buchung, nennt moto den Zeitraum bis dahin. `Entfernen` gilt dann nur für diesen Zeitraum. Ab der neuen Buchung bleibt das Kind eingeplant.",
      "Aufgaben ohne Kinder, etwa Busaufsicht oder Essensausgabe, legst du mit dem `Typ` `Dienst` an. Ein Dienst hat keine Kinderliste und wird nicht gestartet. Der Raum ist freiwillig.",
      // #4573, ADR 0091: Externe in Regelterminen, auch allein und zuständig.
      "Externe Personen wählst du im Schritt `Personal und Kinder` unter `Personal` wie alle anderen, auch mit `Kein Zugang`. Fehlt jemand, wähle darunter `Externe Person eintragen`.",
      "Hat die externe Person `Kein Zugang`, startet eine OGS-Kraft den Termin. Mit `Eigene Termine betreuen` startet sie ihn selbst.",
      // #5104: was die Zielgruppe wirklich bedeutet.
      "Die `Zielgruppe` `Klasse`, `Jahrgang` oder `Gruppe` bringt alle Kinder dieser Klasse, Jahrgangsstufe oder Gruppe. Ob sie angemeldet sind, spielt keine Rolle. Spätere An- und Abmeldungen kommen dort nicht an.",
      "Sollen nur angemeldete Kinder kommen? Passt deine Auswahl zu einem Angebot, schlägt moto es im Schritt `Personal und Kinder` vor. Wähle `Angebot übernehmen`. Passen mehrere Angebote, wählt moto keins vor. Dann wähle das passende, etwa `„Randstunde“ übernehmen`. Die Vorschau zeigt pro Wochentag, wer dazukommt und wer wegfällt.",
      "Eine externe Person kann einen Termin allein betreuen. Sie kann auch die `Zuständige Person` sein.",
      "Wähle im Drei-Punkte-Menü `Drucken oder exportieren`. Wähle Vorlage, Fassung und Zeitraum. `Drucken` öffnet die Druckansicht. Für eine Datei wähle das Format und `Herunterladen`.",
      // #4766: Filter Gruppe und Person in Tag, Woche und Monat.
      "Nur eine Gruppe oder eine Person planen? Wähle oben bei `Alle Gruppen` eine OGS-Gruppe oder bei `Alle Personen` eine Person. Die Gruppe zeigt Termine mit Kindern der Gruppe oder mit der Gruppe als Teilnehmer. Die Person zeigt auch ihre Vertretungen.",
      // #4768: Raumfilter.
      "Einen Raum für eine neue AG suchen? Wähle oben bei `Alle Räume` den Raum. Dann siehst du, wann er belegt ist.",
      "Ist ein Filter gewählt, druckt `Drucken oder exportieren` nur die gefilterten Termine.",
      // ADR 0116: die ausgerichtete Ferienwoche im Plan.
      "Richtet deine OGS eine Ferienwoche für den Träger aus, steht im Kopf jedes Tages `Ferienbetreuung` mit der Zahl der Kinder. Die Betreuungszeit ist in der Spalte orange hinterlegt. Plane dafür Personal ein. An einem Schließtag gibt es keine Ferienbetreuung.",
      // #5028: Sa/So nur in der Woche des heutigen Wochenendes.
      "Betreut deine OGS am Wochenende? Dann gilt dort der Freitagsplan. Am Wochenende zeigt die Wochenansicht dieser Woche auch Samstag und Sonntag.",
    ],
    differences: [
      "Steht oben `Nur ansehen`? Dann darfst du den Plan lesen, aber nicht ändern.",
      "`Monat` und `Serien` stehen nicht in jeder Ansicht zur Wahl.",
    ],
    troubleshootingDetails: [
      "Die Woche sagt `Noch kein Planungszeitraum`? Wähle `Planungszeitraum anlegen` oder trage zuerst unter `Schuljahr und Kalender` einen Zeitraum ein.",
      "Ein Regeltermin lässt sich nur ab heute beenden. Vergangene Termine löschst du einzeln.",
    ],
    related: [
      HELP_TOPICS.leadCalendarPeriods,
      HELP_TOPICS.leadRosterDeviation,
      HELP_TOPICS.leadSubstitutionPlan,
      HELP_TOPICS.leadDayLists,
    ],
  };
}
