import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Regeltermine, deren Kinderliste von den Anmeldungen abweicht (#5103):
 * Hinweis an der Karte, „Zu prüfen“, „Mit Angebot verbinden“ mit Vorschau
 * und „Liste so lassen“; mehrere Angebote zusammen (#5139). Beschriftungen aus
 * roster-deviation-hint.tsx, template-list.tsx, connect-offering-modal.tsx,
 * weekday-roster-section.tsx.
 */
export function leadRosterDeviationTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadRosterDeviation,
    title: "Regeltermin mit Angeboten verbinden",
    question:
      "Warum passt die Kinderliste eines Regeltermins nicht zu den Anmeldungen?",
    summary:
      "moto zeigt, wenn die Kinderliste eines Regeltermins nicht zu den Anmeldungen passt. Mit Angeboten verbunden, folgt die Kinderliste den Anmeldungen.",
    group: "planung",
    audience: "lead",
    icon: "ListChecks",
    requirements: [
      "Du darfst den Betreuungsplan bearbeiten.",
      "Deine Schule nutzt Betreuungsangebote mit Anmeldungen.",
    ],
    steps: [
      "Öffne `Betreuungsplan` und wähle oben `Serien`.",
      "Wähle `Zu prüfen`. Dann siehst du nur Regeltermine mit dem Hinweis `Weicht von Anmeldungen ab`.",
      "Lies den Hinweis. Er nennt die passenden Angebote. Er nennt auch die Kinder, die für keines davon angemeldet sind, mit Wochentag. Bei mehreren Kindern klappst du die Namen mit dem Pfeil auf.",
      "Wähle `Mit Angebot verbinden`.",
      "Prüfe unter `Angebote` die gewählten Angebote. Du kannst weitere Angebote dazu wählen oder abwählen.",
      "Prüfe die Vorschau. Sie zeigt für jeden Wochentag, wer dazukommt und wer wegfällt.",
      "Wähle `Verbinden`.",
    ],
    result:
      "Der Regeltermin zeigt `Automatisch`. An- und Abmeldungen im Angebot kommen ab dem nächsten Termin von selbst in die Kinderliste.",
    notes: [
      // #5139, #5342: mehrere Angebote zusammen als Quelle.
      "Passen mehrere Angebote zusammen, etwa `Randstunde` und `Ganztag`? Dann schlägt moto alle vor, die bis zum Ende des Regeltermins dauern. Das erkennt moto an der Abholzeit des Angebots. Ein Kind kommt, wenn es für eines davon angemeldet ist. So fällt kein Ganztagskind aus der Randstunde.",
      // #5342: ohne Abholzeit schlägt moto nur die nötigen Angebote vor.
      "Ein Angebot ohne Abholzeit schlägt moto nur vor, wenn ein Kind es braucht. Prüfe dann unter `Angebote`, ob ein Angebot fehlt.",
      "Angebote einer Anmeldephase für die Ferienbetreuung schlägt moto nie vor. Brauchst du eines davon, wähle es in `Mit Angebot verbinden` unter `Angebote` selbst aus.",
      "Soll die Kinderliste so bleiben? Wähle `Liste so lassen`. Dann verschwindet der Hinweis für diesen Regeltermin.",
      "Die Karte des Regeltermins zeigt dann `Die Kinderliste bleibt bewusst so.` Den Hinweis holst du zurück: Wähle dort oder in einem Termin des Regeltermins `Hinweis wieder zeigen`.",
      "Kommen Kinder über `Klasse` oder `Jahrgang` in den Regeltermin? Beim Bearbeiten steht unter der Kinderliste, wer so außerdem kommt.",
      // #6841, #8204: Klassen- und Gruppenwechsel und neue Kinder erreichen auch geplante Termine.
      "Kommt ein Kind neu dazu oder wechselt es die Klasse oder Gruppe, passt moto auch die schon geplanten Termine an. Vergangene Tage bleiben, wie sie waren.",
      "`Manuell` heißt: An- und Abmeldungen werden nicht übernommen. Die Kinder pflegst du selbst.",
      "Die Startseite zeigt die Aufgabe `Regeltermine prüfen`, solange ein Regeltermin abweicht.",
      "Wechselst du beim Bearbeiten die `Zielgruppe` auf `Angebot`, zeigt moto dieselbe Vorschau pro Wochentag.",
      // Schule am Berg: nur „Randstunde“ gewählt, Ganztagskinder fielen weg.
      "Ein Kind fällt weg, wenn es an diesem Tag in keinem gewählten Angebot angemeldet ist. Ist es in einem anderen Angebot angemeldet, nennt die Vorschau dieses Angebot. Wähle `Angebot dazunehmen` oder `Angebote dazunehmen`. Dann bleibt das Kind auf der Liste.",
      // Schule am Berg: alle Angebote gewählt, Kinder fielen trotzdem weg.
      "Neben jedem Kind, das wegfällt, steht der Grund. `nur Mo angemeldet` heißt: Das Kind ist nur montags angemeldet, der Regeltermin ist an anderen Tagen. Soll es trotzdem kommen, ändere seine Angebote in der Anmeldung unter `Nachbearbeitung`.",
      "Beim Anlegen eines Regeltermins schlägt moto ein passendes Angebot vor. Mit `Angebot übernehmen` verbindest du den neuen Regeltermin gleich mit dem Angebot. Schlägt moto mehrere Angebote zusammen vor, heißt der Knopf `Angebote übernehmen`.",
      "Passen beim Anlegen mehrere Angebotskombinationen gleich gut? Wähle einen der Knöpfe mit den Angebotsnamen. Er übernimmt alle dort genannten Angebote zusammen.",
      "Haben Kinder ein Angebot gebucht, aber an manchen Tagen keinen passenden Regeltermin? Dann steht über den Regelterminen die Liste `Angebote ohne Regeltermin`. Jede Zeile nennt Angebot, Klassen und Wochentage. Wähle `Regeltermin anlegen`: Der neue Regeltermin übernimmt die Kinder dieses Angebots aus den genannten Klassen. Oder verbinde einen bestehenden Regeltermin mit dem Angebot.",
      "Brauchen diese Kinder bewusst keinen eigenen Regeltermin? Wähle `Kein Regeltermin nötig`. Das gilt für den gewählten Zeitraum. Der Hinweis kommt wieder, sobald Kinder einer anderen Klasse betroffen sind. Das gilt auch für Ferienangebote.",
      "Diesen Hinweis holst du zurück: Klappe `Ohne eigenen Regeltermin` auf und wähle `Hinweis wieder zeigen`.",
      // #5343: Klassen-Regeltermine und Ankunftszeit der Klasse zählen mit.
      "Die Liste nennt nur Kinder, die an diesen Tagen auf keinem passenden Regeltermin stehen. Kommt die Klasse laut ihrer Ankunftszeit erst zur Abholzeit des Angebots, fehlt das Kind auch. Fehlt der Knopf, sind einige dieser Kinder schon ganz oder teilweise eingeplant oder haben noch Unterricht. Prüfe dann ihre Regeltermine und ergänze, was fehlt.",
      // #5137: Weg aus der Rückmeldung nach einer Buchungsänderung.
      "Nach einer Abmeldung führt `Mit Angebot verbinden` in der Rückmeldung direkt zu diesem Schritt. Das gilt auch für einen Regeltermin mit `Liste so lassen`. Verbindest du ihn, folgt seine Kinderliste wieder den Anmeldungen.",
      // #8203: Quellangebot einer abgelaufenen Anmeldephase.
      "Steht am Regeltermin `Angebot aus abgelaufener Phase`? Dann gehört sein Angebot zu einer Anmeldephase, die vorbei ist. Neue Anmeldungen kommen dort nicht mehr an. moto hängt den Regeltermin beim Phasenwechsel nicht selbst um, weil alte und neue Phase eine Zeit lang parallel laufen. Wähle `Mit neuem Angebot verbinden`. moto schlägt das gleichnamige Angebot der aktuellen Phase vor. Prüfe die Vorschau und wähle `Verbinden`.",
      "Findet moto kein passendes Angebot, sagt moto das. Öffne dann den Regeltermin mit `Bearbeiten`. Wechsle im Schritt `Personal und Kinder` die `Zielgruppe` auf `Angebot`.",
    ],
    differences: [
      "Hat der Regeltermin mehrere Abschnitte, etwa nach einer Änderung `Ab jetzt dauerhaft`? `Mit Angebot verbinden` stellt alle Termine ab dem nächsten Termin um. Das Bearbeiten ändert nur einen Abschnitt; die Vorschau nennt dann die Tage, die gleich bleiben.",
      // #5138: Passen Angebote gleich gut, wählt die Schule.
      "Nennt der Hinweis Angebote mit „oder“ und keine Zahl? Dann passen mehrere Angebote gleich gut. moto wählt keins vor. Wähle in `Mit Angebot verbinden` unter `Angebote` die passenden aus.",
      "Siehst du keine Knöpfe am Hinweis? Dann darfst du den Plan nur ansehen.",
    ],
    related: [HELP_TOPICS.leadCarePlan, HELP_TOPICS.leadEnrollmentSetup],
  };
}
