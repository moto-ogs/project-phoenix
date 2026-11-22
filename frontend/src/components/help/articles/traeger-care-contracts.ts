import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/vertraege` (#4678, #4679, #4680, #4681): festlegen, wann der
 * Vertrag gilt, Vertragsbedingungen je Angebot festlegen, Entwürfe aus
 * angenommenen Anmeldungen erstellen, prüfen und senden; die Unterschrift
 * der Eltern und den Papiervertrag erfassen; Versionen nach einer Änderung;
 * Kündigung und Widerruf (#4682); Änderungswünsche der Eltern freigeben (#5979);
 * Kinder und bestehende Verträge aus einer Datei importieren (#4723), auch
 * ohne Mail-Adresse der Eltern (#7360), und ihre Vertragsangaben aus den
 * Originalunterlagen nachpflegen (#7767).
 */
export function traegerCareContractsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerCareContracts,
    title: "Betreuungsverträge erstellen und senden",
    question: "Wie schicke ich den Eltern den Betreuungsvertrag?",
    summary:
      "Aus jeder angenommenen Anmeldung entsteht ein Vertrag mit den gebuchten Modulen je Wochentag. Entweder gilt er gleich bei der Annahme, oder du prüfst den Entwurf und sendest ihn per Mail und in die Eltern-App. Die Eltern unterschreiben ihn dann online oder auf Papier.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "Signature",
    requirements: [
      "Du hast die Rolle `Verwaltung`. Sie gibt das Recht `Verträge verwalten`.",
      "Die Schule hat die Anmeldung angenommen, und das Kind hat Betreuung gebucht.",
    ],
    instructionGroups: [
      {
        title: "Einmal: Festlegen, wann der Vertrag gilt",
        steps: [
          "Wähle in der Navigation `Einstellungen` → `Allgemein`.",
          "Wähle den Reiter `Anmeldung`.",
          "Wähle bei `Wann gilt der Betreuungsvertrag?` eine Möglichkeit. `Bei der Annahme`: Nimmt die Schule eine Anmeldung an, gilt der Vertrag sofort. `Später verschicken`: Du erstellst den Vertrag und schickst ihn den Eltern.",
          "Eine Schule kann in ihren eigenen Einstellungen etwas anderes wählen. Was für welche Schule gilt, siehst du unter `Verträge` in der Karte `Wann gilt der Vertrag?`.",
        ],
      },
      {
        title: "Einmal: Vertragsbedingungen festlegen",
        steps: [
          "Wähle in der Navigation `Verträge`.",
          "Wähle oben den Reiter `Vertragsbedingungen`.",
          "Wähle links ein Angebot. `Fehlt` heißt: Für dieses Angebot gibt es noch keine Bedingungen. Auf dem Handy öffnen sich die Bedingungen über der Liste.",
          "Wähle die `Laufzeit`, die `Frist in Monaten` und wann die `Kündigung wirkt`.",
          "Erlaube bei Bedarf eine `Sonderkündigung`. Sie endet immer zum Halbjahr, also am 31. Januar oder 31. Juli. Es gilt dieselbe `Frist in Monaten`. Schreibe bei `In welchen Fällen?`, wann sie möglich ist. Ein anderes Datum in diesem Text ändert den Termin nicht. Ausnahmen klärst du wie bisher im Büro. Vertrag und Text für das Anmeldeformular nennen den Termin.",
          "Müssen die Eltern eine Satzung anerkennen? Setze den Haken bei `Satzung`. Trage den Namen und, wenn vorhanden, den Link ein.",
          "Trage den Namen des `Vertragspartners` ein, wenn er nicht im Briefkopf steht.",
          "Wähle `Bedingungen speichern`.",
          "Unter `Widerrufsbelehrung für das Anmeldeformular` und `Häkchen „Betreuung vor Ende der Widerrufsfrist“` stehen zwei weitere Texte. Die Schule kopiert beide als eigene Rechtstexte ins Anmeldeformular. Die Belehrung muss bestätigt werden, das Häkchen nicht.",
          "Die Widerrufsbelehrung ist das gesetzliche Muster. Sie gilt in jedem Bundesland gleich. Dieselbe Belehrung steht im Vertrag, auf der Seite zum Unterschreiben und in der Bestätigung per Mail. Die Anschrift kommt aus deinem Briefkopf, Telefon und E-Mail aus `Allgemein` › `Kontakt` › `Kontakt für Widerrufe`. Der Text für das Anmeldeformular und das PDF enthalten auch das Muster-Widerrufsformular.",
          "Für `Bei der Annahme`: Trage den `Vertragspartner` immer ein. Speichere die Bedingungen. Kopiere den Text aus `Gespeicherter Text für das Anmeldeformular` unverändert. Die Schule wählt im Anmeldeformular `Eigene Zustimmung hinzufügen`. Sie trägt ihn unter `Rechtstext / Erklärung` ein. Sie setzt `Muss bestätigt werden` und behält bestehende Rechtstexte bei. Bei mehreren Modulen müssen deren Bedingungen übereinstimmen.",
        ],
      },
      {
        title: "Bei der Annahme: nichts zu tun",
        steps: [
          "Im Anmeldeformular stimmen die Eltern dem vollständigen gespeicherten Bedingungstext zu. Die eigene Zustimmung muss bestätigt werden. Ein allgemeiner Verweis auf Bedingungen reicht nicht. Die Schule nimmt die Anmeldung an.",
          "Nach wenigen Minuten steht der Vertrag in der Liste. Sein Status ist `Aktiv`.",
          "Die Eltern bekommen das PDF per Mail und in der Eltern-App. Du musst nichts unterschreiben.",
          "Auf der Vertragsseite steht unter `Abgeschlossen`, wann der Vertrag gilt. Die Karte `Unterschrift` zeigt ebenfalls `Abgeschlossen`. Eine weitere Unterschrift ist nicht nötig.",
        ],
      },
      {
        title: "Später verschicken: Entwürfe erstellen",
        steps: [
          "Wähle den Reiter `Verträge`.",
          "Wähle `Verträge erstellen`. Die Zahl dahinter nennt die Kinder ohne Vertrag. Kann ein Kind noch keinen Entwurf bekommen, steht im Fenster der Grund.",
          "Prüfe die Liste. moto übernimmt Kind, Eltern, Beginn und je Wochentag die gebuchten Module mit ihrer Endzeit, zum Beispiel `Mo bis 14:00 · Di bis 16:30`.",
          "Wähle die Kinder aus. Ein Vertrag umfasst alle Module eines Kindes. Fehlen bei einem Modul die Bedingungen, oder weichen sie zwischen den Modulen ab, lege sie zuerst fest.",
          "Wähle `Entwürfe erstellen`.",
        ],
      },
      {
        title: "Prüfen und senden",
        steps: [
          "Wähle in der Liste ein Kind. Die Seite zeigt die `Vertragsangaben` und die `Vorschau` des PDF.",
          "Prüfe unter `Gebuchte Betreuung` jeden Wochentag: das Modul und bis wann das Kind betreut wird. Tage ohne Betreuung stehen als `Keine Betreuung` da.",
          "Prüfe Beginn und Beitrag.",
          "Wähle `Vertrag senden`. moto fragt noch einmal und nennt die Mail-Adresse. Bestätige mit `Vertrag senden`.",
          "Mehrere Entwürfe auf einmal: Setze in der Liste die Haken. Unten erscheint eine Leiste. Wähle dort zum Beispiel `3 Entwürfe senden`. Gesendet werden nur die gewählten Entwürfe.",
        ],
      },
      {
        title: "Unterschrift der Eltern",
        description:
          "Die Eltern unterschreiben in der Eltern-App oder über den Link in der Mail. Sie zeichnen mit dem Finger oder tippen ihren Namen.",
        steps: [
          "Öffne den Vertrag und den Reiter `Unterschrift und Versand`. Die Karte `Unterschrift` zeigt `Wartet auf Eltern` oder `Unterschrieben`.",
          "Nach der Unterschrift ist der Vertrag `Aktiv`. Die Karte zeigt, wer wann auf welchem Weg unterschrieben hat, die Widerrufsfrist und die gespeicherte Unterschrift.",
          "Die Eltern bekommen eine Bestätigung mit dem Vertrag und der Widerrufsbelehrung per Mail.",
        ],
      },
      {
        title: "Papiervertrag erfassen",
        description:
          "Für Familien ohne Internet oder einen Vertrag, den es nur auf Papier gibt.",
        steps: [
          "Wähle oben `PDF herunterladen` und drucke den Vertrag.",
          "Die Eltern unterschreiben ihn. Scanne den unterschriebenen Vertrag als PDF.",
          "Wähle auf der Vertragsseite im Reiter `Unterschrift und Versand` in der Karte `Unterschrift` den Knopf `Papiervertrag erfassen`.",
          "Prüfe `Unterschrieben von` und `Unterschrieben am`. Wähle mit `PDF wählen` die Datei.",
          "Wähle `Vertrag abschließen`. Der Vertrag ist dann `Aktiv`. Mit `Papiervertrag laden` holst du das PDF später wieder.",
        ],
      },
      {
        title: "Verträge herunterladen",
        description: "Zum Ablegen, für eine Tabelle oder ein anderes Programm.",
        steps: [
          "Wähle in der Navigation `Verträge`.",
          "Wähle bei Bedarf einen Status, einen Betreuungsort oder suche.",
          "Wähle oben rechts das Menü mit den drei Punkten. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`.",
          "Die Datei enthält alle Verträge zu deiner Auswahl. Jeder Download steht im Zugriffsprotokoll der Schulen.",
        ],
      },
      {
        title: "Kinder und bestehende Verträge importieren",
        description:
          "Hast du Kinder und Verträge schon in einem anderen Programm, zum Beispiel OGS Connect? Dann übernimmst du alle auf einmal aus einer CSV-Datei. Jeder Vertrag gilt sofort als abgeschlossen. Die Eltern bekommen keine Mail. moto bewahrt die Datei nicht auf.",
        steps: [
          "Trage zuerst die `Vertragsbedingungen` für jedes Modul ein. Ohne Bedingungen übernimmt moto keinen Vertrag für das Modul.",
          "Speichere die Kinder im anderen Programm als CSV-Datei. Die erste Zeile enthält die Überschriften, jede weitere Zeile ein Kind.",
          "Wähle in der Navigation `Verträge`. Wähle oben rechts das Menü mit den drei Punkten und dann `Verträge importieren`.",
          "Du kennst den Aufbau noch nicht? Wähle `Beispieldatei`. Sie zeigt alle Spalten, die moto von selbst erkennt.",
          "Ziehe die Datei in das Feld oder wähle `Datei wählen`.",
          "Prüfe unter `Spalten zuordnen`, aus welcher Spalte jedes Feld kommt. Pflicht sind Vorname und Nachname des Kindes.",
          "Hat deine Datei keine Spalte für die Schule, das Modul oder den Vertragsbeginn? Dann wählst du `Schule für alle Zeilen`, `Modul für alle Zeilen` und `Vertragsbeginn für alle Zeilen`.",
          "Nennt eine Zeile keine Eltern? moto übernimmt den Vertrag trotzdem. Er hat dann keinen Vertragspartner.",
          "Steht eine Zeile auf `Bereit` und nennt die Eltern, aber keine Mail-Adresse? moto übernimmt den Vertrag trotzdem. Die Vorschau zählt diese Verträge. Unter `Ohne Mail` siehst du nur diese Zeilen. Die Familien bekommen keine Mail von moto und haben keinen Zugang zur Eltern-App. Rechnungen gibt es für sie nur auf Papier. Geschwister bleiben getrennte Familien. Hast du die Adressen? Dann trage sie in die Datei ein. Lade die Datei danach noch einmal.",
          "Steht die `Debitorennummer` in der Datei? Ordne die Spalte zu. moto trägt die Nummer beim Zahler oder beim Kind ein, je nach deiner Einstellung. Fehlt die `E-Mail der Eltern`, gehört die Nummer zu diesem einen Vertrag. Geschwister erkennt moto nur über dieselbe E-Mail.",
          "Zählt deine Geschwisterregel alle Kinder der Familie? Ordne die Spalte `Kinder in der Familie` zu. Die Zahl gilt dann als bestätigt ab Vertragsbeginn. Das Feld siehst du nur mit dem Recht `Abrechnung`. Ohne das Recht trägt die Abrechnung die Zahlen später unter `Kinderzahl` nach.",
          "Prüfe die Zeilen unter `Prüfen und übernehmen`. `Bereit` übernimmt moto. `Schon vorhanden` heißt: Das Kind hat an der Schule schon einen Vertrag. Bei `Fehlerhaft` steht der Grund in der Spalte `Hinweis`.",
          "Wähle unten `übernehmen`. Die Verträge stehen danach in der Liste mit dem Status `Aktiv`.",
          "Fehler in der Datei? Korrigiere die Datei und lade sie noch einmal. moto legt kein Kind doppelt an.",
        ],
      },
      {
        title: "Module importierter Verträge neu zuordnen",
        description:
          "Hast du deine Module nach dem Import neu geordnet? Dann buchen die importierten Verträge noch die alten Module. Mit einer CSV-Datei ordnest du die Buchungen den neuen Modulen zu. Jeder geänderte Vertrag bekommt eine neue Version. Wochentage und Endzeiten bleiben. Die Eltern bekommen keine Nachricht.",
        steps: [
          "Wähle in der Navigation `Verträge`. Wähle oben rechts das Menü mit den drei Punkten und dann `Module neu zuordnen`.",
          "Du kennst den Aufbau noch nicht? Wähle `Beispieldatei`. Die Datei hat die Spalten `Vertrag`, `Wochentag`, `Bisheriges_Modul` und `Neues_Modul`.",
          "Schreibe je Vertrag, Wochentag und bisherigem Modul eine Zeile. Bei `Vertrag` steht die Vertragsnummer aus moto. Bei `Wochentag` geht zum Beispiel `Mo`, `Mo-Fr` oder `Montag`.",
          "Weißt du das neue Modul noch nicht? Lass `Neues_Modul` leer. moto stellt den ganzen Vertrag dann zurück und ändert ihn nicht.",
          "Wähle bei `Gilt ab` den Tag, ab dem die neuen Module gelten. Vorgeschlagen ist der Erste des nächsten Monats. Frühestens geht heute.",
          "Ziehe die Datei in das Feld oder wähle `Datei wählen`.",
          "Prüfe die Verträge unter `Prüfen und ändern`. Bei `Änderung` steht links das bisherige und rechts das neue Modul. `Wird geändert` ändert moto. `Schon zugeordnet` bucht schon die neuen Module. `Zurückgestellt` wartet auf deine Entscheidung. Bei `Nicht möglich` steht der Grund mit der Zeile der Datei in der Spalte `Hinweis`.",
          "Änderst du `Gilt ab`, prüft moto die Datei sofort neu.",
          "Wähle unten den grünen Knopf, zum Beispiel `12 Verträge ändern`. moto fragt vorher nach. Bestätige im Fenster noch einmal.",
          "Beim Vertrag steht die neue Version im Reiter `Versionen` mit `Module neu zugeordnet`. Frühere Versionen bleiben lesbar.",
        ],
      },
      {
        title: "Vertragsangaben importierter Verträge nachpflegen",
        description:
          "Der Import kennt nur einen Vertragspartner, den Abschluss auf Papier und ein Abschlussdatum. Aus den Originalunterlagen ergänzt du weitere Vertragsparteien, die Abschlussart und das Abschlussdatum. Es entsteht kein neuer Vertrag. Die Eltern bekommen keine Mail.",
        steps: [
          "Wähle in der Navigation `Verträge`. Wähle oben rechts das Menü mit den drei Punkten und dann `Vertragsangaben nachpflegen`.",
          "Wähle bei `1. Liste herunterladen` den Knopf `Liste herunterladen`. Die Liste enthält jeden importierten Vertrag mit seinen Angaben in moto.",
          "Ergänze die Liste. `Vertragsparteien`: Namen als „Nachname, Vorname“, getrennt mit „ | “. Ein weiterer Name kommt dazu. Schreibst du einen Namen anders, ändert moto die Schreibweise. Vor- oder Nachname muss dabei gleich bleiben. Ändere je Liste nur einen Namen pro Vertrag. Keine Partei fällt weg. Mail-Adresse und Elternkonto bleiben.",
          "`Abschlussart`: „online“ oder „papier“. `Abschlussdatum`: ein Datum wie 12.03.2026, oder „unbekannt“, wenn du den Tag nicht belegen kannst.",
          "Trage bei `Beleg` in jeder geänderten Zeile ein, woher die Angabe stammt, zum Beispiel den Namen der PDF mit dem Vertrag. Eine leere Zelle ändert nichts. `Vertrag-ID` und `Kind` änderst du nicht.",
          "Speichere die Liste als CSV-Datei. Ziehe sie bei `2. Ausgefüllte Liste hochladen` in das Feld oder wähle `Datei wählen`.",
          "Prüfe die Vorschau. Je Zeile steht der alte Wert durchgestrichen und daneben der neue. `Wird geändert` ändert moto. `Bereits aktuell` bleibt, wie es ist. Bei `Fehler` steht der Grund in der Spalte, zu der er gehört.",
          "Wähle unten zum Beispiel `3 Verträge ändern`. moto fragt noch einmal. Bestätige.",
          "Auf der Vertragsseite steht danach die Karte `Nachgepflegte Angaben` mit dem Tag, dem Beleg und der Änderung. Lädst du dieselbe Liste noch einmal hoch, ändert sich nichts.",
        ],
      },
      {
        title: "Änderungswunsch der Eltern freigeben",
        steps: [
          "Die Eltern beantragen in der Eltern-App andere Tage oder Module. Du oder die Schule entscheidet.",
          "Wähle in der Liste das Kind. Im Reiter `Unterschrift und Versand` steht die Karte `Änderungswunsch der Eltern`. Wartet ein Wunsch, zeigt der Reiter eine Zahl.",
          "Je Modul siehst du die bisherige und die gewünschte Buchung. Bei festen Tagen steht dort `Gebucht (feste Tage)`.",
          "Module, die gleich bleiben, stehen darunter bei `Bleibt gebucht`.",
          "Wähle `Freigeben`. Prüfe `Gilt ab` und die angezeigten Änderungen. Wähle noch einmal `Freigeben`.",
          "Oder wähle `Ablehnen`. Schreibe eine Begründung für die Eltern und wähle `Ablehnen`.",
          "Die Eltern bekommen eine Nachricht in der Eltern-App.",
        ],
      },
      {
        title: "Wenn sich die Betreuung ändert: neue Version",
        steps: [
          "Nach einer Freigabe durch dich oder die Schule bekommt der aktive Vertrag nach wenigen Minuten eine neue Version. Sie gilt ab dem freigegebenen Tag.",
          "Wähle in der Liste das Kind. Oben steht, ab wann die neue Version gilt.",
          "Im Reiter `Versionen` siehst du jede Version mit ihren Tagen. `Geändert` markiert die Wochentage, die anders sind als vorher.",
          "Mit `PDF` lädst du eine Version als PDF.",
        ],
      },
      {
        title: "Kündigung oder Widerruf eintragen",
        steps: [
          "Eltern kündigen selbst in der Eltern-App. Dann steht die Kündigung von allein beim Vertrag. Du musst nichts tun.",
          "Kam eine Kündigung per Mail oder Brief? Wähle in der Liste das Kind.",
          "Im Reiter `Kündigung` steht die Karte `Vertrag beenden`. Sie zeigt den Kündigungstermin und die Absendefrist für einen Widerruf.",
          "Wähle `Kündigung eintragen`.",
          "Wähle bei `Eingegangen am` den Tag, an dem die Mail oder der Brief ankam.",
          "Die Auswahl gilt für diesen Eingangstag, auch bei älteren Erklärungen. Wähle `Kündigung` oder `Widerruf`. Bei einer Kündigung wählst du den Termin oder `Außerordentlich, aus wichtigem Grund` und trägst den Grund der Eltern ein.",
          "Bei einem Widerruf: Trage bei `Abgesendet am` den Absende-Tag ein. Ein rechtzeitig abgesendeter Brief darf später ankommen.",
          "Wähle `Kündigung eintragen` oder `Widerruf eintragen`.",
        ],
      },
    ],
    steps: [],
    result:
      "Die Eltern bekommen den Vertrag als PDF per Mail. Haben sie ein Konto in der Eltern-App, liegt er dort auch unter `Dokumente`. Wer dort `Neues Dokument vom Träger` eingeschaltet hat, bekommt dazu eine Nachricht aufs Handy. Gilt der Vertrag bei der Annahme, ist sein Status `Aktiv`. Sonst wird er `Versendet`: Der Versand ist beauftragt. Ob die Mail gesendet wurde, siehst du unter `Versand`.",
    notes: [
      "Ein importierter Vertrag beginnt frühestens mit dem Schuljahr seines Moduls. Er endet auch mit diesem Schuljahr, wenn das Modul ein Ende hat und die Datei kein früheres nennt. Lief der Vertrag schon vorher, steht der frühere Tag unter `Abgeschlossen`. Der Vertrag ist mit keinem Kind aus den `Kinderdaten` der Schule verknüpft: moto gleicht Kinder nicht über den Namen ab. Im Reiter `Versionen` steht bei ihm `Aus einer Datei importiert`.",
      "Die Suche und die Filter gelten für alle Verträge. Mit `Weitere Verträge laden` zeigst du ältere Treffer an.",
      "Beim ersten Senden hält moto das PDF fest. Änderst du danach Bedingungen oder Brieftext, bleibt der versendete Vertrag gleich.",
      "Im Reiter `Unterschrift und Versand` siehst du in der Karte `Versand`, ob die Mail gesendet wurde. Mit `Versand aktualisieren` prüfst du den neuen Stand. Mit `Erneut senden` geht dasselbe PDF noch einmal an die Eltern; moto fragt vorher. Bei einem aktiven Vertrag steht `Erneut senden` im Menü mit den drei Punkten oben rechts. Eine zweite Nachricht aufs Handy gibt es dabei nicht. Nur eine korrigierte Mail-Adresse bekommt eine eigene Nachricht.",
      "Neben jedem Versand steht, was aus der Mail geworden ist: wie bei der Abrechnung. Der Hinweis oben nennt den Grund und den nächsten Schritt. Bei `Verzögert` wartest du. Hat die Schule die Mails gestoppt, kläre das mit der Schule. Bei `Gesperrt` klärt das der moto-Support. Solange das gilt, ist `Erneut senden` aus.",
      "Den Brieftext des Vertrags änderst du unter `Einstellungen` → `Briefkopf und Vorlagen` bei der Vorlage `Vertrag`.",
      "Mit `PDF herunterladen` bekommst du den Vertrag zum Drucken, etwa für Familien ohne Mail.",
      "Wartet ein versendeter Vertrag auf die Unterschrift, bekommen die Eltern Erinnerungen per Mail. Es gibt höchstens drei. Bereits abgeschlossene Verträge bekommen keine Erinnerung. Nach wie vielen Tagen, lege unter `Einstellungen` → `Allgemein` im Bereich `Betreuungsverträge` fest. Bei 0 gibt es keine Erinnerung.",
      "Der Link in der Mail gilt einmal und 30 Tage. Jede Erinnerung bringt einen neuen Link.",
      "Frühere Versionen bleiben unter `Versionen` lesbar. `Gilt jetzt` zeigt die Version von heute. Die Abrechnung nimmt für jeden Tag die Version, die an diesem Tag gilt.",
      "Bei einer außerordentlichen Kündigung steht in `Vertrag beenden` der Grund der Eltern und `Ende noch offen`. Prüfe den Grund. Bis zu deiner Entscheidung gilt der Vertrag weiter.",
      "Erkennst du den Grund an? Wähle `Vertragsende festlegen` und den letzten Tag.",
      "Erkennst du den Grund nicht an? Wähle `Grund nicht anerkennen`. Dann gilt die Kündigung als ordentliche Kündigung. Der Vertrag endet zum nächsten möglichen Termin, gezählt ab dem Eingang. Das Datum steht unter dem Knopf und im Fenster, bevor du bestätigst.",
      "Beide Entscheidungen lassen sich danach nicht mehr ändern. Die Eltern bekommen eine Mitteilung mit dem letzten Betreuungstag per Mail und in der Eltern-App. Die Texte legst du unter `Einstellungen` → `Allgemein` im Reiter `Betreuungsverträge` fest: `Mitteilung: Vertragsende festgelegt` und `Mitteilung: Grund nicht anerkannt`. Die Mitteilung steht danach in der Karte `Vertrag beenden`, so wie sie verschickt wurde.",
      "Nach einer Kündigung hat der Vertrag den Status `Gekündigt`. Er gilt bis zum Vertragsende und wird bis dahin abgerechnet. Nach einem Widerruf ist er `Widerrufen` und gilt an keinem Tag.",
      "Die Eltern bekommen sofort eine Bestätigung per Mail und in der Eltern-App. Den Text legst du unter `Einstellungen` → `Allgemein` im Reiter `Betreuungsverträge` fest. Die Bestätigung steht danach in der Karte `Vertrag beenden`, so wie sie verschickt wurde.",
      "Ein früher kopierter Text für das Anmeldeformular gilt weiter, solange die Bedingungen gleich bleiben. Nur der neue Text nennt den Termin der Sonderkündigung. Kopiere ihn beim nächsten Anmeldeformular neu.",
      "Den Kündigungstermin rechnet moto aus den Bedingungen im Vertrag, nicht aus den heutigen Vertragsbedingungen. Die Widerrufsfrist beginnt frühestens mit dem Erhalt der Belehrung. Ohne Nachweis gilt die längere Frist.",
      "Endet die Widerrufsfrist an einem Samstag, Sonntag oder Feiertag, endet sie erst am nächsten Werktag. moto nimmt die Feiertage aus dem Bundesland der Schule. Feiertage, die nur in einer Stadt oder Gemeinde gelten, kennt moto nicht. Hat deine Gemeinde einen eigenen Feiertag, prüfe die Frist an diesem Tag selbst.",
      "Eine neue Version gilt nie rückwirkend. Kommt eine Freigabe zu spät, gilt die Version ab dem Tag, an dem moto sie anlegt.",
      "Beginnt an einem Tag schon eine Version, und du oder die Schule gibt für denselben Tag eine weitere Änderung frei, ersetzt moto diese Version. Die neue Version enthält beide Änderungen. Die alte steht unter `Versionen` als `Ersetzt` und gilt an keinem Tag.",
      "Ist schon eine spätere Version geplant, gilt eine frühere Änderung nur bis dahin. Die geplante Version übernimmt sie nicht von selbst.",
    ],
    differences: [
      "Du siehst `Verträge` nicht in der Navigation? Dir fehlt das Recht `Verträge verwalten`. Wende dich an eine Person mit der Rolle `Leitung`.",
    ],
    troubleshootingDetails: [
      "Beim Import steht `Für das Modul fehlen die Vertragsbedingungen`? Trage unter `Vertragsbedingungen` Laufzeit und Frist für das Modul ein. Wähle danach im Import `Erneut prüfen` oder lade die Datei noch einmal.",
      "Beim Import steht `Dieses Modul gibt es an der Schule nicht`? Der Name in der Datei muss so heißen wie das Angebot der Schule. Ändere den Namen in der Datei, oder wähle `Modul für alle Zeilen`.",
      "Beim Import steht `„Kinder in der Familie“ ist keine ganze Zahl von 1 bis 20`? moto übernimmt die Zeile nicht. Korrigiere die Zahl in der Datei und lade die Datei noch einmal.",
      "Beim Neuzuordnen der Module steht `Der Vertrag kommt aus einer Anmeldung`? Ändern lassen sich nur importierte Verträge. Die Module eines Vertrags aus einer Anmeldung folgen den Buchungen der Schule. Die Schule ändert dort die Buchung.",
      "Beim Neuzuordnen der Module steht `Der Vertrag ändert sich schon später`? Für den Vertrag ist schon eine neue Version geplant. Wähle bei `Gilt ab` einen Tag ab dieser Version.",
      "Ein importierter Vertrag ist falsch? Einen übernommenen Vertrag kannst du nicht löschen und nicht noch einmal importieren. Fehlen nur Vertragsparteien, die Abschlussart oder das Abschlussdatum, ergänze sie unter `Vertragsangaben nachpflegen`. Sonst trage für ihn eine Kündigung ein. Prüfe die Vorschau deshalb, bevor du übernimmst.",
      "Beim Nachpflegen steht `Dieser Vertrag kommt nicht aus einem Import`? Nachpflegen geht nur für importierte Verträge. Die Angaben der anderen Verträge stammen aus moto.",
      "Beim Nachpflegen steht `moto erkennt nicht sicher, welcher Name zu welcher vorhandenen Vertragspartei gehört`? Du hast in einer Zeile einen Namen geändert und zugleich einen ergänzt, oder zwei Namen geändert. Ändere erst einen Namen und lade die Liste hoch. Lade danach die Liste neu herunter und ergänze den nächsten. Ist es eine andere Person? Dann lass den alten Namen stehen und ergänze den neuen.",
      "Beim Nachpflegen steht `Eine Vertragspartei fehlt`? Die Zeile nennt weniger Namen als der Vertrag hat. Nimm alle Namen aus der heruntergeladenen Liste und ergänze nur neue.",
      "In `Vertrag beenden` steht `Die Mitteilung zum Vertragsende ging nicht raus`? Der Hinweis nennt den Grund: Der Vertrag ist mit keinem Kind aus den `Kinderdaten` der Schule verknüpft. Oder keine Adresse des Vertrags gehört noch einer Bezugsperson, die für das Kind handeln darf. Bei älteren Entscheidungen kennt moto den Grund nicht. Die Entscheidung gilt trotzdem. Schicke den Eltern die Mitteilung per Brief. Sie steht darunter als `Mitteilung zum Vertragsende (nicht verschickt)`.",
      "`Vertragsende festlegen` oder `Grund nicht anerkennen` meldet, dass kein Ende mehr offen ist? Eine andere Person hat schon entschieden. Lade die Seite neu. Die Entscheidung steht in `Vertrag beenden`.",
      "Bei einem Änderungswunsch fehlt `Freigeben`? Die Eltern melden damit die ganze Betreuung ab. Das ist eine Kündigung. Trage sie unter `Vertrag beenden` ein, oder lehne den Wunsch ab.",
      "Nach der Freigabe bleiben Regeltermine oder Abholzeiten unverändert? Gib die angezeigten Hinweise an die Schule weiter. Die Schule muss sie prüfen.",
      "Die Karte `Änderungswunsch der Eltern` fehlt? Sie steht nur bei aktiven Verträgen.",
      "`Kündigung eintragen` fehlt? Der Vertrag ist noch nicht abgeschlossen oder schon beendet. Einen Entwurf oder versendeten Vertrag verwirfst du oder lässt ihn liegen.",
      "Ein Brief kam nach der Widerrufsfrist an? Entscheidend ist der Absende-Tag. Trage ihn bei `Abgesendet am` ein.",
      "Die Schule hat angenommen, aber nach einigen Minuten steht kein aktiver Vertrag da? Dann fehlt etwas. Das Kind steht in `Verträge erstellen` mit dem Grund, zum Beispiel `Vertragsbedingungen fehlen`. Fehlt die E-Mail-Adresse der Eltern, ergänzt die Schule sie in der Anmeldung. moto versucht es danach von selbst noch einmal.",
      "Ein Kind zeigt `Mail-Adresse gesperrt`? Mails an die Adresse der Eltern kamen nicht an. Die Schule prüft die Adresse beim Kind unter `Erziehungsberechtigte` und wählt `Sperre aufheben`. Danach entsteht der Vertrag von selbst.",
      "Ein Kind zeigt `Mails gestoppt`? Die Schule hat die Mails an diese Eltern gestoppt. Der Vertrag kommt erst, wenn die Schule beim Kind unter `Erziehungsberechtigte` `Mails wieder senden` wählt.",
      "Ein Kind zeigt `Zustimmung zum Vertrag fehlt` oder `Zustimmung passt nicht zum Vertrag`? Die Eltern haben den aktuellen Vertragsbedingungen nicht zugestimmt. Bei der zweiten Meldung haben sie anderen Bedingungen zugestimmt. Dann entsteht kein aktiver Vertrag. Stelle die Schule auf `Später verschicken` und schicke den Vertrag. Eine frühere Anmeldung wird nicht nachträglich verbindlich.",
      "Ein Kind zeigt `Zustimmung zur neuen Phase fehlt`? Das Kind wurde für einen neuen Zeitraum wieder angemeldet. Eine frühere Zustimmung gilt dafür nicht. Die Eltern stimmen den Bedingungen auf der Statusseite ihrer Anmeldung zu. Das zählt nur, bevor die Schule annimmt. Danach stellst du die Schule auf `Später verschicken` und schickst den Vertrag.",
      "Nach Änderungen an den Bedingungen: Speichere diese zuerst. Ersetze danach den Text im Anmeldeformular durch den neuen gespeicherten Text. Unverändertes Speichern lässt eine passende Zustimmung weiter gelten.",
      "Schulen mit `Bei der Annahme` erlauben keine manuellen Entwürfe. Bereits vorhandene Entwürfe werden nicht automatisch abgeschlossen. Prüfe und verwirf diese bei Bedarf.",
      "Ein Kind fehlt in `Verträge erstellen`? Die Schule hat die Anmeldung noch nicht angenommen, oder das Kind hat schon einen Vertrag.",
      "Ein Kind zeigt `Bedingungen der Module weichen ab`? Das Kind hat mehrere Module gebucht, und deren Vertragsbedingungen sind verschieden. Ein Vertrag hat eine Laufzeit und eine Frist. Gleiche die Bedingungen der Module an.",
      "Eine Endzeit fehlt? Das Modul hat für diesen Tag keine Gehzeit. Die Schule trägt sie beim Angebot ein.",
      "Ein Entwurf ist falsch? Wähle auf seiner Seite oben `Entwurf verwerfen`. Danach erstellst du ihn neu. Einen versendeten Vertrag kannst du nicht verwerfen.",
      "Der Versand zeigt `Nicht angekommen`? Prüfe die Adresse mit der Schule. Trage auf der Vertragsseite im Reiter `Unterschrift und Versand` unter `Versand` die `Neue Versandadresse` ein. Wähle `An diese Adresse senden`. Das geht auch bei aktiven Verträgen. Das PDF, der Abschluss, die Vertragspartei und bisherige Versanddaten bleiben gleich. Spätere Wiederholungen nutzen die letzte Versandadresse.",
      "Der Name des Vertragspartners fehlt? Ergänze den Briefkopf. Oder verwirf den Entwurf und erstelle ihn mit eingetragenem Vertragspartner neu.",
      "Die Eltern sagen, der Link gilt nicht mehr? Er war schon benutzt oder ist abgelaufen. Wähle `Erneut senden`. Die Eltern bekommen einen neuen Link. Oder sie unterschreiben in der Eltern-App unter `Dokumente`.",
      "Die Karte `Unterschrift` meldet, die Prüfsumme stimmt nicht? Der gespeicherte Nachweis wurde verändert. Melde das dem moto-Team.",
      "Eine Änderung ist freigegeben, aber es gibt keine neue Version? Neue Versionen bekommen nur aktive Verträge. Bucht das Kind ab dem Tag gar keine Betreuung mehr, ist das eine Kündigung und keine neue Version.",
    ],
    related: [
      HELP_TOPICS.traegerDocumentTemplates,
      HELP_TOPICS.traegerBriefkopf,
      HELP_TOPICS.traegerAccounts,
    ],
  };
}
