import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function traegerBillingRunTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerBillingRun,
    title: "Ferien abrechnen",
    question: "Wie stelle ich die Rechnungen für die Ferien aus?",
    summary:
      "Ein Abrechnungslauf erstellt die Rechnungen für einen Ferienzeitraum. Du prüfst die Vorschau, korrigierst einzelne Beträge, gibst den Lauf frei und erstellst die Schreiben an die Familien. Eine ausgestellte Rechnung stornierst du oder schreibst einen Betrag gut. Unter `Familien` siehst du pro Familie alle Rechnungen und die offene Forderung vor Zahlungseingang.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "FileText",
    image: "/help/screens/traeger-naechste-rechnungsnummer.webp",
    imageAlt:
      "Die Karte Rechnungsnummern der Ferien: Muster, nächste Nummer und letzte laufende Nummer, darunter der Verlauf mit Zeitpunkt und Person.",
    requirements: [
      "Deine Rolle im Träger-Büro ist Abrechnung. Nur diese Rolle sieht in der Navigation die Bereiche unter `Finanzen`.",
      "Der Ferienzeitraum ist veröffentlicht, und die Anmeldungen sind bestätigt.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Rechnungsnummern festlegen",
        description: "Das machst du einmal vor der ersten Freigabe.",
        steps: [
          "Wähle unten in der Navigation `Einstellungen`.",
          "Wähle `Abrechnungsvorgaben`.",
          "Wähle bei `Rechnungsnummern der Ferien` den Knopf `Muster festlegen`.",
          "Trage das Muster ein, zum Beispiel FE-{JJJJ}-{NNNN}. {NNNN} ist die laufende Nummer, {JJJJ} das Jahr.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Nummern aus dem bisherigen Programm fortführen",
        description:
          "Nur nötig, wenn deine Rechnungen nicht bei 1 beginnen sollen.",
        steps: [
          "Wähle bei `Rechnungsnummern der Ferien` den Knopf `Nächste Nummer ändern`.",
          "Trage die Nummer nach der letzten Rechnung deines bisherigen Programms ein, zum Beispiel 7100.",
          "Prüfe darunter, welche Nummer die nächste Rechnung bekommt.",
          "Wähle `Speichern`.",
          "Mit `Verlauf ansehen` siehst du, wer die Nummer wann geändert hat.",
        ],
      },
      {
        title: "Lauf starten und prüfen",
        steps: [
          "Wähle in der Navigation `Abrechnungsläufe`. Der Reiter `Ferien` ist schon offen.",
          "Wähle `Lauf starten`.",
          "Wähle den Ferienzeitraum und dann `Lauf starten`.",
          "Prüfe die Vorschau unter `Rechnungen`. Pro Familie steht dort eine Rechnung.",
          "Die Beträge pro Kind blendest du mit `Aufschlüsselung zeigen` unter allen Rechnungen ein. Auf dem Handy findest du `Aufschlüsselung zeigen` im Menü mit den drei Punkten.",
        ],
      },
      {
        title: "Vom Ferienzeitraum zur Abrechnung",
        description:
          "Du bearbeitest gerade einen Ferienzeitraum und willst zu seinen Rechnungen.",
        steps: [
          "Öffne den Ferienzeitraum unter `Ferienbetreuung`.",
          "Öffne oben rechts das Menü mit den drei Punkten und wähle `Zur Abrechnung`. Der Eintrag steht bei `Planung`, `Formular` und `Anmeldungen`.",
          "Hat der Zeitraum genau einen Lauf, öffnet sich dieser Lauf. Sonst siehst du die Abrechnung nur mit den Läufen dieses Zeitraums.",
          "Den Filter `Ferienzeitraum` entfernst du mit dem Kreuz. Dann siehst du wieder alle Läufe.",
          "Hat der Zeitraum noch keinen Lauf, wähle `Lauf starten`. Der Zeitraum ist schon gewählt.",
          "Im Lauf führt das Menü mit den drei Punkten neben dem Titel mit `Zum Ferienzeitraum` zurück zur Planung.",
        ],
      },
      {
        title: "Einen Betrag korrigieren",
        steps: [
          "Wähle bei der Rechnung das Menü mit den drei Punkten.",
          "Wähle `Betrag für … korrigieren`.",
          "Trage den neuen Betrag und eine Begründung ein.",
          "Wähle `Korrigieren`.",
        ],
      },
      {
        title: "Lauf freigeben",
        steps: [
          "Wähle `Lauf freigeben`.",
          "Prüfe Zahl und Summe der Rechnungen und wähle `Freigeben`.",
          "Steht im Dialog `Noch offen`, kläre diese Punkte zuerst. Oder du gibst mit `Trotzdem freigeben` frei. Zahlt eine Familie per Lastschrift ohne gültiges Mandat, gib erst frei, wenn das Mandat da ist oder die Familie überweist.",
        ],
      },
      {
        title: "Leeren Lauf verwerfen",
        description:
          "Hat ein offener Lauf nichts abzurechnen, lässt er sich nicht freigeben. Das passiert zum Beispiel, wenn alle Anmeldungen storniert sind. Solange er offen ist, starte für den Ferienzeitraum keinen neuen Lauf. Dann verwirfst du ihn.",
        steps: [
          "Öffne den Lauf. Steht dort `Dieser Lauf hat nichts abzurechnen`, wähle oben `Leeren Lauf verwerfen`.",
          "Wähle im Fenster `Verwerfen`.",
          "Der Lauf steht jetzt als `Verworfen` in der Liste. Er hat nichts ausgestellt. Wann er verworfen wurde, steht unter dem Titel.",
          "Der Ferienzeitraum ist danach frei. Kommen neue Anmeldungen dazu, wähle im verworfenen Lauf `Neuen Lauf starten`.",
        ],
      },
      {
        title: "Bestätigungsschreiben erstellen",
        description:
          "Jede Familie bekommt ein Schreiben im Briefkopf des Trägers. Es bestätigt die Anmeldung und ist zugleich die Rechnung.",
        steps: [
          "Wähle im freigegebenen Lauf bei `Bestätigungsschreiben` den Knopf `Schreiben erstellen`.",
          "Prüfe die `Fälligkeiten`. Sie stehen auf den Rechnungen fest. Nur ältere Rechnungen haben noch das Feld `Zahlen bis`.",
          "Schreibe bei `Hinweise für die Eltern` zum Beispiel die Packliste und was bei Krankheit gilt.",
          "Trage bei `Notfallnummern der Betreuung` pro Betreuung den Namen und die Telefonnummer ein.",
          "Wähle `Vorschau ansehen`. Du siehst das Schreiben der ersten Familie.",
          "Wähle `Schreiben erstellen`.",
          "Das Schreiben einer Familie lädst du über das Menü mit den drei Punkten bei ihrer Rechnung herunter: `Schreiben herunterladen`.",
        ],
      },
      {
        title: "Schreiben einer Rechnung ansehen",
        description:
          "Das geht, sobald die Schreiben erstellt sind. Du siehst genau das Schreiben, das die Familie bekommt.",
        steps: [
          "Öffne den freigegebenen Lauf.",
          "Wähle in der Karte `Rechnungen` eine Zeile. Rechts neben der Liste steht das Schreiben dieser Rechnung als PDF. Über dem Schreiben stehen Nummer, Empfänger und Betrag.",
          "Wähle eine andere Zeile, um deren Schreiben zu sehen.",
          "Mit `Herunterladen` speicherst du genau dieses Schreiben. Mit `In neuem Tab öffnen` siehst du es groß.",
        ],
      },
      {
        title: "Schreiben per Mail senden und drucken",
        description:
          "Jede Familie bekommt ihr Schreiben als PDF im Anhang einer Mail. Hat die Familie ein Konto in der Eltern-App mit derselben Mail-Adresse, liegt es auch dort unter `Dokumente`. Familien ohne E-Mail gibst du das gedruckte Schreiben.",
        steps: [
          "Wähle im freigegebenen Lauf bei `Versand per Mail` den Knopf `An alle senden`. moto fragt vorher nach und schickt nur Mails, die noch nicht gesendet sind.",
          "Neben jeder Familie steht, was aus der Mail geworden ist. `Gesendet` heißt: Die Mail ist raus. `Zugestellt` heißt: Sie ist angekommen. `Nicht angekommen` und `Nicht zustellbar` heißen: Die Mail kam nicht an. `Als unerwünscht gemeldet` heißt: Die Mail kam an. Die Familie hat sie danach als unerwünscht gemeldet.",
          "Bei `Verzögert` kommt die Mail später an. Warte dann. `Erneut senden` steht erst danach wieder bereit. Spätestens bei `Überfällig` kannst du neu senden.",
          "Bei `Nicht gesendet` und `Abgemeldet` zählt, ob die Sperre noch besteht. Besteht sie, fehlt `Erneut senden`, und der Hinweis sagt, was zu tun ist. Drucke das Schreiben dann und gib es der Familie. Ist sie weg, kannst du neu senden.",
          "Wähle bei dieser Familie im Menü mit den drei Punkten `Erneut senden`. Mit `Senden` dort schickst du das Schreiben an eine einzelne Familie.",
          "Wähle `Drucken` und dann `Alle Schreiben drucken`. Du bekommst alle Schreiben des Laufs in einer Datei.",
        ],
      },
      {
        title: "Versand und Exporte einer Rechnung ansehen",
        description:
          "Das geht, sobald der Lauf freigegeben ist. Du siehst, was mit einer Rechnung geschah. Ändern kannst du dort nichts.",
        steps: [
          "Öffne den freigegebenen Lauf.",
          "Wähle bei der Rechnung das Menü mit den drei Punkten.",
          "Wähle `Versand und Exporte ansehen`.",
          "Jeder Schritt steht mit Zeit und Konto da: Ausstellung, Versand, Storno und Lastschrift.",
          "Jede Datei für Kämmerei, Steuerbüro oder Bank steht mit Nummer und Dateiname da.",
        ],
      },
      {
        title: "Rechnung stornieren und neu ausstellen",
        description:
          "Eine ausgestellte Rechnung ändert sich nie. Stimmt sie nicht, storniere sie. Der Storno ist ein eigenes Dokument mit eigener Nummer und eigenem Schreiben.",
        steps: [
          "Öffne den freigegebenen Lauf.",
          "Wähle bei der Rechnung das Menü mit den drei Punkten.",
          "Wähle `Rechnung stornieren`.",
          "Schreibe eine Begründung, zum Beispiel: Anschrift war falsch. Neue Rechnung folgt.",
          "Wähle `Stornieren`.",
          "Wähle im Menü der Rechnung `Aufschlüsselung zeigen` und dann `Neu ausstellen`.",
          "moto öffnet einen Lauf in der Vorschau. Dort steht die Familie mit dem Hinweis `Ersetzt` und der alten Nummer.",
          "Hatte die alte Rechnung Korrekturen, stehen sie bei `Übernommene Korrekturen`. Sie zählen schon in der neuen Rechnung mit. Prüfe jede davon.",
          "Stimmt eine Korrektur nicht mehr, wähle bei ihr das Menü mit den drei Punkten und dann `Ändern` oder `Entfernen`.",
          "Prüfe die Rechnung und wähle `Lauf freigeben`. Die neue Rechnung bekommt eine neue Nummer.",
        ],
      },
      {
        title: "Einen Betrag gutschreiben",
        description:
          "Mit einer Gutschrift wird ein Teil der Rechnung erlassen, zum Beispiel für einen Krankheitstag. Sie ist ein eigenes Dokument mit eigener Nummer und eigenem Schreiben.",
        steps: [
          "Wähle bei der Rechnung das Menü mit den drei Punkten.",
          "Wähle `Gutschrift für …` beim Kind. Oben steht die offene Forderung für das Kind. Das ist der Stand vor Zahlungseingang.",
          "Trage den Betrag und eine Begründung ein.",
          "Wähle `Gutschreiben`.",
        ],
      },
      {
        title: "Übersicht für die Kämmerei herunterladen",
        description: "Das geht, sobald der Lauf freigegeben ist.",
        steps: [
          "Öffne den freigegebenen Lauf.",
          "Wähle oben in der Karte `Rechnungen` das Menü mit den drei Punkten.",
          "Wähle unter `Exportieren` das Format: `PDF`, `Excel` oder `CSV`.",
          "Gib die Datei an die Kämmerei weiter.",
        ],
      },
      {
        title: "Liste für die Erstattung herunterladen",
        description:
          "Das geht, sobald der Lauf freigegeben ist und ein Kostenträger Beiträge übernimmt.",
        steps: [
          "Öffne den freigegebenen Lauf.",
          "Die Karte `Kostenübernahme` zeigt pro Kostenträger die Zahl der Rechnungen und den Betrag.",
          "Wähle in der Zeile des Kostenträgers das Menü mit den drei Punkten.",
          "Wähle unter `Liste für die Erstattung` das Format: `PDF`, `Excel` oder `CSV`.",
          "Schicke die Liste an den Kostenträger. Sie nennt pro Kind die Wochen, den Grundbetrag, die Geschwisterermäßigung, den übernommenen Betrag, ob ein Nachweis vorlag und den Tag der Bestätigung.",
        ],
      },
      {
        title: "Rechnungen und Beträge einer Familie ansehen",
        description:
          "Hier siehst du alle Rechnungen, Stornos und Gutschriften einer Familie über alle Läufe und ihre Debitorennummer. Eine Familie ist eine E-Mail-Adresse. Familien aus der Ferienbetreuung stehen hier schon, wenn ihre Anmeldung mit Debitorennummer bestätigt ist.",
        steps: [
          "Wähle in der Navigation `Familien und Zahlung`. Der Reiter `Familien` ist schon offen.",
          "Die Kacheln zeigen die Summen `Ausgestellt`, `Storniert`, `Gutgeschrieben` und `Offene Forderung`. Sie rechnen mit den Familien, die die Liste gerade zeigt.",
          "Suche die Familie nach Name, E-Mail oder Debitorennummer. Mit dem Filter `Mit offener Forderung` siehst du nur Familien, deren Rechnungen noch Geld verlangen. Ob gezahlt wurde, sieht moto nicht. Mit `Ohne Debitorennummer` siehst du Familien ohne Nummer. Denselben Filter setzt ein Klick auf `ohne Debitorennummer` oben in der Zeile mit den Zahlen.",
          "Unter `Debitorennummer` steht die Nummer der Familie. Steht auf älteren Rechnungen eine andere, siehst du sie darunter. `Nur Ferien` heißt: Die Familie hat keinen Betreuungsvertrag.",
          "Öffne das Drei-Punkte-Menü neben der Nummer. Wähle `Debitorennummer ändern` oder `Debitorennummer eintragen`. Trage die Nummer ein und wähle `Speichern`. Ausgestellte Rechnungen behalten ihre Nummer.",
          "Führt dein Träger die Debitorennummer pro Kind, heißt die Spalte `Nummern der Kinder`. Dort steht jedes Kind mit seiner Nummer. Familien mit Betreuungsvertrag stehen dann schon vor der ersten Rechnung in der Liste. Im Drei-Punkte-Menü wählst du `Nummern der Kinder eintragen` oder `Nummern der Kinder ändern`. Jedes Kind hat ein eigenes Feld. Wähle `Speichern`. Die nächste Monatsrechnung eines Kindes nimmt seine Nummer.",
          "Wähle die Familie. Du siehst ihre Summen, wer zahlt, den Zahlungsweg und jedes Dokument mit Ferienzeitraum, Kindern, Betrag und Stand. Eine Familie ohne Rechnung öffnet sich nicht.",
          "Wähle ein Dokument, um seinen Abrechnungslauf zu öffnen. Dort stornierst du oder schreibst gut.",
        ],
      },
      {
        title: "Listen herunterladen",
        description:
          "Die Liste der Läufe, die Familien und die Dokumente einer Familie lädst du als Datei herunter.",
        steps: [
          "Für die Läufe wählst du `Abrechnungsläufe` und dann den Reiter `Ferien`. Für die Familien wählst du `Familien und Zahlung`. Für die Dokumente einer Familie öffnest du die Familie.",
          "Bei den Läufen und den Familien wählst du oben rechts das Menü mit den drei Punkten, bei den Dokumenten den Knopf `Herunterladen`. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`. Bei den Abrechnungsläufen gilt der gewählte Ferienzeitraum. Bei den Familien enthält die Datei alle Familien, ohne Suche und Filter.",
          "Die Liste der Familien und die Dokumente einer Familie enthalten personenbezogene Daten. Jeder Download wird protokolliert.",
        ],
      },
    ],
    result:
      "Jede Rechnung hat ihre Nummer. Die Nummern sind lückenlos. Ausgestellte Rechnungen und ihre Schreiben lassen sich nicht mehr ändern. Die Übersicht zeigt jede Position pro Familie, die Summe jeder Rechnung und die Gesamtsumme. Storno und Gutschrift stehen dort als eigene Zeilen mit Minusbetrag und der Nummer der Rechnung.",
    notes: [
      "Bezahlt ein Kostenträger, bekommt die Familie eine Rechnung über 0 €. Im Schreiben steht, wer die Kosten übernimmt. Die Übersicht für die Kämmerei nennt unter der Gesamtsumme pro Kostenträger den Betrag, den er übernimmt.",
      "Ferien werden im Voraus abgerechnet. Grundlage ist der Beitrag, den moto beim Bestätigen der Anmeldung festgehalten hat.",
      "Jede Korrektur steht als eigene Position auf der Rechnung. Unter der Rechnung siehst du alle Korrekturen mit Datum und Begründung.",
      "Wird nach dem Start noch eine Anmeldung bestätigt, kommt sie bis zur Freigabe in den Lauf. Nach der Freigabe startest du für sie einen neuen Lauf.",
      "Logo, Farbe, Absender und Fußzeile im Schreiben kommen aus `Briefkopf und Vorlagen`. Die Ansprechperson kommt aus `Allgemein`, die Bankverbindung aus `Abrechnungsvorgaben`. Als Verwendungszweck steht im Schreiben die Debitorennummer der Rechnung. Hat die Rechnung keine, steht dort die Rechnungsnummer. Einen eigenen Zahlungstext schreibst du in den Einstellungen unter `Allgemein` im Bereich `Ferienbetreuung`.",
      "Die Rechnung übernimmt die Debitorennummer der Anmeldung. Hat die Anmeldung keine, nimmt sie die Nummer der Familie aus dem Reiter `Familien`. Führt dein Träger die Nummer pro Kind, bekommt jedes Kind eine eigene Rechnung mit seiner Nummer. Geschwister einer Anmeldung haben dann mehrere Rechnungen. Wurde die Anmeldung vor der Umstellung schon mit einer Rechnung abgerechnet, bleibt es bei einer Rechnung, auch nach einem Storno. Die Nummer steht im Schreiben unter der Rechnungsnummer und in der Übersicht für die Kämmerei in der Spalte `Debitorennummer`.",
      "Storno und Gutschrift bekommen ihre Nummer aus demselben Nummernkreis wie die Rechnungen. In der Aufschlüsselung einer Rechnung steht unter `Verlauf` ihr Storno, ihre Gutschriften und die neue Rechnung.",
      "Sind die Schreiben des Laufs schon erstellt, bekommen Storno und Gutschrift ihr Schreiben sofort. Du sendest es wie die anderen Schreiben unter `Versand per Mail`.",
      "Nach einem Storno lässt sich die Debitorennummer der Anmeldung wieder ändern. Die neue Rechnung übernimmt sie.",
      "Eine übernommene Korrektur senkt den Betrag höchstens auf 0 €. Ist der Beitrag jetzt niedriger als auf der alten Rechnung, steht das bei der Korrektur.",
      "Gutschriften der alten Rechnung werden nicht übernommen. Sie sind eigene Dokumente. Die Vorschau nennt sie nur als Hinweis.",
      "Hat die Familie bei der Anmeldung ihre Anschrift angegeben, steht sie im Schreiben und in der Übersicht für die Kämmerei. Die Rechnung behält sie, auch wenn die Anmeldung später gelöscht wird.",
      "Den Text des Schreibens legst du in den Einstellungen unter `Briefkopf und Vorlagen` fest. Erstellte Schreiben behalten den Text, mit dem sie entstanden sind.",
      "`Offene Forderung` und `Forderung offen` heißen: Die Rechnung ist ausgestellt, nicht storniert und nicht gutgeschrieben. Das ist der Stand vor Zahlungseingang. Zahlungen sieht moto nicht. Eine offene Forderung heißt also nicht, dass die Familie im Rückstand ist. Ob sie gezahlt hat, prüfe in deiner Buchhaltung.",
      "In der Spalte `Zahlung` steht `Familie zahlt selbst`, `Kostenübernahme` mit dem Namen des Kostenträgers oder `Beitragsfrei`, darunter der Zahlungsweg. Eine stornierte Rechnung zählt dabei nicht mit.",
    ],
    differences: [
      "Du siehst in der Navigation kein `Abrechnungsläufe`? Deine Rolle ist nicht Abrechnung. Frage im Träger-Büro nach dieser Rolle.",
      "Im Ferienzeitraum fehlt `Zur Abrechnung`? Der Zeitraum ist noch ein Entwurf, oder deine Rolle ist nicht Abrechnung.",
      "Im Menü des Laufs fehlt `Zum Ferienzeitraum`? Deine Rolle darf die Ferienbetreuung nicht öffnen.",
      "`Lauf freigeben` lässt sich nicht wählen? Es fehlt das Muster der Rechnungsnummern, oder der Lauf hat keine Rechnung.",
      "Statt `Lauf freigeben` steht `Leeren Lauf verwerfen`? Der Lauf hat nichts abzurechnen. Verwirf ihn, dann ist der Ferienzeitraum frei.",
      "Du siehst oben in der Karte `Rechnungen` kein Menü mit den drei Punkten? Der Lauf ist noch nicht freigegeben.",
      "Ein Klick auf eine Rechnung zeigt kein Schreiben? Die Schreiben des Laufs sind noch nicht erstellt. Erstelle sie bei `Bestätigungsschreiben`.",
      "Auf dem Handy oder einem schmalen Bildschirm steht das Schreiben an der Stelle der Liste. Mit `Zurück zu den Rechnungen` kommst du zur Liste.",
      "Statt des Schreibens steht, dass sich die Datei auf diesem Gerät hier nicht zeigen lässt? Wähle `In neuem Tab öffnen` oder `Herunterladen`.",
      "Im Menü fehlt `Versand und Exporte ansehen`? Der Lauf ist noch nicht freigegeben, oder die Zeile ist ein Storno oder eine Gutschrift. Beide stehen bei ihrer Rechnung.",
      "Im Menü einer Rechnung fehlt `Rechnung stornieren`? Die Rechnung hat schon eine Gutschrift oder ist schon storniert. Schreibe dann den Rest gut.",
      "Vor der Freigabe steht, dass Anmeldungen noch keine Debitorennummer haben? Dein Träger fragt die Nummer ab. Diese Anmeldungen wurden ohne Nummer bestätigt, und auch die Familie hat keine. Trage die Nummer in der Anmeldung ein. Freigeben kannst du trotzdem. Nennt dein eigener Zahlungstext die Debitorennummer, lassen sich die Schreiben ohne Nummer aber nicht erstellen.",
      "Vor der Freigabe steht `Schreiben brauchen die Debitorennummer`? Dein eigener Zahlungstext nennt die Debitorennummer, und Rechnungen mit Betrag haben keine. Trage die Nummern vor dem Freigeben in den Anmeldungen ein. Das Feld dafür erscheint, wenn in den Einstellungen unter `Allgemein` im Bereich `Ferienbetreuung` `Debitorennummer beim Bestätigen abfragen` an ist. Freigeben geht trotzdem, der Knopf heißt dann `Trotzdem freigeben`. Die Schreiben lassen sich danach nur ohne den Platzhalter erstellen.",
    ],
    troubleshootingDetails: [
      "Die Freigabe meldet, dass sich der Lauf geändert hat? Seit deiner Prüfung hat sich etwas an den Rechnungen geändert. Zum Beispiel ein Betrag, eine Debitorennummer, die Fälligkeit oder eine neue bestätigte Anmeldung. Das gilt auch, wenn Zahl und Summe gleich bleiben. Prüfe die neue Vorschau und gib dann frei.",
      "Das Verwerfen meldet, dass der Lauf etwas abzurechnen hat? Seit dem Öffnen kam etwas dazu, zum Beispiel eine bestätigte Anmeldung. Prüfe die neue Vorschau und gib den Lauf frei.",
      "Eine bestätigte Anmeldung fehlt in der Vorschau? Sie hat schon eine Rechnung, oder beim Bestätigen wurde kein Beitrag festgehalten.",
      "Die Schreiben lassen sich nicht erstellen, weil eine Bankverbindung fehlt? Die Verwaltung trägt sie unter `Abrechnungsvorgaben` ein. Danach erstellst du die Schreiben.",
      "Die Schreiben lassen sich nicht erstellen, weil Rechnungen keine Debitorennummer haben? Dein eigener Zahlungstext nennt die Debitorennummer. Nach der Freigabe lässt sich die Nummer nicht mehr eintragen. Lösche in den Einstellungen unter `Allgemein` im Bereich `Ferienbetreuung` den eigenen Zahlungstext oder nimm den Platzhalter {Debitorennummer} heraus. Danach erstellst du die Schreiben.",
      "Eine Mail kommt auch nach `Erneut senden` nicht an? Vielleicht stimmt die Adresse nicht. Drucke das Schreiben und gib es der Familie.",
    ],
    related: [
      HELP_TOPICS.traegerHolidayContribution,
      HELP_TOPICS.traegerHolidayRegistrationReview,
      HELP_TOPICS.traegerBillingTerms,
    ],
  };
}
