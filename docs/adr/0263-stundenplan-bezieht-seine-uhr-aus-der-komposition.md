---
status: accepted
---

# Stundenplan bezieht seine Uhr aus der Komposition

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104), Schnitt
Stundenplan. Sie wendet [ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md)
auf den Owner Timetable & Activities an und führt keinen neuen Owner ein.

## Kontext

`TestModuleLiveClockRatchet` zählte in `modules/timetable` 45 direkte
Uhr-Aufrufe. Der Owner hatte schon Teiluhren (`staffDeviations.now`,
`operations.now`, `InstanceLifecycleService.now`, `Resource.Now`), aber
Owner-Service, Postgres-Store, Aktivitäten, Raumreferenzen, Planungsspuren,
Konfliktprüfung, Tagesinformationen und mehrere Lebenszyklus-Schritte lasen
`time.Now()` oder `calendar.TodayDate()` selbst.

Das hatte zwei Folgen. Erstens liefen 115 Testfunde in 17 Dateien
(`calendarFixtureShiftedLiveDateDebt`) auf dem echten Tag. Zweitens
entschieden zwei Stellen derselben Sperrfolge mit verschiedenen Uhren: Die
Absage sperrt das Personal eines Blocks nach dem Tag der Lebenszyklus-Uhr, der
Wächter des Owners (`lockOperationalInstanceStaff`) sperrt es nach dem Tag der
Owner-Uhr. Ein Test, der nur die Lebenszyklus-Uhr pinnte, brach deshalb mit
einer Verletzung der Sperrreihenfolge, sobald beide Uhren verschiedene Tage
nannten.

## Entscheidung

1. **Eine Uhr je Owner-Komposition.** `compose.Dependencies` nimmt `Now`
   statt `Today`; der Schultag ist der Berliner Tag dieser Uhr. Owner-Service
   und Postgres-Store (`Store.WithClock`) lesen sie, auch für die
   Schreibstempel `updated_at`, `archived_at` und `acknowledged_at`. Die
   Wurzel reicht `RootEnvironment.Now`/`Today` an den Owner
   (`BuildServeTimetable`), die Aktivitäten (`BuildActivities`), die
   Raumreferenzen (`BuildFacilitiesModule`), die Planungsspuren, die
   Konfliktprüfung, die Tagesinformationen und die HTTP-Ressource; Tests
   reichen ihre feste Uhr über dieselben Testfabriken.
2. **Vorhandene Teiluhren bleiben, ihr Standard sitzt an einer Stelle.**
   Lebenszyklus, Vertretungen und Betriebstag behalten ihr `now()`; es liest
   `deps.Now` und fällt nur dort auf die echte Uhr zurück. Ein Block, der
   laufend ohne Zeitpunkt angelegt wird, bekommt seinen Start aus der Uhr
   des Aufrufers (`InstanceRows.Now`, im Lebenszyklus dessen Uhr).
3. **Stoppuhr statt Startzeitpunkt.** Die Materialisierung reicht eine
   gemessene Dauer weiter statt ihres Startzeitpunkts (ADR 0240, Punkt 1).
4. **Budgets.** Das Compose-LOC-Budget von `modules/timetable/compose` steigt
   um die vier Importe der Uhrfelder (+4, 1.150 auf 1.154; Summe 13.540 auf
   13.544). `ComposeWorker` wächst um drei Zeilen (347 auf 350), weil gofmt die
   Closure mit dem zusätzlichen Uhrargument umbricht.
5. Die 83 Effekt-Bindungen, deren Körper sich nur durch ihre Uhr geändert
   haben (Stammdaten-Entscheidung der Betreuung, Raumentfernung und
   Raumstatus der Räume, Teilen und Beenden einer Vorlage), sind mit dieser
   ADR neu bestätigt, die 14 Ausnahmen darunter per `approval_adr`. Effekt und
   Einstufung bleiben gleich.

## Folgen

- Das Uhr-Budget fällt von 665 auf 620 Aufrufe; der Eintrag
  `modules/timetable` (45) entfällt.
- `calendarFixtureShiftedLiveDateDebt` verliert alle Einträge unter
  `modules/timetable/`, `modules/timetableblockdisplay/` und
  `test/e2e/timetable/flow_i_staff_move_test.go`: 17 Dateien mit 115 Funden
  (102 auf 85 Dateien, 420 auf 305 Funde). Die Tests stehen auf festen Tagen
  und reichen dieselbe Uhr an Owner, Lebenszyklus und Ressource.
- Die Pass-through-Evidenz verliert `staffNoticeRepository.Acknowledge`, das
  jetzt die Uhr des Stores liest.
