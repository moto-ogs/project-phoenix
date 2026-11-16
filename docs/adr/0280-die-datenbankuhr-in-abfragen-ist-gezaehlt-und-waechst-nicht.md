---
status: accepted
---

# Die Datenbankuhr in Abfragen ist gezählt und wächst nicht

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104). Sie ergänzt
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) und
[ADR 0272](0272-die-echte-uhr-wird-nur-in-wurzeln-und-kompositionen-benannt.md)
um die zweite Uhr eines Owners: die der Datenbank.

## Kontext

Nach den Owner-Schnitten von #7104 liest kein Paket unter `backend/modules`
und `backend/workflows` die echte Uhr mehr selbst; `TestModuleLiveClockRatchet`
hält das. Die Reviews dieser Schnitte fanden trotzdem in fast jedem Owner
denselben Fehler: Eine Entscheidung stempelt auf der einen Uhr und vergleicht
auf der anderen. Go schrieb `published_at` und die Abfrage verglich mit
`NOW()`; die Datenbank stempelte `created_at` und die Aufbewahrung rechnete
mit der Go-Uhr; eine Spaltenvorgabe stand gegen eine Prüfbedingung. In der
Produktion laufen beide Uhren gleich. Ein Test mit fester Uhr erreicht aber
nur eine von beiden, und sichtbar wurde der Fehler erst mit Go und PostgreSQL
auf verschiedenen Tagen.

## Entscheidung

1. **Regel.** Eine Abfrage erhält den Zeitpunkt oder Tag ihrer Entscheidung
   als Parameter aus der Uhr des Owners. Sie liest die Datenbankuhr nicht.
2. **Register `moduleSQLClockBudget`** (`TestModuleSQLClockRatchet`,
   `backend/test/module_sql_clock_ratchet_test.go`): je Owner die Vorkommen
   von `NOW()`, `CURRENT_TIMESTAMP`, `CURRENT_DATE`, `CURRENT_TIME`,
   `LOCALTIMESTAMP`, `LOCALTIME`, `clock_timestamp()`, `statement_timestamp()`
   und `transaction_timestamp()` in den Zeichenketten der Produktionsdateien.
   Nur schrumpfend, wie die übrigen Register; eine Erhöhung braucht einen ADR,
   den der Eintrag nennt.
3. **Benannte Ausnahme: Entscheidungen ganz auf der Datenbankuhr.** Wo die
   Datenbank stempelt und ordnet, vergleicht sie auch: die Aufbewahrung der
   Nachrichten (ADR 0277), die Freigabe der Datenrückgabe (ADR 0274), Leases
   und Fälligkeiten der Ferienschließung (ADR 0273). Ihr Anteil bleibt im
   Register und steht mit Grund über dem Eintrag.
4. **Außerhalb des Registers** bleiben Migrationen: Spaltenvorgaben und
   Trigger wie `update_modified_column()` gehören zum Schema. Eine Tabelle
   mit diesem Trigger erhält `updated_at` nicht aus Go; eine Entscheidung
   liest eine solche Spalte nur gegen die Datenbankuhr.
5. **Startwert:** 802 Vorkommen in 26 Ownern, gemessen auf `development`
   `436cec0402`.

## Folgen

- Eine neue Abfrage mit `NOW()` oder `CURRENT_DATE` lässt den Test
  fehlschlagen; der Fehlertext nennt den Parameter als Weg.
- Das Register zählt Vorkommen, nicht Fehler: Ein reiner Stempel ohne späteren
  Vergleich ist harmlos und zählt trotzdem. Der Bestand ist deshalb kein
  Fehlerverzeichnis, sondern die Obergrenze, unter der die zweite Uhr nur noch
  abnimmt.
- Offene Paare aus den Reviews von #7104, die auf zwei Uhren entscheiden und
  mit dem Bestand gezählt sind: Aufbewahrung der Zustell-Protokolle
  (`delivery`), der Umfrage-Entwürfe (`communication`), der abgeschlossenen
  Abmeldungen (`careplan`), der Nummern-Ereignisse (`parentbilling`), die
  Zielgruppen-Prädikate (`parentannouncementaudience`) und Timetables
  `CompletionTimestamp`.
