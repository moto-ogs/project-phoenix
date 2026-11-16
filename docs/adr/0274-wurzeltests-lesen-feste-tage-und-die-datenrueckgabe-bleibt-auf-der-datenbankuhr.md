---
status: accepted
---

# Wurzeltests lesen feste Tage, die Datenrückgabe bleibt auf der Datenbankuhr

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104), Schnitt der
Tests in den Wurzeln (`backend/api`, `backend/cmd`) und der Datenrückgabe von
Organisation & Tenancy. Sie wendet
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) und
[ADR 0271](0271-die-echte-uhr-wird-nur-in-wurzeln-und-kompositionen-benannt.md)
an und führt keinen neuen Owner ein.

## Kontext

`calendarFixtureShiftedLiveDateDebt` führte für diesen Schnitt 27 verschobene
Live-Daten in acht Testdateien: die Ausgaben des Cleanup-Kommandos (sechs),
den Demo-Schnappschuss (zwei), den opt-in Runtime-Checkpoint (zwölf) und die
Datenrückgabe (sieben, in vier Dateien). Ein Lauf von `./api/...` und
`./cmd/...` mit Go- und PostgreSQL-Uhr am 2028-07-03 fand dazu drei Tests,
die nur wegen des Datums rot waren:

- `TestTraegerAbsenceTypesShareOneKontingentOverAllSchools` las das
  Kontingent 2027 mit der echten Uhr; ab 2028 ist das Jahr vorbei und der
  Rest null.
- `TestTraegerStaffTimeAccountSumsAndClosesEverySchool` setzte die Uhr des
  Träger-Portals fest, baute die Buchungen der Schule aber ohne Uhr; der
  Kontobeginn wanderte mit dem echten Jahr.
- `TestFamilyNumberOutlivesTheRegistrationAndHasItsOwnPeriod` prüft die
  Löschung der Familienspur an festen Tagen. Die Spur
  (`parent_billing.family_billing_events.occurred_at`) stempelt die
  Datenbank mit `DEFAULT CURRENT_TIMESTAMP`; ab 2028 geschrieben, überlebte
  sie die Frist des Jahres 2031.

## Entscheidung

1. **Das Cleanup-Kommando zählt das Alter ab einem übergebenen Zeitpunkt.**
   `printPreviewHeader` und `printRetentionStats` nehmen den Zeitpunkt,
   `printAttendancePreviewHeader` und `printSupervisorPreviewHeader` den Tag,
   von dem aus sie „vor n Tagen“ rechnen. Die Wurzel `cmd` reicht die echte
   Uhr, wie sie es für die Aufbewahrungsdienste desselben Kommandos tut; die
   Tests rechnen ab dem 18.11.2026 und prüfen jetzt die Tageszahl.
2. **Feste Tage in den Wurzeltests.** Der Demo-Schnappschuss liest einen
   festen Schultag mit fester Uhr der Demo-Laufzeit. Die beiden
   Träger-Personaltests reichen ihre feste Uhr auch an die Module der Schule
   (`NewAbsenceTypeTestModule`, `NewWorkforceTestModule`).
3. **Die Datenrückgabe bleibt auf der Datenbankuhr (benannte Ausnahme).**
   Die Freigabe läuft als `phoenix_data_return`, die kein Tabellenrecht hält,
   nur `EXECUTE` auf die `SECURITY DEFINER`-Funktionen der Migrationen
   1.15.917 und 1.15.919. `platform.data_return_issue` begrenzt die
   Abrufdauer (bis 366 Tage) und die Lebensdauer eines Tokens (bis 30 Tage)
   gegen PostgreSQLs `now()`; Widerruf, Löschung und `issued_at` stempeln
   ebenfalls `now()`. Diese Uhr ist die Sicherheitsgrenze der Freigabe. Ein
   Zeitpunkt als Parameter ließe die Rolle ihr eigenes „jetzt“ wählen und
   höbe beide Grenzen auf. Die vier Testdateien legen `keep_until` daher
   relativ zum echten Tag; ihre Einträge bleiben mit diesem Grund.
4. **Der Runtime-Checkpoint bleibt auf der echten Uhr (benannte Ausnahme).**
   `measureRuntimeCheckpoint` und `newTargetRiskWorkload` messen den ganzen
   Produktionsgraphen aus `WithRuntime`, der die echte Uhr ohne Eingang
   behält (`newProductionEnvironment`). Eine Uhr in der produktiven
   `ServeConfig` nur für diese Messung, die in keinem CI-Job läuft, ist kein
   guter Tausch.
5. **Die Familienspur bekommt im Test ihren Tag.** Vor dem letzten
   Löschlauf datiert der Test die Spur auf den 18.11.2026. Im Betrieb
   vergleicht die Löschung die Datenbankzeit mit dem echten Tag aus Go; beide
   laufen gleich. Die Spur aus der Uhr des Stores zu stempeln bräuchte eine
   Uhr für Zeitpunkte in jedem Store von Parent Billing, dessen Kompositionen
   nur Tagesuhren kennen. Das gehört zu den Datenbankuhren, die #7104 getrennt
   behandelt.

## Folgen

- `calendarFixtureShiftedLiveDateDebt` verliert zwei Dateien mit acht Funden
  (`cmd/cleanup_test.go` 6, `cmd/devtools/demo_runtime_test.go` 2). 19 Funde
  in sechs Dateien bleiben mit Grund über dem Eintrag: Datenrückgabe 7,
  Runtime-Checkpoint 12.
- `./api/...` und `./cmd/...` laufen mit Go- und PostgreSQL-Uhr am
  2028-07-03, 2029-06-04 und 2031-06-02 grün.
- Keine Uhr-Budgets und keine Register steigen.
- Der opt-in Runtime-Checkpoint ist auf `development` schon vor diesem
  Schnitt rot: seine Tokens tragen keine Sitzungsfamilie (#5194), und nach
  etwa 35 Anmeldungen desselben Kontos lehnt die Anmeldung ab. Das bleibt
  außerhalb dieses Schnitts.
