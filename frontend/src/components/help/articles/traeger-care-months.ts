import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function traegerCareMonthsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerCareMonths,
    title: "Monatsbeiträge abrechnen",
    question: "Wie rechne ich die Betreuung jeden Monat ab?",
    summary:
      "Ein Monatslauf rechnet einen Monat für die gewählten Schulen nach den gültigen Verträgen ab. Der Beitrag eines Kindes kommt aus der Preisliste: als Summe der gebuchten Wochentage oder als Staffel nach Tagen je Woche. Es zählt der Vertrag, nicht die Anwesenheit. Vor der Freigabe prüfst du die Vorschau, änderst einzelne Rechnungen und schließt Rechnungen aus, die noch nicht stimmen. Nach der Freigabe erstellst du die Schreiben, sendest sie an die Familien und stornierst eine falsche Rechnung.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "CalendarCheck",
    requirements: [
      "Deine Rolle im Träger-Büro ist Abrechnung. Nur diese Rolle sieht in der Navigation die Bereiche unter `Finanzen`.",
      "Die Kinder haben einen gültigen Betreuungsvertrag. Module und gebuchte Wochentage kommen aus dem Vertrag.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Preise festlegen",
        description:
          "Jede Schule hat eigene Preise. Jedes Modul hat eine Preisform. `Je Wochentag`: Jeder gebuchte Tag hat einen Monatspreis, der Beitrag ist die Summe. `Nach Tagen je Woche`: Der Beitrag hängt nur von der Zahl der gebuchten Tage ab, zum Beispiel 3 Tage = 60,00 €.",
        steps: [
          "Wähle `Preise und Ermäßigungen`. Der Reiter `Preisliste` ist schon offen.",
          "Wähle bei der Schule `Neue Preise`.",
          "Wähle bei `Gültig ab` den Monat, ab dem die Preise gelten.",
          "Wähle bei `Beitragsfreie Monate` die Monate ohne Beitrag, zum Beispiel `Aug`. Dann stellt der Monatslauf für diese Schule im August keine Rechnung aus.",
          "Wähle je Modul `Je Wochentag` oder `Nach Tagen je Woche`.",
          "Trage unter `1. Kind` die Monatspreise ein, zum Beispiel 16,00. Ein leeres Feld setzt keinen Preis. Dann gilt der Preis davor.",
          "Hat jedes weitere Kind einen eigenen Preis, trage ihn unter `Jedes weitere Kind` ein, zum Beispiel 12,50. Leer heißt: gleicher Preis wie beim 1. Kind. Lege unter `Ermäßigungen` eine Geschwisterregel mit `Preis laut Preisliste` an.",
          "Kostet ein Modul an jedem Tag gleich viel, trage nur Montag ein. Wähle dann `Mo-Preise für alle Tage übernehmen`.",
          "Kostet ein Modul dasselbe wie ein anderes, wähle `Werte übernehmen von …` und dann das andere Modul.",
          "Ist das Essen nicht im Preis, setze den Haken bei `Essen extra`. Das Essen rechnet die Mensa ab.",
          "Wähle `Preise speichern`.",
        ],
      },
      {
        title: "Rechnungsnummern festlegen",
        description: "Das machst du einmal vor der ersten Freigabe.",
        steps: [
          "Wähle unten in der Navigation `Einstellungen` und dann `Abrechnungsvorgaben`.",
          "Wähle bei `Rechnungsnummern der Monatsbeiträge` den Knopf `Muster festlegen`.",
          "Trage ein Muster ein, zum Beispiel MB-{JJJJ}-{NNNN}. Nimm ein anderes Kürzel als bei den Ferien.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Nummern aus dem bisherigen Programm fortführen",
        description:
          "Nur nötig, wenn deine Rechnungen nicht bei 1 beginnen sollen.",
        steps: [
          "Wähle bei `Rechnungsnummern der Monatsbeiträge` den Knopf `Nächste Nummer ändern`.",
          "Trage die Nummer nach der letzten Rechnung deines bisherigen Programms ein.",
          "Wähle `Speichern`.",
          "Mit `Verlauf ansehen` siehst du, wer die Nummer wann geändert hat.",
        ],
      },
      {
        title: "Monatslauf starten und prüfen",
        steps: [
          "Wähle `Abrechnungsläufe` und dann den Reiter `Monatsbeiträge`.",
          "Wähle `Monatslauf starten` und dann den Monat.",
          "Wähle bei `Schulen` die Schulen. Alle sind schon gewählt. Eine Schule, die schon in einem offenen Lauf dieses Monats ist, lässt sich nicht wählen.",
          "Wähle bei `Rechnungsdatum` das Datum, das auf jeder Rechnung steht, zum Beispiel den 30.10. für Oktober. Lässt du das Feld leer, gilt der Tag der Freigabe.",
          "Wähle `Vorschau öffnen`.",
          "Prüfe die Rechnungen. Je Schule steht eine Karte. Jede Rechnung hat je Modul eine Zeile mit den gebuchten Wochentagen.",
          "Steht oben `Ohne Preis`, fehlt für einen gebuchten Wochentag oder eine Zahl von Tagen je Woche ein Preis. Wähle `Preis eintragen`. Danach kommt das Kind in den Lauf.",
          "Steht oben `Doppelter Vertrag – bitte prüfen`, rechnen zwei Verträge eines Kindes am selben Tag dasselbe Modul ab. Die Freigabe rechnet dieses Kind mit allen seinen Verträgen nicht ab, alle anderen Kinder schon. Nach der Freigabe steht es unter `Nicht abgerechnet – Doppelter Vertrag`. Beende oder ändere einen der Verträge. Starte dann einen neuen Monatslauf für diesen Monat. Er rechnet nur dieses Kind ab.",
          "Steht `Ein Kind an zwei Schulen`, hat ein Kind die Schule gewechselt und an jeder Schule eine eigene Kinderakte. Name, Geburtstag und Familie sind gleich, die Verträge laufen nacheinander. moto rechnet beide Verträge darum ab wie die eines Kindes. Sind es doch zwei Kinder, gib den Lauf nicht frei und schreib dem moto-Support.",
          "Steht `Kind hat schon eine Rechnung – bitte prüfen`, ist der Monat für das Kind schon abgerechnet: durch eine Rechnung oder einen Jahresbescheid eines anderen Vertrags. Der Lauf stellt keine zweite Rechnung aus. Wähle `Rechnung öffnen`, `Bescheid öffnen` oder `Jahresbescheid öffnen` und prüfe das Dokument. Stimmt es, musst du nichts tun. Eine falsche Rechnung stornierst du. Einen falschen Jahresbescheid änderst du mit einem neuen Jahreslauf. Öffne danach den Monatslauf wieder. Er rechnet das Kind jetzt ab.",
          "Steht `Betreuung noch nicht abgerechnet – Rechnung nur mit Mensa`, enthält die Rechnung des Kindes nur die Mensa. Storniere sie. Danach rechnet der Lauf das Kind neu und zeigt, was noch offen ist.",
          "Ist der Lauf schon freigegeben, starte nach dem Storno einen neuen Monatslauf für diesen Monat.",
        ],
      },
      {
        title: "Vorschau prüfen und Rechnungen ausschließen",
        description:
          "Du kannst eine Rechnung aus diesem Lauf nehmen. Sie kommt im nächsten Lauf dieses Monats wieder. Hat ein Kind eine Rechnung für die Betreuung und eine eigene `Mensa-Rechnung`, schließe jede für sich aus.",
        steps: [
          "Wähle bei `Monatslauf` den Knopf `Prüfliste` und dann `PDF`, `Excel` oder `CSV`. Die Liste hat je Position eine Zeile. Rechnungsnummern stehen noch nicht darin.",
          "Nach der Freigabe heißt der Knopf bei `Monatslauf` `Herunterladen`. Die Datei enthält alle Rechnungen des Laufs mit ihren Nummern.",
          "Stimmt eine Rechnung noch nicht, wähle in ihrer Zeile das Menü mit den drei Punkten und dann `Ausschließen`.",
          "Prüfe im Fenster, welche Rechnung du ausschließt. Dort steht zum Beispiel `Mensa-Rechnung` und darunter, ob die Betreuungsrechnung des Kindes im Lauf bleibt. Steht die Mensa auf der Rechnung der Betreuung, wird sie mit ausgeschlossen.",
          "Schreibe bei `Grund`, warum, zum Beispiel „Kündigung wird noch geprüft“. Wähle `Ausschließen`.",
          "Die Rechnung steht jetzt unter `Ausgeschlossen`. Sie zählt nicht zur Summe und bekommt bei der Freigabe keine Nummer. Die andere Rechnung des Kindes bleibt im Lauf.",
          "Mit `Wieder aufnehmen` nimmst du genau diese Rechnung zurück in den Lauf.",
          "Sind alle Rechnungen ausgeschlossen, wähle trotzdem `Lauf freigeben`. Der Lauf schließt ohne Rechnungen und gibt die Schulen wieder frei. Die Gründe bleiben im Verlauf. Ein neuer Lauf kann diese Kinder abrechnen.",
          "Das Rechnungsdatum änderst du bei `Rechnungsdatum` mit `Bearbeiten`.",
        ],
      },
      {
        title: "Leeren Monatslauf verwerfen",
        description:
          "Hat ein offener Lauf nichts abzurechnen, lässt er sich nicht freigeben. Das passiert zum Beispiel, wenn alle Verträge des Monats geendet haben. Dann verwirfst du ihn.",
        steps: [
          "Öffne den Lauf. Steht dort `Dieser Lauf hat nichts abzurechnen`, wähle oben `Leeren Lauf verwerfen`.",
          "Wähle im Fenster `Verwerfen`.",
          "Der Lauf steht jetzt als `Verworfen` in der Liste. Er hat nichts ausgestellt. Wer ihn wann verworfen hat, steht im Verlauf.",
          "Der Monat ist danach frei. Starte bei Bedarf einen neuen Monatslauf.",
        ],
      },
      {
        title: "Eine Rechnung vor der Freigabe ändern",
        description:
          "Du änderst nur diese eine Rechnung in diesem Lauf. Die Familie und andere Rechnungen bleiben, wie sie sind. Jede Änderung braucht einen Grund und steht im Verlauf der Rechnung.",
        steps: [
          "Wähle in der Zeile der Rechnung das Menü mit den drei Punkten und dann `Rechnung ändern`. Die Seite der Rechnung öffnet sich.",
          "Wähle oben `Ändern` und dann `Betrag ändern`, `Position hinzufügen`, `Empfänger ändern` oder `Anschrift ändern`.",
          "Trage den neuen Wert ein und schreibe bei `Grund`, warum. Wähle den Knopf unten im Fenster.",
          "Einen neuen Betrag zeigt die Rechnung als eigene Zeile `Korrektur` mit dem Unterschied. Die berechneten Zeilen bleiben stehen.",
          "Eine Position nimmst du heraus: Wähle bei der Position das Menü mit den drei Punkten und dann `Position entfernen`. Die Position bleibt durchgestrichen sichtbar, die Rechnung bekommt eine Zeile mit Minus.",
          "Eine Änderung nimmst du zurück: Wähle im `Verlauf der Änderungen` bei der Änderung `Zurücknehmen` und schreibe einen Grund. Der Eintrag bleibt im Verlauf.",
          "Prüfe danach die Vorschau. Hast du die Seite vorher geprüft, prüfe sie noch einmal. Erst dann gibst du frei.",
        ],
      },
      {
        title: "Monatslauf freigeben",
        steps: [
          "Wähle `Lauf freigeben`.",
          "Prüfe Zahl und Summe der Rechnungen und wähle `Freigeben`.",
          "Steht im Dialog `Noch offen`, kläre diese Punkte zuerst. Oder du gibst mit `Trotzdem freigeben` frei. Zahlt eine Familie per Lastschrift ohne gültiges Mandat, gib erst frei, wenn das Mandat da ist oder die Familie überweist.",
          "Jede Rechnung bekommt ihre Nummer und das Rechnungsdatum. Danach ändert sie sich nicht mehr.",
          "Hat sich seit deiner Prüfung etwas geändert, zum Beispiel ein Vertrag, ein Preis oder eine Änderung einer Rechnung, gibt moto nicht frei. Die Seite zeigt den neuen Stand. Prüfe ihn und gib dann frei.",
          "Passt eine Änderung einer Rechnung nicht mehr, zum Beispiel weil sich der Preis geändert hat, gibt moto nicht frei. Wähle in der Meldung `Rechnung öffnen` und nimm die Änderung zurück.",
          "Die Familien sehen davon noch nichts. Sie bekommen erst das Schreiben, das du sendest.",
        ],
      },
      {
        title: "Schreiben erstellen",
        description:
          "Jede Familie bekommt ein Schreiben im Briefkopf des Trägers. Es ist ihre Rechnung. Erstellen sendet noch nichts.",
        steps: [
          "Wähle im freigegebenen Lauf bei `Schreiben an die Familien` den Knopf `Schreiben erstellen`. Die Seite mit den Schreiben des Laufs öffnet sich.",
          "Wähle dort bei `Schreiben an die Familien` noch einmal `Schreiben erstellen`.",
          "Prüfe die `Fälligkeiten`. Sie stehen auf den Rechnungen fest. Nur ältere Rechnungen haben noch das Feld `Zahlen bis`.",
          "Schreibe bei `Hinweis für die Familien` etwas, wenn alle Familien es lesen sollen. Das ist freiwillig.",
          "Wähle `Vorschau ansehen`. Du siehst das Schreiben der ersten Familie.",
          "Wähle `Schreiben erstellen`. Danach lassen sich die Schreiben nicht mehr ändern.",
        ],
      },
      {
        title: "Schreiben senden und drucken",
        description:
          "Jede Familie bekommt ihr Schreiben per E-Mail. Hat sie mit dieser Adresse ein Konto in der Eltern-App, liegt es auch dort unter `Dokumente`. Das geht nur, wenn das Kind einen Schülerdatensatz hat. Sonst steht bei der Rechnung `Nicht in der Eltern-App`, und die Familie bekommt das Schreiben per E-Mail oder gedruckt.",
        steps: [
          "Wähle im freigegebenen Lauf bei `Schreiben an die Familien` den Knopf `Schreiben öffnen`. Dort steht schon, wie viele Schreiben gesendet sind.",
          "Wähle bei `Schreiben an die Familien` den Knopf `An alle senden`. Prüfe die Zahl und bestätige, zum Beispiel mit `3 Schreiben senden`.",
          "Die Karte zeigt, wie viele Schreiben gesendet sind, gerade gesendet werden, nicht angekommen sind, noch nicht gesendet sind und keine E-Mail-Adresse haben.",
          "In jeder Rechnung steht unter `An die Familie`, ob ihr Schreiben gesendet ist. `Ausgestellt am` sagt nur, dass die Rechnung ihre Nummer hat.",
          "Ist ein Schreiben nicht angekommen, wähle bei der Rechnung das Menü mit den drei Punkten und dann `Erneut senden`. Mit `Senden` schickst du ein einzelnes Schreiben zum ersten Mal.",
          "Mit `Schreiben ansehen` im Menü siehst du genau das Schreiben, das die Familie bekommt.",
          "Für Familien ohne E-Mail wählst du `Drucken` und dann `Nur Familien ohne E-Mail`. Gib ihnen das gedruckte Schreiben. `Alle Schreiben drucken` druckt alle Schreiben, die noch gelten.",
        ],
      },
      {
        title: "Rechnung stornieren und neu ausstellen",
        description:
          "Eine ausgestellte Rechnung ändert sich nie. Stimmt sie nicht, storniere sie. Der Storno bekommt eine eigene Nummer.",
        steps: [
          "Wähle im freigegebenen Lauf `Schreiben öffnen`. Gibt es noch keine Schreiben, heißt der Knopf `Schreiben erstellen`.",
          "Wähle bei der Rechnung das Menü mit den drei Punkten und dann `Stornieren`.",
          "Schreibe bei `Begründung`, warum du stornierst. Wähle `Stornieren`.",
          "Hatte die Familie die Rechnung schon bekommen, bekommt sie ein Storno-Schreiben. Es steht als eigene Zeile unter der Rechnung. Sende es über das Menü dieser Zeile mit `Senden`.",
          "Hast du die Rechnung zum Drucken heruntergeladen, bekommt der Storno auch ein Schreiben. Lade es über `Drucken` und `Alle Schreiben drucken` herunter. Gib es der Familie auf Papier.",
          "Wurde die Rechnung weder gesendet noch zum Drucken heruntergeladen, bekommt die Familie kein Storno. Sie sieht nichts davon.",
          "Wähle in der Meldung über den Rechnungen `Neu ausstellen`. Ein passender Prüflauf öffnet sich, sonst ein neuer Lauf. Ein neuer Lauf enthält nur Schulen mit noch offenen Stornos. Gib ihn frei und sende das neue Schreiben. Verteilen sich die Stornos auf mehrere Prüfläufe, wiederhole `Neu ausstellen`. Sind alle Rechnungen neu ausgestellt, verschwindet die Meldung im alten Lauf.",
          "Die neue Rechnung übernimmt die Änderungen der stornierten Rechnung, zum Beispiel einen geänderten Betrag oder Empfänger. Im Verlauf steht dann `Übernommen aus` mit der alten Nummer. Passt eine Änderung nicht mehr, nimm sie dort zurück.",
        ],
      },
      {
        title: "Liste der Monatsläufe herunterladen",
        steps: [
          "Wähle `Abrechnungsläufe` und dann den Reiter `Monatsbeiträge`.",
          "Wähle oben rechts das Menü mit den drei Punkten. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`. Die Datei enthält alle Monatsläufe.",
        ],
      },
    ],
    result:
      "Die Rechnungen des Monats sind ausgestellt, und die Familien haben ihr Schreiben per E-Mail oder auf Papier. Ein späterer Lauf desselben Monats rechnet nur Kinder ab, die noch keine gültige Rechnung für diesen Monat haben.",
    differences: [
      "Beginnt, endet oder ändert sich ein Vertrag im Monat, zählt standardmäßig der Vertrag am 1. des Monats für den ganzen Monat. Beginnt die Betreuung erst im Monat, zählt der erste Vertrag den ganzen Monat. Ein weiterer Vertrag, der später im Monat beginnt, zählt erst ab dem nächsten Monat. Anteilig nach Kalendertagen stellst du unter `Einstellungen`, `Allgemein`, Bereich `Monatsbeitrag` ein.",
      "Mit einem Preis, für den es schon eine Rechnung gibt, rechnet der Monat weiter ab. Ändere ihn ab einem späteren Monat. Fehlende Preise ergänzt du auch für einen schon abgerechneten Monat. Der nächste Lauf dieses Monats rechnet die Kinder dann ab.",
    ],
    notes: [
      "Welche Änderungen einer Rechnung möglich sind, stellt dein Träger unter `Einstellungen`, `Allgemein`, Bereich `Monatsbeitrag` ein. Standardmäßig sind alle vier an.",
      "Ferienpreise legst du im Ferienzeitraum fest. Die Preisliste gilt nur für die Monatsbeiträge.",
      "Die Preise für weitere Kinder gelten erst mit einer Geschwister-Regel mit der Wirkung `Preis laut Preisliste`. Die Regel legst du unter `Ermäßigungen` an.",
      "In einem beitragsfreien Monat steht im Monatslauf bei `Beitragsfreier Monat`, wie viele Verträge keine Rechnung bekommen.",
    ],
    troubleshootingDetails: [
      "Eine Schule lässt sich beim Start nicht wählen: Sie ist schon in einem offenen Lauf dieses Monats. Öffne diesen Lauf in der Liste und gib ihn frei. Hat er nichts abzurechnen, wähle `Leeren Lauf verwerfen`.",
      "`Leeren Lauf verwerfen` meldet, dass der Lauf etwas abzurechnen hat: Seit dem Öffnen ist ein Vertrag oder Preis dazugekommen. Prüfe die Vorschau und gib den Lauf frei.",
      "`Schreiben erstellen` geht nicht: Es fehlt eine Bankverbindung. Trage sie unter `Einstellungen`, `Abrechnungsvorgaben` ein.",
      "Ein Schreiben geht nicht raus, weil die Person nicht mehr im Vertrag steht: Storniere die Rechnung. Wähle dann `Neu ausstellen`. Die neue Rechnung geht an die Person im Vertrag.",
      "`Erneut senden` fehlt: Die Mail ist noch unterwegs, oder die Adresse ist gesperrt. Der Hinweis bei der Rechnung sagt, was zu tun ist. Drucke das Schreiben, wenn die Adresse gesperrt ist.",
    ],
    related: [
      HELP_TOPICS.traegerCareContracts,
      HELP_TOPICS.traegerBillingRun,
      HELP_TOPICS.traegerBillingTerms,
    ],
  };
}
