---
status: accepted
---

# Audit, Kalender und Auswertungen beziehen ihre Uhr aus der Komposition

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104), Schnitt
Audit, Kalender und Auswertungen. Sie wendet
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) und
[ADR 0240](0240-stoppuhren-sind-keine-uhr-und-care-plan-bezieht-seine-uhr-aus-der-komposition.md)
auf neun Owner an und führt keinen neuen Owner ein.

## Kontext

`TestModuleLiveClockRatchet` zählte in neun Ownern noch 37 direkte Uhr-Aufrufe:
Audit 15, Statistik 6, Termine 5, Schulkalender 5, Betreiber-Übersicht 2 und je
einen in Rückmeldungen, Träger-Sicht, Mittagessen und Anträge-Übersicht. Audit
stempelte Anmeldeereignisse, Löschprotokolle und Feldänderungen in den
Konstruktoren und in `Validate` mit `time.Now()` und rechnete seine
Aufbewahrungsfristen ebenfalls von der echten Uhr. Tests mit fester Uhr
erreichten diese Stellen nicht. Fünf Testdateien dieser Owner standen mit
verschobenen Live-Daten in `calendarFixtureShiftedLiveDateDebt`.

## Entscheidung

1. **Audit stempelt beim Anhängen.** Die Konstruktoren und `Validate` der
   Audit-Zeilen setzen keinen Zeitpunkt mehr. Der `Appender` gibt einem
   Anmeldeereignis, einem Löschprotokoll und einer Feldänderung ohne Zeitpunkt
   den Zeitpunkt der Audit-Uhr; einen gesetzten Zeitpunkt behält er. Ohne Uhr
   lehnt er ein solches Ereignis ab, statt einen Nullzeitpunkt zu schreiben.
   Die Uhr kommt aus `PersistenceDependencies.Now`, `NewTenantPersistence` und
   `NewHandoffPersistence`. Der `Command` rechnet die Aufbewahrungsfristen von
   seiner Uhr (`NewCommand`, `NewObservedCommand`). Die Wurzel reicht
   `RootEnvironment.Now`; Wurzeln ohne Umgebung (Workflow-Audit, Bereinigung,
   CLI) binden `time.Now`.
2. **Die übrigen Owner** erhalten ihre Uhr als Konstruktorparameter oder Feld
   ihrer Komposition: Termine (`Dependencies.Now`, Revisions-, Absage- und
   Löschstempel, Aufbewahrungstag), Schulkalender (`BerlinDay(now)`, Portal
   `Config.Now`, daraus abgeleitet `Config.Today`), Statistik
   (`Runtime.Now` stempelt Exporte), Betreiber-Übersicht (PWA-Fenster),
   Rückmeldungen (`TodayOf(now)`), Träger-Sicht (Uhr der Übersicht auch für
   `AsOf`), Mittagessen (Vergangenheitsgrenze der Teilnahmehistorie) und
   Anträge-Übersicht (`Dependencies.Today` ist Pflicht; die Wurzel bindet den
   Tag der Antragswarteschlangen).
3. **Budgets.** Das Compose-LOC-Budget steigt nur um die Uhrzeilen: Audit
   +7 (197 auf 204), Mittagessen +2 (102 auf 104), Schulkalender +4 (158 auf
   162), zusammen 13.540 auf 13.553. Termine, Anträge-Übersicht, Kalender-Portal
   und Träger-Sicht bleiben in ihrem Budget.

## Folgen

- Das Uhr-Budget fällt von 665 auf 628 Aufrufe; die Einträge der neun Owner
  entfallen.
- `calendarFixtureShiftedLiveDateDebt` verliert fünf Dateien (420 auf 415
  Funde): die Audit-Repositorytests, der Aufbewahrungstest der Termine und der
  Abwesenheitstest der Anträge-Übersicht stehen auf festen Tagen; der
  PWA-Nutzungstest rechnet seine Grenze von der Datenbankuhr, die seine Zeilen
  schreibt.
- Command-Effects und Pass-through-Böden bleiben gleich; drei
  Pass-through-Belege (Löschfristen der unbekannten RFID-Scans,
  Feed-Bereinigung) tragen den neuen Quelltext.
- Die Aufbewahrung des Betreiberprotokolls, des Träger-Kontoprotokolls und der
  Träger-Dokumentabrufe rechnet ihre Grenze weiter in SQL
  (`operatorAuditLogCutoffSQL`); diese Tests lassen sich nur mit
  mitverstellter Datenbankuhr verschieben.
