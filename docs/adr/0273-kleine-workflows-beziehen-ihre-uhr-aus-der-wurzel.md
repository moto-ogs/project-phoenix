---
status: accepted
---

# Kleine Workflows beziehen ihre Uhr aus der Wurzel

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104), Schnitt der
Workflows Shift Plan Sync, Caterer Portal, Holiday Closure Notification,
Care Exit, Reminder Delivery und der Tests von Student Deletion. Sie wendet
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) und
[ADR 0271](0271-die-echte-uhr-wird-nur-in-wurzeln-und-kompositionen-benannt.md)
auf diese Workflows an und führt keinen neuen Owner ein.

## Kontext

`TestModuleLiveClockRatchet` zählte fünf direkte Aufrufe der echten Uhr
(Shift Plan Sync 2, Caterer Portal 2, Holiday Closure Notification 1) und drei
Bindungen der echten Uhr als Wert außerhalb einer Komposition (Care Exit 2,
Reminder Delivery 1). `calendarFixtureShiftedLiveDateDebt` führte 40
verschobene Live-Daten in vier Testdateien (Shift Plan Sync 38,
Student Deletion 2).

Dabei entschieden mehrere Stellen mit zwei Uhren:

- Die Übersicht der Terminvertretung gab „Vertretung beenden“ nach dem Tag
  der Maschine frei, während Timetable dieselbe Änderung mit der Uhr der
  Komposition prüft.
- Das Caterer-Portal verglich den Ablauf einer Einladung, den Identity &
  Access mit der Uhr der Komposition stempelt, mit der Uhr der Maschine.
- Der Holiday-Closure-Worker stempelte die nächste Fälligkeit eines
  fehlgeschlagenen Kommandos in Go, die Lease-Abfrage und der Watchdog von
  School Calendar vergleichen sie mit PostgreSQLs `CURRENT_TIMESTAMP`.
- Die Wurzeln übergaben Care Exit keine Tagesuhr (`nil`) und Student Deletion
  keine Uhr; eine Testwurzel setzte `Now` fest und ließ `Today` auf dem Tag
  der Maschine.

## Entscheidung

1. **Pflichtuhr statt Nil-Default.** Sick Cascade und Terminvertretung von
   Shift Plan Sync, die HTTP-Ressource des Caterer-Portals, Resumption und
   PlanRestoration von Care Exit und die Vorbereitung von Reminder Delivery
   verlangen ihre Uhr beim Bau und scheitern ohne sie. Die Wurzeln übergeben
   `env.Today` beziehungsweise `env.Now`; `mountStudentRoutes` leitet die
   Tagesuhr aus der übergebenen Uhr ab.
2. **Eine Uhr je Entscheidung.** Ein Fehlversuch des Holiday-Closure-Workers
   meldet nur noch die Wartezeit (`HolidayClosureOutcome.RetryAfter`);
   School Calendar schreibt `next_attempt_at = CURRENT_TIMESTAMP + Wartezeit`,
   so wie es `lease_until` schon schreibt. Lease, Fälligkeit und Watchdog
   lesen damit dieselbe Uhr, und der Workflow ruft die echte Uhr nicht mehr.
3. **Student Deletion.** `BuildStudentDeletion` übergibt `env.Now`;
   `Assemble` leitet einen fehlenden Tag aus dieser Uhr ab statt aus der
   Maschine.
4. **Tests auf festen Tagen.** Die Suiten von Sick Cascade und
   Terminvertretung laufen auf Montag, dem 24.08.2026; die Purge-Prüfung von
   Student Deletion auf dem 14.09.2026. Für eine laufende Aufsicht auf einem
   festen Tag gibt es `testpkg.CreateTestGroupSupervisorOn`.
5. **Budget.** Das Compose-LOC-Budget von `workflows/shiftplansync/compose`
   steigt um die eine Zeile des Uhrfelds der Terminvertretung, 124 auf 125,
   Summe 13.643 auf 13.644.

## Folgen

- `moduleLiveClockBudget` verliert drei Einträge (5 Aufrufe),
  `moduleLiveClockValueBudget` zwei (3 Bindungen).
- `calendarFixtureShiftedLiveDateDebt` verliert vier Dateien mit 40 Funden.
- `composeServeRoot` wird eine Zeile kürzer (513 auf 512), `test/fixtures.go`
  18 Zeilen (3.049 auf 3.031).
- Keine Effekt-Bindung ändert ihren Digest.
- Kein Verhalten im Betrieb ändert sich: alle Wurzeln übergeben die echte
  Uhr, und die Wartezeit des Workers bleibt eine Minute, verdoppelt je
  Versuch bis 64 Minuten.
