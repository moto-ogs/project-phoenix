import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/vertraege` (#4678, #4679, #4680, #4681): festlegen, wann der
 * Vertrag gilt, Vertragsbedingungen je Angebot festlegen, Entwürfe aus
 * angenommenen Anmeldungen erstellen, prüfen und senden; die Unterschrift
 * der Eltern, die Übergabe auf Papier (#8030) und den Papiervertrag
 * erfassen; Versionen nach einer Änderung;
 * Kündigung und Widerruf (#4682); Änderungswünsche der Eltern freigeben (#5979);
 * Kinder und bestehende Verträge aus einer Datei importieren (#4723), auch
 * ohne Mail-Adresse der Eltern (#7360), ihre Vertragsangaben aus den
 * Originalunterlagen nachpflegen (#7767), importierte Verträge mit der
 * Kinderakte verknüpfen und ihre Anmeldungen nachtragen (#7760) und
 * Geschwister ohne Mail-Adresse zu einer Familie zusammenführen (#7161).
 */
export function traegerCareContractsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerCareContracts,
    title: "Betreuungsverträge erstellen und senden",
    question: "Wie schicke ich den Eltern den Betreuungsvertrag?",
    summary:
      "Aus jeder angenommenen Anmeldung entsteht ein Vertrag mit den gebuchten Modulen pro Wochentag. Entweder gilt er gleich bei der Annahme, oder du prüfst den Entwurf und sendest ihn per Mail und in die Eltern-App. Die Eltern unterschreiben ihn dann online oder auf Papier.",
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
          "Die Widerrufsbelehrung ist das gesetzliche Muster. Sie gilt in jedem Bundesland gleich. Dieselbe Belehrung steht im Vertrag, auf der Seite zum Unterschreiben und in der Bestätigung per Mail. Name und Anschrift kommen aus deinem Briefkopf, nicht von der Ansprechperson. Telefon und E-Mail kommen aus `Allgemein` › `Kontakt` › `Kontakt für Widerrufe`. Der Text für das Anmeldeformular und das PDF enthalten auch das Muster-Widerrufsformular.",
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
          "Prüfe die Liste. moto übernimmt Kind, Eltern, Beginn und pro Wochentag die gebuchten Module mit ihrer Endzeit, zum Beispiel `Mo bis 14:00 · Di bis 16:30`.",
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
        title: "Auf Papier übergeben und erfassen",
        description:
          "Für Familien ohne Internet oder einen Vertrag, den es nur auf Papier gibt.",
        steps: [
          "Öffne den Entwurf und den Reiter `Unterschrift und Versand`. Wähle in der Karte `Unterschrift` den Knopf `Auf Papier übergeben`.",
          "Bestätige mit `Übergeben und PDF laden`. moto speichert den Vertrag so, wie er jetzt ist, und lädt das PDF herunter. Ein neuer Briefkopf ändert dieses PDF nicht mehr. Kam kein PDF an? Dann hol es oben im Menü mit `PDF herunterladen`.",
          "Der Vertrag ist dann `Versendet`. Die Eltern bekommen keine Mail und keine Erinnerung.",
          "Drucke das PDF und gib es den Eltern. Sie unterschreiben es. Scanne den unterschriebenen Vertrag als PDF.",
          "Wähle in der Karte `Unterschrift` den Knopf `Papiervertrag erfassen`.",
          "Prüfe `Unterschrieben von` und `Unterschrieben am`. Wähle mit `PDF wählen` die Datei.",
          "Wähle `Vertrag abschließen`. Der Vertrag ist dann `Aktiv`. Mit `Papiervertrag laden` holst du das PDF später wieder.",
          "Ging der Vertrag schon per Mail? Dann drucke ihn mit `PDF herunterladen` und erfasse ihn wie oben.",
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
          "Steht eine Zeile auf `Bereit` und nennt die Eltern, aber keine Mail-Adresse? moto übernimmt den Vertrag trotzdem. Die Vorschau zählt diese Verträge. Unter `Ohne Mail` siehst du nur diese Zeilen. Die Familien bekommen keine Mail von moto und haben keinen Zugang zur Eltern-App. Rechnungen gibt es für sie nur auf Papier. Geschwister sind zuerst getrennte Familien. Du führst sie danach unter `Geschwister zusammenführen` zusammen. Hast du die Adressen? Dann trage sie in die Datei ein. Lade die Datei danach noch einmal.",
          "Steht die `Debitorennummer` in der Datei? Ordne die Spalte zu. moto trägt die Nummer beim Zahler oder beim Kind ein, je nach deiner Einstellung. Fehlt die `E-Mail der Eltern`, gehört die Nummer zu diesem einen Vertrag. Geschwister erkennt moto von selbst nur über dieselbe E-Mail.",
          "Zählt deine Geschwisterregel alle Kinder der Familie? Ordne die Spalte `Kinder in der Familie` zu. Die Zahl gilt dann als bestätigt ab Vertragsbeginn. Das Feld siehst du nur mit dem Recht `Abrechnung`. Ohne das Recht trägt die Abrechnung die Zahlen später unter `Kinderzahl` nach.",
          "Prüfe die Zeilen unter `Prüfen und übernehmen`. `Bereit` übernimmt moto. `Schon vorhanden` heißt: Das Kind hat an der Schule schon einen Vertrag. Bei `Fehlerhaft` steht der Grund in der Spalte `Hinweis`.",
          "Wähle unten `übernehmen`. Die Verträge stehen danach in der Liste mit dem Status `Aktiv`.",
          "Fehler in der Datei? Korrigiere die Datei und lade sie noch einmal. moto legt kein Kind doppelt an.",
          "Hat die Datei keine Mail-Adressen? Dann führe Geschwister zuerst zusammen, siehe nächster Abschnitt. Sonst zahlt jedes Kind den Preis des ersten Kindes.",
          "Danach verknüpfst du die Verträge mit der Kinderakte. Wie das geht, steht weiter unten.",
        ],
      },
      {
        title: "Geschwister ohne Mail-Adresse zusammenführen",
        description:
          "Ohne Mail-Adresse kennt moto jeden Vertrag nur einzeln. Jeder ist eine eigene Familie. Dann gilt kein Geschwisterpreis, und ein Mandat für zwei Geschwister zeigt der Mandatsimport als Konflikt. Hier legst du fest, welche Kinder Geschwister sind. moto führt nichts von selbst zusammen. Das darf, wer das Recht `Verträge verwalten` oder `Abrechnung` hat.",
        steps: [
          "Wähle in der Navigation `Verträge`. Wähle oben rechts das Menü mit den drei Punkten und dann `Geschwister zusammenführen`. Nach einem Import führt dich auch `Geschwister zusammenführen` dorthin.",
          "Die Liste zeigt jede Familie ohne Mail-Adresse, nach Nachnamen. Geschwister mit demselben Nachnamen stehen untereinander. Mit der Suche findest du Kind, Eltern oder Vertragsnummer.",
          "Kreuze die Familien an, die zusammengehören. Unten erscheint eine Leiste. Wähle dort `Zusammenführen`.",
          "Wähle im Fenster, welcher Vertrag die Familie führt. Von ihm kommen Debitorennummer, Zahlungsweg und SEPA-Mandat der Familie. Eine Debitorennummer pro Kind bleibt beim Kind.",
          "Wähle `Zusammenführen`. Die Spalte `Familie` zeigt jetzt zum Beispiel `2 Kinder zusammen`. Im nächsten Monatslauf zählen die Kinder als Geschwister.",
          "Kommt danach der Mandatsimport, gilt ein Mandat mit derselben Referenz für beide Kinder.",
          "Falsch zusammengeführt? Wähle bei der Familie das Menü mit den drei Punkten und dann zum Beispiel `Mila Schulz lösen`. Bestätige mit `Lösen`. Danach gilt für das Kind wieder, was bei seinem Vertrag gespeichert war.",
          "Unter `Verlauf` siehst du, wer wann welche Kinder zusammengeführt oder gelöst hat.",
          "Die Liste als Datei? Wähle oben rechts das Menü mit den drei Punkten und dann PDF, Excel oder CSV.",
          "Ausgestellte Rechnungen ändern sich nicht. Das Zusammenführen gilt für Monatsläufe, die danach rechnen.",
        ],
      },
      {
        title: "Importierte Verträge mit der Kinderakte verknüpfen",
        description:
          "Ein importierter Vertrag kennt sein Kind zuerst nur über den Namen. Erst mit der Kinderakte weiß moto, welches Kind der Schule er meint. Das braucht der Soll-Ist-Vergleich, die genaue Zuordnung des Essens und das Elternpostfach für Rechnungen. Es verknüpfen nur die Nummern von Vertrag und Kinderakte. Name und Geburtsdatum vergleicht moto nur. Eltern bekommen keine Nachricht, und es startet kein Rechnungslauf.",
        steps: [
          "Stimmt bei einem Vertrag das Angebot nicht? Korrigiere das zuerst. Verknüpfe danach.",
          "Die Vertragsnummer steht auf der Seite des Vertrags unter `Vertragsangaben`, im Feld `Vertrag Nr.` Alle Nummern auf einmal bekommst du in der Vertragsliste im Menü unter `Herunterladen`: Die Datei hat die Spalten `Vertrag Nr.` und `Kinderakte`.",
          "Die Nummer der Kinderakte steht im OGS-Portal der Schule. Öffne dort `Datenverwaltung` › `Kinderdaten` und das Kind. Die Zahl am Ende der Adresse ist die Nummer, zum Beispiel …/students/123. Hast du keinen Zugang, frag die Schule.",
          "Lege eine CSV-Datei an: eine Zeile pro Vertrag, eine Spalte `Vertrag Nr.` und eine Spalte `Kinderakte`, wie im Export. Mit `Beispieldatei` bekommst du den Aufbau.",
          "Wähle in der Navigation `Verträge`. Wähle oben rechts das Menü mit den drei Punkten und dann `Mit Kinderakten verknüpfen`. Nach einem Import führt dich auch `Mit Kinderakten verknüpfen` dorthin.",
          "Ziehe die Datei in das Feld oder wähle `Datei wählen`. Erkennt moto die Spalten nicht, wählst du sie unter `Spalten zuordnen`.",
          "Prüfe die Zeilen unter `Prüfen und verknüpfen`. `Bereit` verknüpft moto. `Schon verknüpft` ist schon erledigt. `Unklar` und `Nicht möglich` bleiben, wie sie sind. Den Grund nennt die Spalte `Hinweis`.",
          "`Unklar` heißt zum Beispiel: Name oder Geburtsdatum in der Kinderakte sind anders als im Vertrag. Oder die Datei nennt einen Vertrag oder ein Kind zweimal. Oder das Kind hat in derselben Zeit schon einen anderen Vertrag an der Schule.",
          "`Nicht möglich` heißt: Eine Nummer fehlt, ist keine Zahl, oder moto kennt sie nicht. Auch ein Vertrag aus einer Anmeldung steht hier. Er gehört schon zu seinem Kind und braucht keine Verknüpfung.",
          "Wähle unten zum Beispiel `12 Verträge verknüpfen`.",
          "Danach zeigt moto, wie viele Verträge verknüpft sind und welche Zeilen offen bleiben. Mit `Offene Zeilen herunterladen` bekommst du sie als Arbeitsliste.",
          "Lädst du dieselbe Datei noch einmal, steht jede verknüpfte Zeile auf `Schon verknüpft`. Es passiert nichts doppelt.",
        ],
      },
      {
        title: "Einen Vertrag einzeln verknüpfen oder die Verknüpfung lösen",
        steps: [
          "Öffne den Vertrag. Unter `Vertragsangaben` steht bei `Kinderakte`, ob er verknüpft ist.",
          "Wähle `Mit Kinderakte verknüpfen`, unter `Kinderakte` oder im Menü mit den drei Punkten oben rechts.",
          "Gib die `Nummer der Kinderakte` ein und wähle `Prüfen`. moto zeigt nebeneinander, was im Vertrag und was in der Kinderakte steht.",
          "Passt alles, wähle `Verknüpfen`.",
          "Weichen Name oder Geburtsdatum ab, markiert moto das mit `Weicht ab`. Ist es sicher dasselbe Kind, wähle `Trotzdem verknüpfen`. Nur das geht hier, und nur einzeln.",
          "Falsch verknüpft? Wähle im Menü mit den drei Punkten `Verknüpfung lösen` und bestätige. Sonst ändert sich nichts. Schon ausgestellte Rechnungen bleiben, wie sie sind.",
          "Steht unter `Anmeldung` schon `Anmeldung nachgetragen`, fehlt `Verknüpfung lösen`. Löse dann zuerst die Bindung an die Anmeldung, siehe unten.",
        ],
      },
      {
        title: "Anmeldungen für importierte Verträge nachtragen",
        description:
          "Ein importierter Vertrag hat an der Schule noch keine Anmeldung. moto legt sie aus dem Vertrag an, schon genehmigt, und bindet den Vertrag daran. Die Kinder stehen dann in den Gruppenlisten. Eltern bekommen keine Mail und keine Einladung, die Kinderakte bleibt, wie sie ist. Die Reihenfolge: falls nötig `Module neu zuordnen`, dann `Mit Kinderakten verknüpfen`, dann `Anmeldungen nachtragen`.",
        steps: [
          "Wähle in der Navigation `Verträge`. Wähle oben rechts das Menü mit den drei Punkten und dann `Anmeldungen nachtragen`.",
          "Hat dein Träger mehrere Schulen, wähle unter `Schule wählen` die Schule. moto trägt pro Schule nach.",
          "Prüfe unter `Vorschau prüfen` jede Zeile. Bei `Vertrag` steht das Kind, wie der Vertrag es nennt, bei `Kinderakte` das Kind der Schule. Steht dort `Name weicht ab`, prüfe zuerst die Verknüpfung.",
          "Bei `Betreuung` stehen Modul, Wochentage mit Endzeit und Zeitraum. So bucht die Anmeldung das Kind.",
          "`Bereit` trägt moto nach. Hat das Kind schon eine passende Anmeldung, bindet moto den Vertrag nur daran. `Erledigt` ist schon gebunden. Bei `Zurückgestellt` und `Hängt` steht in der Spalte `Hinweis`, was fehlt und wer es klärt. `Ohne Kinderakte` verknüpfst du zuerst.",
          "Wähle unten zum Beispiel `Für 12 Verträge nachtragen`. moto fragt vorher nach. Bestätige mit `Jetzt nachtragen`.",
          "Danach zeigt moto, wie viele Anmeldungen nachgetragen und wie viele Verträge nur gebunden sind. Die offenen Zeilen bleiben als Arbeitsliste stehen.",
          "Mit `Neue Vorschau` holst du den neuen Stand. Erledigtes steht dann auf `Erledigt`. Es entsteht nichts doppelt.",
          "Danach sind die Eltern dran. Das macht die Schule in ihrer Kinderliste mit `Eltern einladen`. Eltern ohne Konto bekommen die Einladung ins Elternportal. Mit `Eltern mit Konto benachrichtigen` bekommen Eltern mit Konto eine kurze Nachricht, für Kinder, die heute Betreuung gebucht haben. Jedes Elternteil bekommt sie pro Kind nur einmal.",
        ],
      },
      {
        title: "Warum ein Vertrag offen bleibt",
        description:
          "Für eine offene Zeile schreibt moto nichts. Ist der Grund geklärt, nimmt die nächste Vorschau sie mit.",
        ordered: false,
        steps: [
          "Am Vertrag zu berichtigen: Ein Modul gibt es nicht mehr, die Module liegen in zwei Anmeldephasen, Wochentage oder Endzeit passen nicht zum Modul, oder der Vertrag ist nicht aktiv.",
          "Mit der Schule zu klären: Das Kind hat schon eine andere Anmeldung, das Modul ist ausgeschaltet, die Kinderakte ist nicht mehr aktiv, ihr fehlt der Betreuungsplatz oder das Geburtsdatum, oder die Betreuung endet dort früher.",
          "Kommt von selbst: Der Vertrag oder die Anmeldephase hat noch nicht begonnen, oder eine geplante Änderung gilt noch nicht.",
          "`Hängt` heißt: Ein früherer Lauf hat die Anmeldung schon angelegt, aber der Vertrag passt nicht mehr dazu. Berichtige den Vertrag, oder die Schule berichtigt die Buchungen der Anmeldung. Dann bindet der nächste Lauf. Hast du die Module des Vertrags auf eine andere Anmeldephase umgestellt, ordne sie zurück auf ein Modul der Phase dieser Anmeldung. Die Anmeldung an der Schule zu beenden hilft nicht.",
        ],
      },
      {
        title: "Bindung an die Anmeldung lösen",
        description:
          "Ein gebundener Vertrag folgt den Buchungen seiner Anmeldung. Ändert die Schule eine Buchung, bekommt er eine neue Version. Auf der Vertragsseite steht unter `Anmeldung` dann `Anmeldung nachgetragen`.",
        steps: [
          "Öffne den Vertrag. Wähle im Menü mit den drei Punkten `Bindung an die Anmeldung lösen`.",
          "Lies im Fenster, was passiert, und wähle `Bindung lösen`.",
          "Der Vertrag folgt den Buchungen dann nicht mehr. Versionen, die schon entstanden sind, bleiben.",
          "Die Anmeldung und ihre Buchungen bleiben an der Schule. Braucht das Kind sie nicht, nimmt die Schule die Buchungen heraus.",
          "War die Verknüpfung falsch, wähle danach `Verknüpfung lösen` und verknüpfe die richtige Kinderakte. Sonst bindet `Anmeldungen nachtragen` den Vertrag wieder an dieselbe Anmeldung.",
        ],
      },
      {
        title: "Module importierter Verträge neu zuordnen",
        description:
          "Hast du deine Module nach dem Import neu geordnet? Dann buchen die importierten Verträge noch die alten Module. Mit einer CSV-Datei ordnest du die Buchungen den neuen Modulen zu. Jeder geänderte Vertrag bekommt eine neue Version. Wochentage und Endzeiten bleiben. Die Eltern bekommen keine Nachricht.",
        steps: [
          "Wähle in der Navigation `Verträge`. Wähle oben rechts das Menü mit den drei Punkten und dann `Module neu zuordnen`.",
          "Du kennst den Aufbau noch nicht? Wähle `Beispieldatei`. Die Datei hat die Spalten `Vertrag`, `Wochentag`, `Bisheriges_Modul` und `Neues_Modul`.",
          "Schreibe pro Vertrag, Wochentag und bisherigem Modul eine Zeile. Bei `Vertrag` steht die Vertragsnummer aus moto. Bei `Wochentag` geht zum Beispiel `Mo`, `Mo-Fr` oder `Montag`.",
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
          "Ergänze die Liste. `Vertragsparteien`: Namen als „Nachname, Vorname“, getrennt mit „ | “. Ein weiterer Name kommt dazu. Schreibst du einen Namen anders, ändert moto die Schreibweise. Vor- oder Nachname muss dabei gleich bleiben. Ändere in der Liste nur einen Namen pro Vertrag. Keine Partei fällt weg. Mail-Adresse und Elternkonto bleiben.",
          "`Abschlussart`: „online“ oder „papier“. `Abschlussdatum`: ein Datum wie 12.03.2026, oder „unbekannt“, wenn du den Tag nicht belegen kannst.",
          "Trage bei `Beleg` in jeder geänderten Zeile ein, woher die Angabe stammt, zum Beispiel den Namen der PDF mit dem Vertrag. Eine leere Zelle ändert nichts. `Vertrag-ID` und `Kind` änderst du nicht.",
          "Speichere die Liste als CSV-Datei. Ziehe sie bei `2. Ausgefüllte Liste hochladen` in das Feld oder wähle `Datei wählen`.",
          "Prüfe die Vorschau. Pro Zeile steht der alte Wert durchgestrichen und daneben der neue. `Wird geändert` ändert moto. `Bereits aktuell` bleibt, wie es ist. Bei `Fehler` steht der Grund in der Spalte, zu der er gehört.",
          "Wähle unten zum Beispiel `3 Verträge ändern`. moto fragt noch einmal. Bestätige.",
          "Auf der Vertragsseite steht danach die Karte `Nachgepflegte Angaben` mit dem Tag, dem Beleg und der Änderung. Lädst du dieselbe Liste noch einmal hoch, ändert sich nichts.",
        ],
      },
      {
        title: "Änderungswunsch der Eltern freigeben",
        steps: [
          "Die Eltern beantragen in der Eltern-App andere Tage oder Module. Du oder die Schule entscheidet.",
          "Wähle in der Liste das Kind. Im Reiter `Unterschrift und Versand` steht die Karte `Änderungswunsch der Eltern`. Wartet ein Wunsch, zeigt der Reiter eine Zahl.",
          "Pro Modul siehst du die bisherige und die gewünschte Buchung. Bei festen Tagen steht dort `Gebucht (feste Tage)`.",
          "Module, die gleich bleiben, stehen darunter bei `Bleibt gebucht`.",
          "Wähle `Freigeben`. Prüfe `Gilt ab` und die angezeigten Änderungen. Wähle noch einmal `Freigeben`.",
          "Oder wähle `Ablehnen`. Schreibe eine Begründung für die Eltern und wähle `Ablehnen`.",
          "Die Eltern bekommen eine Nachricht in der Eltern-App.",
        ],
      },
      {
        title: "Wenn sich die Betreuung ändert: neue Version",
        steps: [
          "Ändert sich die gebuchte Betreuung, bekommt der Vertrag nach wenigen Minuten eine neue Version.",
          "Haben die Eltern die Änderung selbst beantragt, und du oder die Schule gibt sie frei? Dann gilt die neue Version ab dem freigegebenen Tag. Der Antrag der Eltern gilt als Unterschrift. Die Eltern bekommen die neue Fassung per Mail und in der Eltern-App.",
          "Wähle in der Liste das Kind. Oben steht, ab wann die neue Version gilt.",
          "Im Reiter `Versionen` siehst du jede Version mit ihren Tagen. `Geändert` markiert die Wochentage, die anders sind als vorher. Unter den Daten steht, wie die Eltern zugestimmt haben.",
          "Mit `PDF` lädst du eine Version als PDF.",
        ],
      },
      {
        title: "Wenn die Eltern eine Änderung neu unterschreiben müssen",
        description:
          "Hat die Schule oder der Träger die Betreuung geändert, ohne dass die Eltern das beantragt haben? Dann müssen die Eltern die neue Version unterschreiben. Bis dahin gilt die bisherige Version, auch für die Abrechnung.",
        steps: [
          "In der Liste steht beim Vertrag `Änderung wartet auf Unterschrift`. Wähle das Kind.",
          "Oben steht, welche Version bis zur Unterschrift gilt. Wähle `Zur geänderten Fassung`.",
          "Die Karte `Geänderte Fassung` zeigt `Wartet auf Eltern` und den Versandstand. Wird die Mail noch gesendet? Dann warte, bis der Versand fertig ist. Ist sie nicht angekommen oder ihr Ergebnis unbekannt? Gib den Eltern das PDF unter `Versionen`. In der Eltern-App sehen sie die Änderung und unterschreiben.",
          "Bis zur Unterschrift bekommen die Eltern Erinnerungen per Mail. Die Karte zeigt jede Erinnerung.",
          "Haben die Eltern auf Papier unterschrieben? Lade das PDF der neuen Version im Reiter `Versionen` mit `PDF`. Wähle danach in der Karte `Papiervertrag erfassen`.",
          "Nach der Unterschrift steht die Version im Reiter `Versionen` mit `Gilt ab` oder `Gilt jetzt`.",
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
      "Ein importierter Vertrag beginnt frühestens mit dem Schuljahr seines Moduls. Er endet auch mit diesem Schuljahr, wenn das Modul ein Ende hat und die Datei kein früheres nennt. Lief der Vertrag schon vorher, steht der frühere Tag unter `Abgeschlossen`. Der Vertrag ist mit keiner Kinderakte der Schule verknüpft, bis du ihn verknüpfst: moto gleicht Kinder nicht über den Namen ab. Im Reiter `Versionen` steht bei ihm `Aus einer Datei importiert`.",
      "Hat ein Kind einen laufenden importierten Vertrag, bekommt es aus einer Anmeldung keinen zweiten Vertrag für dieselbe Zeit. Das gilt auch, solange der Vertrag noch nicht verknüpft ist: Dann zählen Name und Geburtsdatum. Das Kind steht in `Verträge erstellen` mit `Hat schon einen importierten Vertrag` und der Nummer des Vertrags. Stimmt das nicht, prüfe dort die Kinderakte und das Vertragsende. Endet der importierte Vertrag vor der gebuchten Betreuung, bekommt das Kind seinen neuen Vertrag wie sonst.",
      "Die Suche und die Filter gelten für alle Verträge. Mit `Weitere Verträge laden` zeigst du weitere Treffer an.",
      "Die Liste nennt in eigenen Spalten Kind, Angebot, Betreuungsort, Eltern, Beginn und Status. Der neueste Vertrag steht oben. Wähle eine Spaltenüberschrift wie `Kind` oder `Beginn`. Ein zweiter Klick dreht die Reihenfolge um. Am Handy wählst du die Reihenfolge unter `Sortieren nach`. Die Sortierung gilt für alle Verträge deiner Auswahl.",
      "Beim ersten Senden oder mit `Auf Papier übergeben` hält moto das PDF fest. Änderst du danach Bedingungen oder Brieftext, bleibt der versendete Vertrag gleich.",
      "Im Reiter `Unterschrift und Versand` siehst du in der Karte `Versand`, ob die Mail gesendet wurde. Mit `Versand aktualisieren` prüfst du den neuen Stand. Mit `Erneut senden` geht dasselbe PDF noch einmal an die Eltern; moto fragt vorher. Bei einem aktiven Vertrag steht `Erneut senden` im Menü mit den drei Punkten oben rechts. Eine zweite Nachricht aufs Handy gibt es dabei nicht. Nur eine korrigierte Mail-Adresse bekommt eine eigene Nachricht.",
      "Neben jedem Versand steht, was aus der Mail geworden ist: wie bei der Abrechnung. Der Hinweis oben nennt den Grund und den nächsten Schritt. Bei `Verzögert` wartest du. Hat die Schule die Mails gestoppt, kläre das mit der Schule. Bei `Gesperrt` klärt das der moto-Support. Solange das gilt, ist `Erneut senden` aus.",
      "Den Brieftext des Vertrags änderst du unter `Einstellungen` → `Briefkopf und Vorlagen` bei der Vorlage `Vertrag`.",
      "Mit `PDF herunterladen` bekommst du den versendeten Vertrag zum Drucken. Bei einem Entwurf heißt der Eintrag `Vorschau herunterladen`. Auf jeder Seite der Vorschau steht `Vorschau, nicht zum Unterschreiben`. Für Familien ohne Mail wähle `Auf Papier übergeben`.",
      "Wartet ein per Mail versendeter Vertrag auf die Unterschrift, bekommen die Eltern Erinnerungen per Mail. Es gibt höchstens drei. Abgeschlossene und auf Papier übergebene Verträge bekommen keine Erinnerung. Nach wie vielen Tagen, lege unter `Einstellungen` → `Allgemein` im Bereich `Betreuungsverträge` fest. Bei 0 gibt es keine Erinnerung.",
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
      "Unterschreiben die Eltern eine geänderte Fassung erst nach ihrem Tag, gilt sie ab dem Tag der Unterschrift. Im Reiter `Versionen` steht dann auch der Tag aus dem Vertrag.",
      "Als Unterschrift zählt nur ein Antrag vom Elternkonto der Vertragspartei, den die Freigabe genau so gebucht hat. Hat ein anderer Elternteil gefragt, oder hat die Freigabe etwas anderes gebucht? Dann wartet die Version auf die Unterschrift.",
      "Ändert sich die Betreuung noch einmal, bevor die Eltern unterschrieben haben? Dann bekommen sie eine neue Fassung mit neuem Link. Die frühere steht unter `Versionen` als `Überholt`. Niemand kann sie mehr unterschreiben. Das gilt auch für einen versendeten Vertrag, den noch niemand unterschrieben hat.",
      "Nimmt die Schule die Änderung zurück, wartet nichts mehr. Die Version steht dann als `Überholt` unter `Versionen`.",
      "Ging der Vertrag nie per Mail an die Eltern, zum Beispiel bei einer Übergabe auf Papier? Dann bekommen die Eltern auch die geänderte Fassung nicht per Mail. Die Karte `Geänderte Fassung` sagt dir das. Gib den Eltern das PDF.",
      "Beginnt an einem Tag schon eine Version, und du oder die Schule gibt für denselben Tag eine weitere Änderung frei, ersetzt moto diese Version. Die neue Version enthält beide Änderungen. Die alte steht unter `Versionen` als `Ersetzt` und gilt an keinem Tag.",
      "Ist schon eine spätere Version geplant, gilt eine frühere Änderung nur bis dahin. Die geplante Version übernimmt sie nicht von selbst.",
    ],
    differences: [
      "`Schule wählen` fehlt bei `Anmeldungen nachtragen`? Dein Träger hat nur eine Schule. moto zeigt gleich ihre Vorschau.",
      "Du siehst `Verträge` nicht in der Navigation? Dir fehlt das Recht `Verträge verwalten`. Wende dich an eine Person mit der Rolle `Leitung`.",
    ],
    troubleshootingDetails: [
      "Beim Nachtragen steht `Seit deiner Vorschau hat sich etwas geändert`? Ein Vertrag, die Schule oder der Tag ist neu. moto hat nichts eingetragen. Prüfe die neue Vorschau und trag noch einmal nach.",
      "Beim Nachtragen steht `Das Nachtragen ist nicht ganz durchgelaufen`? Manche Kinder können schon angemeldet sein. Trag noch einmal nach. moto bindet dann die Verträge, es entsteht nichts doppelt.",
      "Die Schule fragt, warum ein Kind ohne Eltern angemeldet ist? Die Anmeldung kommt aus dem importierten Vertrag. Die Schule lädt die Eltern in ihrer Kinderliste mit `Eltern einladen` ins Elternportal ein. Setzt sie dort den Haken bei `Eltern mit Konto benachrichtigen`, bekommen Eltern mit Konto eine kurze Nachricht: Die Betreuung ist jetzt im Elternportal sichtbar.",
      "Beim Import steht `Für das Modul fehlen die Vertragsbedingungen`? Trage unter `Vertragsbedingungen` Laufzeit und Frist für das Modul ein. Wähle danach im Import `Erneut prüfen` oder lade die Datei noch einmal.",
      "Beim Import steht `Dieses Modul gibt es an der Schule nicht`? Der Name in der Datei muss so heißen wie das Angebot der Schule. Ändere den Namen in der Datei, oder wähle `Modul für alle Zeilen`.",
      "Beim Import steht `„Kinder in der Familie“ ist keine ganze Zahl von 1 bis 20`? moto übernimmt die Zeile nicht. Korrigiere die Zahl in der Datei und lade die Datei noch einmal.",
      "Beim Neuzuordnen der Module steht `Der Vertrag kommt aus einer Anmeldung`? Ändern lassen sich nur importierte Verträge. Die Module eines Vertrags aus einer Anmeldung folgen den Buchungen der Schule. Die Schule ändert dort die Buchung.",
      "Beim Neuzuordnen der Module steht `Der Vertrag ändert sich schon später`? Für den Vertrag ist schon eine neue Version geplant. Wähle bei `Gilt ab` einen Tag ab dieser Version.",
      "Ein importierter Vertrag ist falsch? Einen übernommenen Vertrag kannst du nicht löschen und nicht noch einmal importieren. Fehlen nur Vertragsparteien, die Abschlussart oder das Abschlussdatum, ergänze sie unter `Vertragsangaben nachpflegen`. Sonst trage für ihn eine Kündigung ein. Prüfe die Vorschau deshalb, bevor du übernimmst.",
      "Beim Nachpflegen steht `Dieser Vertrag kommt nicht aus einem Import`? Nachpflegen geht nur für importierte Verträge. Die Angaben der anderen Verträge stammen aus moto.",
      "Beim Nachpflegen steht `moto erkennt nicht sicher, welcher Name zu welcher vorhandenen Vertragspartei gehört`? Du hast in einer Zeile einen Namen geändert und zugleich einen ergänzt, oder zwei Namen geändert. Ändere erst einen Namen und lade die Liste hoch. Lade danach die Liste neu herunter und ergänze den nächsten. Ist es eine andere Person? Dann lass den alten Namen stehen und ergänze den neuen.",
      "Beim Nachpflegen steht `Eine Vertragspartei fehlt`? Die Zeile nennt weniger Namen als der Vertrag hat. Nimm alle Namen aus der heruntergeladenen Liste und ergänze nur neue.",
      "In `Vertrag beenden` steht `Die Mitteilung zum Vertragsende ging nicht raus`? Der Hinweis nennt den Grund: Der Vertrag ist mit keiner Kinderakte der Schule verknüpft. Einen importierten Vertrag verknüpfst du auf seiner Seite mit `Mit Kinderakte verknüpfen`. Oder keine Adresse des Vertrags gehört noch einer Bezugsperson, die für das Kind handeln darf. Bei älteren Entscheidungen kennt moto den Grund nicht. Die Entscheidung gilt trotzdem. Schicke den Eltern die Mitteilung per Brief. Sie steht darunter als `Mitteilung zum Vertragsende (nicht verschickt)`.",
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
