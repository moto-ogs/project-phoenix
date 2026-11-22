---
status: proposed
---

# Die Angebotszuordnung importierter Verträge wird als neue Vertragsversion korrigiert

Vorschlag vom 22.11.2026 zu [#7764](https://github.com/moto-ogs/project-phoenix/issues/7764).
Er ergänzt [ADR 0232](0232-bestandsvertraege-kommen-aus-einer-datei-ohne-anmeldung.md)
(Import von Bestandsverträgen) und nutzt die Zeitleiste der Versionen aus #4681
(ADR 0088 §2).

## Kontext

- Der Import bucht die Module einer Schule über die Namen der Datei. SJR
  Pforzheim hat so je Wochenmuster ein eigenes Modul bekommen. An der
  Otto-Riehm-Schule teilen sich Regel- und Ganztagsverträge zwei Module,
  obwohl ihre Preise verschieden sind.
- Ein Preis gehört zu Schule und Modul (`parent_billing.care_tariffs`): je
  Wochentag oder als Staffel nach Tagen je Woche. Einen Vertragstyp kennt er
  nicht. Getrennte Module je Tarifgrundlage lösen den Fall ohne neues
  Preismodell; die Module legt das Büro im Katalog an und bepreist sie.
- Die gebuchten Module eines Vertrags stehen in
  `care_contract.contract_version_services`. Die Tabelle ist nur anfügbar.
  Ein importierter Vertrag hat kein Anmeldungskind, also ändert ihn auch keine
  genehmigte Buchungsänderung (`AmendFromBookings`, ADR 0232 Punkt 6). Ein
  erneuter Import überspringt ihn.
- Eine Version mit Nummer über 1 beginnt nie vor heute (Trigger aus #4681):
  Ein Monat, der schon abgerechnet sein kann, behält seine Module.
  Ausgestellte Rechnungen sind Kopien und ändern sich nie.

## Entscheidung

1. **Owner und Ort.** Die Korrektur gehört `care-contract` und hängt an der
   Fähigkeit des Imports: `carecontract.ContractImports.CorrectOfferings`,
   Routen `POST /traeger/contract-imports/offering-corrections` und
   `…/preview`, hinter dem Recht „Verträge verwalten“. Kein neuer Owner, keine
   neue Tabelle, kein neuer Konstruktor.
2. **Eine Korrektur ist eine neue Version.** Der Vertrag bekommt ab dem
   gewählten Tag eine Version mit der Herkunft `angebotskorrektur`. Sie
   übernimmt alles aus der Version, die an dem Tag gilt, und tauscht nur das
   Modul der genannten Buchungen. Wochentag, Endzeit und letzter Buchungstag
   bleiben. Die frühere Version wird `abgeloest`, oder `ersetzt`, wenn sie am
   selben Tag beginnt. Frühere Versionen bleiben lesbar.
3. **Der Tag ist heute oder später.** Beginnt der Vertrag erst danach, gilt
   die Korrektur ab seinem ersten Tag und ersetzt Version 1. Rückwirkend
   korrigiert moto nicht.
4. **Die Datei nennt die Buchung, nicht nur das Modul.** Eine Zeile nennt
   Vertrag (Nummer in moto), Wochentag, bisheriges Modul und Zielmodul. Ein
   Modul kann so je Vertrag zu verschiedenen Zielen gehen: Das trennt Regel-
   und Ganztagsverträge, die heute ein Modul teilen.
5. **Ganz oder gar nicht je Vertrag.** Hat eine Zeile eines Vertrags ein
   Problem, bleibt der ganze Vertrag unverändert und wird mit Zeile und Grund
   genannt. Eine Zeile ohne Zielmodul stellt den Vertrag zurück: So weist das
   Büro ungeklärte Fälle aus, etwa die Birkenfelder Mischmuster, ohne sie zu
   ändern.
6. **Vorschau und Wiederholung.** Die Korrektur übernimmt nur die bestätigte
   Vorschau (Fingerabdruck), sonst `care_contract.import_changed`. Beim
   Speichern liest sie die Verträge unter ihrer Zeilensperre. Eine Buchung,
   die ihr Ziel schon nennt, ergibt keine neue Version: Ein zweiter Lauf
   derselben Datei ändert nichts.
7. **Nur Verträge ohne Anmeldungskind.** Ein Vertrag mit `request_child_id`
   folgt den Buchungen seiner Schule; der nächste Lauf von `AmendFromBookings`
   würde die Korrektur zurücknehmen. Die Korrektur lehnt ihn ab
   (`follows_bookings`). Das gilt auch für einen importierten Vertrag, den
   #7760 später an eine Anmeldung bindet: Ab dann ändern sich seine Module
   über die Buchungen, wie bei jedem Vertrag. Die Korrektur ist der Schritt
   davor, kein zweiter Dauerweg.
8. **Keine Nebenwirkung.** Die Korrektur schreibt die Version und einen
   Eintrag in den Verlauf (Datei, Zeilen, Konto). Sie verschickt nichts,
   erzeugt kein PDF und startet keinen Abrechnungslauf. Sie trägt in das
   Zugriffsprotokoll jeder Schule ein, deren Verträge sie gezeigt hat
   (ADR 0084 §7). Die Datei wird nie gespeichert.
9. **Bedingungen bleiben.** Die Vertragsbedingungen der Version (Laufzeit,
   Kündigung, Satzung) kommen aus der bisherigen Version, nicht aus den
   Bedingungen des Zielmoduls: Vereinbart ist, was die Eltern unterschrieben
   haben.

## Register

- **Träger-Transaktion** (`backend/test/traeger_transaction.go`,
  `transaction_boundaries.json`): `ContractImports.CorrectOfferings` öffnet
  die Träger-Transaktion selbst, weil es davor jede Schule in ihrer
  Tenant-Transaktion liest und danach in deren Zugriffsprotokoll schreibt
  (ADR 0105), wie der Import.
- **Herkunft einer Version**: `chk_contract_versions_source` erlaubt
  zusätzlich `angebotskorrektur` (Migration `20261122120000`).
- Keine Änderung an Compose-Budgets, Policy, Kommando-Effekten oder
  Pass-through: Die Korrektur nutzt die Ports des Imports.

## Verworfene Optionen

- **Buchungen in der bestehenden Version überschreiben.** Die Tabelle ist
  nur anfügbar, und der Preisstand vergangener Monate wäre nicht mehr
  nachvollziehbar.
- **Rückwirkende Version ab Vertragsbeginn.** Sie griffe in Monate, die
  abgerechnet sein können. Für SJR gelten die Preise ab 01.01.2027; ein Tag in
  der Zukunft reicht.
- **Einmalige Datenmigration.** Die Zuordnung ist je Träger verschieden und
  enthält Personenbezug. Eine Migration hätte keine Vorschau und liefe ohne
  das Büro.
- **Zuordnung je Modul statt je Buchung** („Modul A wird Modul B“). Sie kann
  ein Modul nicht auf zwei Ziele verteilen, also gerade den Fall Otto-Riehm
  nicht lösen.
- **Module zusammenführen im Katalog.** Träfe auch Buchungen und Anmeldungen
  der Schulen und ist ein eigener Eingriff in Care Plan.
- **Auf #7760 warten und über Buchungsänderungen korrigieren.** Das wären
  839 Buchungen von Hand je Schule, und die nachträglichen Buchungen aus
  #7760 entstünden zuerst aus der falschen Zuordnung. Umgekehrt entstehen sie
  aus der korrigierten.
- **Mischpreisformel für Birkenfeld einbauen.** Die Formel ist fachlich nicht
  bestätigt (siehe Folgen).

## Folgen

- Reihenfolge im Betrieb: Zielmodule anlegen und bepreisen, Zuordnung
  korrigieren, alte Module abschalten, danach #7760. Ein Zielmodul ohne Preis
  hält den ganzen Vertrag aus dem Monatslauf heraus; die Preisliste zeigt das
  als „Preis fehlt“.
- Ein Vertrag kann an einem Wochentag zwei Module buchen (früh und
  nachmittags). Die Abrechnung rechnet je Modul eine Position.
- Bei der Einstellung „anteilig“ für einen Wechsel im Monat rechnet die
  Abrechnung einen Monat mit Korrektur mittendrin tagesgenau nach beiden
  Versionen. Ein Tag am Monatsersten vermeidet das.
- Offen: die Birkenfelder Mischmuster (verschiedene Endzeiten je Wochentag
  in einem Vertrag). Das Preismodell bildet heute zwei Varianten ab: einen
  Monatspreis je gebuchtem Wochentag und Modul, und eine Staffel nach Tagen
  je Woche und Modul. Buchen die kurzen und die langen Tage verschiedene
  Module, rechnet moto beide Module getrennt (Summe zweier Wochentagspreise
  oder zweier Staffeln). Eine gemeinsame Staffel über die Tage beider Module
  („5 Tage, davon 2 lang“) bräuchte eine Erweiterung der Preisberechnung. Bis
  zur Entscheidung des Trägers bleiben diese Verträge zurückgestellt.
