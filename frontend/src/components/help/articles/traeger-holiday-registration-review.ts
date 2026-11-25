import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/ferien/[id]/anmeldungen` (#4663): Anmeldungen prüfen. */
export function traegerHolidayRegistrationReviewTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerHolidayRegistrationReview,
    title: "Ferienanmeldungen prüfen",
    question:
      "Wie bestätige, ändere, storniere und buche ich Ferienanmeldungen um?",
    summary:
      "Du siehst alle Anmeldungen eines Ferienzeitraums in einer Liste. Dort bestätigst, änderst, stornierst und buchst du um, auch mehrere Anmeldungen auf einmal. Geschwister aus zwei Anmeldungen führst du zusammen.",
    image: "/help/screens/ferienanmeldung-zweite-person-traeger.webp",
    imageAlt:
      "Die zweite sorgeberechtigte Person in der Einzelansicht beim Träger.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "ListChecks",
    requirements: [
      "Deine Rolle im Träger-Büro darf Anmeldungen verwalten. Das gilt für die Rolle Verwaltung.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Liste öffnen und filtern",
        steps: [
          "Wähle in der Navigation `Ferienbetreuung`.",
          "Öffne den Ferienzeitraum.",
          "Wähle den Reiter `Anmeldungen`.",
          "Wähle `Filter` und filtere nach `Status`, `Schule`, `Woche` oder `Zeitmodell`. Unter `Schule` findest du auch `Feriengäste`.",
          "Wähle eine Anmeldung, um sie zu öffnen.",
        ],
      },
      {
        title: "Bestätigen oder stornieren",
        steps: [
          "Die Anmeldung hat vier Reiter: `Übersicht`, `Kind`, `Eltern` und `Nachweise und Beitrag`. Unter `Übersicht` steht der Status.",
          "Prüfe im Reiter `Kind` die Angaben der Kinder. Antworten auf eigene Fragen stehen beim Kind unter `Weitere Angaben`, allgemeine Antworten unter `Allgemeine Angaben`.",
          "Im Reiter `Kind` unter `Hinweise und Einwilligungen` siehst du, was die Eltern bestätigt haben und wann. Dort stehen die damaligen Texte und PDFs.",
          "Widerrufen Eltern eine Einwilligung per Mail, Brief oder Telefon? Wähle unter `Hinweise und Einwilligungen` bei der Einwilligung `Widerruf eintragen`. moto fragt nach. Die OGS, die das Kind in den Ferien betreut, sieht den Widerruf sofort.",
          "Im Reiter `Eltern` stehen unter `Eltern` `Sorgerecht bestätigt`, `Unterschrieben mit Namen` und `Version der Erklärung`. Den genauen Text öffnest du unter `Wortlaut der Erklärung`.",
          "Prüfe im Reiter `Nachweise und Beitrag` unter `Ferienbeitrag`, was die Familie zahlt.",
          "Geben die Eltern an, dass sie Leistungen beziehen? Prüfe den Nachweis. Haben die Eltern ihn hochgeladen, wähle unter `Nachweis für den Leistungsbezug` den Dateinamen. Die Datei öffnet sich in einem neuen Tab.",
          "Bringt die Familie den Nachweis auf Papier, scanne ihn. Wähle unter `Nachweis für den Leistungsbezug` den Knopf `Nachweis hochladen` und dann die Datei. Erlaubt sind PDF, JPEG und PNG bis 10 MB.",
          "Wähle im Reiter `Übersicht` unter `Wer bezahlt den Beitrag?`: `Die Familie bezahlt`, `Von der Zahlung befreien (Leistungsbezug)` oder `Kosten übernimmt ein Kostenträger`. Beim Kostenträger wählst du darunter, welcher bezahlt. Im Reiter `Nachweise und Beitrag` zeigt der `Ferienbeitrag` sofort, was festgehalten wird.",
          "Fragt dein Träger die Debitorennummer ab, steht im Reiter `Übersicht` in der Karte `Status` das Feld `Debitorennummer`. Trage dort die Nummer der Familie bei der Kasse der Gemeinde ein. Ohne Nummer geht `Bestätigen` nicht. Hat dein Träger ein Format festgelegt, steht es unter dem Feld, zum Beispiel `Die Nummer hat 5 Ziffern`.",
          "Kennt moto die Nummer der Familie schon, steht unter dem Feld `Bekannte Nummer dieser Familie`. Prüfe die Nummer und wähle `Übernehmen`. Das Feld füllt sich, bestätigt ist aber noch nichts.",
          "Wähle oben rechts `Bestätigen`. Bist du in einem anderen Reiter, zeigt moto zuerst die `Übersicht`. Wähle dann noch einmal `Bestätigen`. Damit ist der Beitrag festgehalten. moto merkt sich die Debitorennummer bei der Familie. Führt dein Träger die Nummer pro Kind und hat die Anmeldung mehrere Kinder, steht unter `Debitorennummern der Kinder` ein Feld pro Kind. Vorgeschlagen wird die Nummer, die das Kind schon hat. moto merkt sich jede Nummer beim Kind. Später änderst du sie im Menü mit den drei Punkten mit `Nummern der Kinder bearbeiten`.",
          "Weicht die Nummer von der gemerkten ab, fragt moto `Welche Debitorennummer gilt?`. Wähle `Neue Nummer für die Familie merken` oder `Gemerkte Nummer behalten`. Mit deiner Auswahl bestätigst du die Anmeldung. Bei mehreren Familien nennt moto jede Familie und ihre bisherige Nummer. Deine Auswahl gilt für alle genannten Familien.",
          "Zum Stornieren wähle oben rechts das Menü mit den drei Punkten und dann `Stornieren`. Bestätige mit `Anmeldung stornieren`.",
        ],
      },
      {
        title: "Mehrere auf einmal bestätigen",
        description:
          "moto bestätigt nur Anmeldungen, die keine Angabe mehr brauchen. Die Familie bezahlt dann den Beitrag. Bei offenen Anmeldungen prüfst du zuerst den Grund.",
        steps: [
          "Wähle `Filter` und unter `Status` `Eingegangen`.",
          "Setze einen Haken bei jeder Anmeldung. Mit dem Haken in der Kopfzeile wählst du alle aus.",
          "Wähle oben `Ausgewählte bestätigen`.",
          "Das Fenster zeigt unter `Wird bestätigt`, welche Anmeldungen moto bestätigt. Darunter steht, welche offen bleiben und warum.",
          "Wähle zum Beispiel `12 bestätigen`. moto bestätigt eine Anmeldung nach der anderen. Lass die Seite so lange offen. Mit `Anhalten` hörst du nach der laufenden Anmeldung auf.",
          "Am Ende steht, welche Anmeldungen bestätigt sind und welche offen bleiben. Prüfe bei offenen Anmeldungen den Grund und den nächsten Schritt. Schon bestätigte oder stornierte Anmeldungen zählen nicht als offen.",
          "Steht bei einer Anmeldung `Ergebnis unklar`, prüfe dort zuerst den Status. Mit `Fertig` lädt moto die Liste neu, auch bei unklarem Ergebnis.",
        ],
      },
      {
        title: "Debitorennummer nachtragen oder ändern",
        description:
          "Das geht bei einer bestätigten Anmeldung, bis der Abrechnungslauf ihre Rechnung ausgestellt hat.",
        steps: [
          "Öffne die bestätigte Anmeldung.",
          "Wähle oben rechts das Menü mit den drei Punkten. Wähle `Debitorennummer eintragen` oder `Debitorennummer bearbeiten`.",
          "Das Feld `Debitorennummer` öffnet sich im Reiter `Übersicht` in der Karte `Status`. Trage die Nummer ein und wähle `Speichern`.",
          "Weicht die Nummer von der gemerkten Nummer der Familie ab, wähle im Dialog, welche gilt, und dann `Speichern`.",
          "Hat die Familie die Nummer von genau dieser Anmeldung, ändert moto beide ohne Nachfrage. So berichtigst du einen Tippfehler. Hat die Anmeldung die gemerkte Nummer nur übernommen, fragt moto nach.",
        ],
      },
      {
        title: "Angaben ändern",
        description:
          "Zum Beispiel eine neue Telefonnummer oder ein falsch geschriebener Name.",
        steps: [
          "Wähle bei der Karte `Bearbeiten`: im Reiter `Eltern` bei `Eltern`, im Reiter `Kind` beim Kind, bei `Notfallkontakte und Abholung` oder bei `Allgemeine Angaben`.",
          "Ändere die Angaben. Es gelten dieselben Regeln wie im Formular der Eltern. Fragt das Formular nach der Anschrift, änderst du sie bei `Eltern`.",
          "Wähle `Änderung speichern`.",
        ],
      },
      {
        title: "Geschwister zusammenführen",
        description:
          "Eltern melden Geschwister manchmal in zwei Anmeldungen an. Führst du die Anmeldungen zusammen, zählen die Kinder beim Ferienbeitrag zusammen. moto führt nie von selbst zusammen.",
        steps: [
          "In der Spalte `Geschwister` steht ein Hinweis wie `Vielleicht Geschwister: gleiche E-Mail` oder `Vielleicht Geschwister: gleicher Nachname`. Der Hinweis ändert nichts.",
          "Prüfe, ob die Kinder wirklich Geschwister sind.",
          "Setze in der Liste einen Haken bei jeder Anmeldung der Familie. Die Leiste über der Liste zeigt, wie viele ausgewählt sind.",
          "Wähle `Als Geschwister zusammenführen`.",
          "In der Spalte `Geschwister` steht jetzt `Geschwister` mit den Nummern der anderen Anmeldungen.",
        ],
      },
      {
        title: "Geschwister trennen",
        steps: [
          "Öffne die Anmeldung.",
          "Wähle im Reiter `Übersicht` in der Karte `Geschwister` den Knopf `Trennen`.",
          "Bestätige mit `Trennen`.",
        ],
      },
      {
        title: "Umbuchen",
        steps: [
          "Wähle im Reiter `Kind` beim Kind `Umbuchen`.",
          "Wähle pro Woche ein Zeitmodell oder `Nicht angemeldet`. Gibt es eine Woche an mehreren Schulen, wähle auch die Schule.",
          "Wird die Woche tageweise gebucht, wähle darunter die Tage. Mehr Tage als `Höchstzahl an Tagen pro Kind` nimmt moto nicht an.",
          "Bietet die Woche Mittagessen an, steht darunter `Mit Mittagessen`. Setze oder entferne den Haken.",
          "Wähle `Speichern`.",
          "Eine Woche, die das Kind nicht mehr bucht, gibt ihren Platz frei. Das nächste Kind der Warteliste rückt sofort nach. Eine neue Woche bekommt einen Platz, wenn einer frei ist. Sonst kommt das Kind dort auf die Warteliste.",
          "Kommt bei einer Woche mit einzelnen Tagen ein Tag dazu, braucht das Kind an jedem Tag einen Platz. Fehlt einer, wartet die ganze Woche wieder. Fallen nur Tage weg, behält das Kind seinen Platz.",
        ],
      },
      {
        title: "Einfrieren und wieder öffnen",
        steps: [
          "Nach dem Anmeldeschluss ist jede Anmeldung von selbst eingefroren.",
          "Willst du eine Anmeldung vorher festhalten? Wähle oben rechts das Menü mit den drei Punkten und dann `Einfrieren`.",
          "Willst du eine eingefrorene Anmeldung ändern? Wähle im selben Menü `Wieder öffnen`.",
        ],
      },
      {
        title: "Exportieren",
        steps: [
          "Stelle die Filter ein, zum Beispiel eine Schule.",
          "Öffne oben rechts das Drei-Punkte-Menü. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`.",
          "Die PDF ist zum Ausdrucken. Sie enthält Kind, Woche, Zeitmodell, Mittagessen und Telefon. Adresse, E-Mail und die Antworten im Formular stehen nur in Excel und CSV.",
        ],
      },
      {
        title: "Anmeldungen als PDF aufbewahren",
        steps: [
          "Über der Liste steht, wann moto die Anmeldungen löscht.",
          "Öffne oben rechts das Drei-Punkte-Menü. Wähle unter `Herunterladen` `Alle als PDF (ZIP)`. Du bekommst eine ZIP-Datei mit einem PDF pro Anmeldung.",
          "Hast du Filter eingestellt? Dann heißt der Eintrag `Gefilterte als PDF (ZIP)`. Die ZIP-Datei enthält nur die gefilterten Anmeldungen.",
          "Für eine einzelne Anmeldung öffnest du die Anmeldung. Wähle oben rechts das Menü mit den drei Punkten und unter `Herunterladen` den Eintrag `PDF`.",
          "Speichere die Dateien bei deinem Träger. Für diese Kopien bist du selbst verantwortlich.",
        ],
      },
    ],
    result:
      "Unter `Verlauf` steht bei jeder Anmeldung, wann sie bestätigt, geändert, storniert, umgebucht, eingefroren oder wieder geöffnet wurde. Auch jede Debitorennummer steht dort, mit der Nummer vorher und nachher. Bei einer Änderung der Angaben steht dort, welche Angaben sich geändert haben, aber nicht die Werte. Auch jedes Zusammenführen und Trennen von Geschwistern steht dort. Storniert jemand eine Anmeldung der Geschwister, steht bei allen `Aus Geschwistergruppe gelöst (storniert)`.",
    notes: [
      "Eltern mit Elternkonto widerrufen Einwilligungen selbst unter `Ferienanmeldungen`. Du siehst dann `Von den Eltern widerrufen` mit Datum. Wieder geben können die Einwilligung nur die Eltern.",
      "Berücksichtigt der Ferienzeitraum den Ferienwunsch, filterst du auch nach `Ferienwunsch`. Beim Kind steht dann `Mit Ferienwunsch`, `Ohne Ferienwunsch` oder `Ferienwunsch prüfen`.",
      "Offen bleibt eine Anmeldung, wenn ein Platz noch offen ist, die Eltern Leistungsbezug angeben, ein Kind vielleicht doppelt angemeldet ist oder die Debitorennummer fehlt. Eine Anmeldung von Geschwistern übernimmt die Debitorennummer der Geschwister.",
      "Beim Bestätigen bekommen die Eltern eine E-Mail mit den Kindern, Wochen und Zeitmodellen. Darin steht auch dein `Text der Annahme-Mail` aus dem Ferienzeitraum. Jede Anmeldung bekommt diese E-Mail nur einmal.",
      "Beim Stornieren bekommen Eltern keine Nachricht von moto. Rückt ein Kind von der Warteliste nach, bekommen seine Eltern eine E-Mail.",
      "Vergibt der Ferienzeitraum die Plätze nach Kriterien? Dann steht bei einer Woche zuerst `Platz offen`. Bestätigen geht erst, wenn dein Büro im Reiter `Vergabe` entschieden hat. Unter `Angaben für die Vergabe` siehst du die Antworten der Eltern und prüfst sie mit `Prüfen`.",
      "Bei jeder Woche eines Kindes steht `Platz` oder `Warteliste`. Auf der Warteliste steht der Rang dabei, zum Beispiel `Warteliste, Platz 2`. Stornierst du eine Anmeldung, rückt das nächste Kind der Warteliste sofort nach.",
      "Eine eingefrorene Anmeldung kannst du bestätigen. Stornieren und Umbuchen gehen erst nach `Wieder öffnen`.",
      "Änderst du das Mittagessen einer bestätigten Anmeldung, berechnet moto den Beitrag neu. Ist die Rechnung schon verschickt, berechne den Unterschied als Korrektur in der Abrechnung.",
      "Der Export hat eine Zeile pro Kind und Woche. Gesundheitsangaben stehen nicht darin. Antworten auf eigene Fragen ohne Gesundheitsangabe haben eigene Spalten.",
      "Gesundheitsangaben sieht in der Einzelansicht nur die Rolle Verwaltung. Jedes Öffnen steht im `Zugriffsprotokoll` des Trägers.",
      "Eine `Zweite sorgeberechtigte Person` steht in der Einzelansicht, nicht in der Liste. Im Export stehen Name und Telefon.",
      "Fragt das Formular die Anschrift ab, steht sie in der Einzelansicht bei `Eltern` und im Export. In der Liste und bei der ausrichtenden OGS steht sie nicht.",
      "Ein hochgeladener `Nachweis für den Leistungsbezug` steht nur in der Einzelansicht. Er steht nicht in der Liste, nicht im Export und nicht bei der ausrichtenden OGS. Er wird mit der Anmeldung gelöscht.",
      "Jedes Öffnen einer Anmeldung oder eines Nachweises steht im `Zugriffsprotokoll` des Trägers. Auch jeder Export und jedes PDF steht dort, und jeder Abgleich der Kinder mit den Kindern deiner Schulen.",
      "Das PDF enthält alle Angaben der Eltern, die gebuchten Wochen, den Status und die Erklärung der Eltern mit dem genauen Text, Namen und Zeitpunkt. Nachweise und der Verlauf stehen nicht darin.",
      "Gesundheitsangaben stehen nur im PDF, wenn du `PDF mit Gesundheitsangaben` wählst. Diesen Eintrag sieht nur die Rolle Verwaltung. Nach 92 Tagen sind die Gesundheitsangaben gelöscht. Dann enthält auch das PDF keine mehr.",
      "Ein festgehaltener Beitrag ändert sich nicht mehr. Auch nicht, wenn du später Preise oder Regeln änderst oder umbuchst. Nur wenn ein Kind von der Warteliste nachrückt, rechnet moto den Beitrag mit der neuen Woche neu.",
      "Die Debitorennummer steht im Bestätigungsschreiben als Verwendungszweck. Im Export steht sie in der Spalte `Debitorennummer`. In der Liste steht sie nur, wenn dein Träger sie abfragt.",
      "Eine Änderung der Angaben ändert den Ferienbeitrag nicht. Ein schon erstelltes Schreiben an die Familie bleibt, wie es ist. Auch eine schon ausgestellte Rechnung behält die bisherige Anschrift.",
      "Kinder hinzufügen oder entfernen geht nicht. Auch Wochen, Leistungsbezug, Nachweise, Einwilligungen, die Erklärung der Eltern und Gesundheitsangaben änderst du hier nicht. Die Wochen änderst du mit `Umbuchen`, die Debitorennummer unter `Status`.",
      "Die ausrichtende OGS sieht einen geänderten Namen sofort in ihrer Teilnehmerliste. Bei einem Feriengast steht der neue Name spätestens nach einer Stunde auch in der Gruppe.",
      "Bei Geschwistern ist das Kind mit dem höchsten Beitrag das 1. Kind. Dein Träger kann in den Einstellungen unter `Allgemein` auch das älteste Kind wählen. Bei gleichem Rang zählt die früher eingegangene Anmeldung zuerst.",
      "Zusammenführen und Trennen rechnen auch einen schon bestätigten Beitrag neu. Der alte Beitrag bleibt gespeichert. Ein offener Abrechnungslauf zeigt den neuen Betrag.",
      "Stornierst du eine Anmeldung der Geschwister, gehört sie nicht mehr dazu. moto rechnet den Beitrag der anderen Geschwister sofort neu. Du musst nichts trennen.",
      "Gibt es für ein Geschwister-Kind schon eine Rechnung, bleibt die Rechnung, wie sie ist. moto rechnet den Beitrag trotzdem neu. Unter `Ferienbeitrag` steht dann `Rechnung prüfen`. Storniere die Rechnung. Der nächste Abrechnungslauf stellt dann den neuen Betrag aus.",
      "Jede Anmeldung bekommt weiter ihre eigene Rechnung und ihr eigenes Schreiben. Ein Schreiben nennt nie die Kinder oder Eltern der anderen Anmeldung.",
      "Alle bestätigten Anmeldungen der Geschwister bekommen dieselbe Debitorennummer. Beim Bestätigen steht die Nummer der Geschwister schon im Feld.",
      "Eine Familie ist die E-Mail-Adresse der Eltern, die anmelden. Groß- und Kleinschreibung zählt nicht. Die gemerkte Nummer bleibt, auch wenn die Anmeldung gelöscht ist. Du siehst und änderst sie unter `Abrechnung` im Reiter `Familien`. Ein anderer Träger und die Schulen sehen sie nicht.",
      "moto merkt sich nur eine Nummer. Bestätigst du ohne Nummer, merkt sich moto nichts zur Familie.",
      "moto löscht die gemerkte Nummer einer Familie ohne Betreuungsvertrag drei Jahre nach dem Ende des Jahres, in dem sie zuletzt gebraucht wurde. Das gilt auch, wenn ein alter Betreuungsvertrag der Familie gelöscht wird. Solange es noch Rechnungen der Familie gibt, bleibt sie. Gibt es einen Löschstopp für Ferienrechnungen, bleibt sie auch.",
    ],
    differences: [
      "Bei einer Anmeldung steht `Mail prüfen`? Eine Mail zu dieser Anmeldung hat die Eltern nicht erreicht. Oder die Eltern haben sie als unerwünscht gemeldet. In der Anmeldung steht oben, welche Mail und was du tun kannst. Mit `Zu den Eltern` kommst du zu Telefon und E-Mail-Adresse. Im Reiter `Eltern` unter `Mails an die Eltern` siehst du jede Mail mit ihrem Stand. Rufe die Familie am besten an. Kam eine Mail nicht an, prüfe die E-Mail-Adresse unter `Eltern`. Ist sie falsch, ändere sie. Eine stornierte Anmeldung kannst du nicht mehr ändern. Kann moto eine Mail gerade nicht senden, versucht moto es bis zu knapp drei Tage weiter. Erst danach steht dort `Mail prüfen`.",
      "In der Liste steht beim Kind `Bekannt an` mit einer Schule? Diese Schule deines Trägers führt ein Kind mit gleichem Namen und Geburtsdatum. Die Eltern haben es aber als Feriengast oder an einer anderen Schule angemeldet. In der Anmeldung steht dazu ein Hinweis beim Kind. Prüfe die Schule und wähle dort `Schule ändern`. moto verknüpft nichts von selbst und zeigt keine Daten der Schule.",
      "Beim Kind steht `An der Schule bekannt`? Die Schule aus der Anmeldung führt ein Kind mit gleichem Namen und Geburtsdatum. Du musst nichts tun.",
      "Auf dem Handy fehlt der Haken für alle Anmeldungen? Setze die Haken dort einzeln.",
      "Ein Kind ist als `Mögliche Doppelanmeldung` markiert? Ein Kind mit gleichem Namen und Geburtsdatum steht auch in einer anderen Anmeldung. Öffne beide und storniere die doppelte.",
      "Beim Bestätigen fehlt `Kosten übernimmt ein Kostenträger`? Dein Träger hat noch keinen aktiven Kostenträger. Die Abrechnung legt ihn in den Einstellungen unter `Abrechnungsvorgaben` an.",
      "Beim Bestätigen gibt es kein Feld `Debitorennummer`? Dein Träger fragt sie nicht ab. Das legst du in den Einstellungen unter `Allgemein` im Bereich `Ferienbetreuung` fest.",
    ],
    troubleshootingDetails: [
      "Eine Änderung führt zu zu vielen Tagen pro Kind? Prüfe die Anmeldungen vor dem Speichern. Bei gleicher Eltern-E-Mail, gleichem Namen und Geburtsdatum zählen die Tage zusammen. Das gilt auch, wenn du diese Angaben änderst.",
      "`Umbuchen` fehlt? Die Anmeldung ist eingefroren oder storniert. Eine eingefrorene Anmeldung öffnest du mit `Wieder öffnen`.",
      "Eine stornierte Anmeldung lässt sich nicht wieder öffnen. Die Eltern melden das Kind dann neu an.",
      "Eine gemeinsame Rechnung bleibt auch nach dem Wechsel zu `Kind` gemeinsam. Nach dem Storno änderst du ihre Nummer mit `Debitorennummer bearbeiten`. Rechnungen pro Kind nennen die Nummer des Kindes.",
      "Die Debitorennummer lässt sich nicht mehr ändern? Für die Anmeldung gibt es schon eine Rechnung. Die Rechnung behält die Nummer, mit der sie ausgestellt wurde.",
      "`Bearbeiten` fehlt? Die Anmeldung ist storniert. Dann lassen sich die Angaben nicht mehr ändern.",
      "`Trennen` fehlt oder Zusammenführen geht nicht? Für eine Anmeldung der Geschwister gibt es schon eine Rechnung. Geschwister kannst du dann nicht mehr ändern.",
      "Eine stornierte Anmeldung kannst du nicht zusammenführen. Beim Stornieren löst moto sie schon aus den Geschwistern.",
    ],
    related: [
      HELP_TOPICS.traegerHolidayRegistration,
      HELP_TOPICS.traegerHolidayPeriod,
      HELP_TOPICS.traegerHolidayPlaces,
      HELP_TOPICS.traegerHolidayAllocation,
      HELP_TOPICS.traegerHolidayContribution,
      HELP_TOPICS.traegerHolidayWish,
    ],
  };
}
