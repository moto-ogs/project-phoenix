---
status: accepted
---

# Owner beziehen ihre Uhr aus der Komposition

Entscheidung vom 2026-11-15 für
[#4027](https://github.com/moto-ogs/project-phoenix/issues/4027). Sie
ergänzt [ADR 0098](0098-command-effect-binding-flow-and-platform-protocols.md)
um eine Regel für Uhren und bestätigt die Bindungen neu, die sich dadurch
geändert haben.

## Kontext

Backend-Tests brachen alle paar Wochen an einem bestimmten Tag: am
Wochenende, an Feiertagen, bei der Zeitumstellung oder sobald ein festes
Fixture-Datum vorbei war. Ein Lauf der ganzen Suite mit vorgestellter Go- und
PostgreSQL-Uhr an 24 Tagen der nächsten zwölf Monate fand 137 solche Tests.
Die häufigste Ursache: Der Test setzt eine feste Uhr, der Code unter Test
liest aber `time.Now()` oder `calendar.TodayDate()` selbst, obwohl seine
Komposition schon eine Uhr kennt (`Decisions.deps.Today`,
`staffAbsenceService.todayFunc`, `staffDeviations.now`).

Der Effekt-Scan meldete jede durchgereichte Uhr als ungelöste Bindung
(`unresolved:callable:api.now`, `…Dependencies.Today`), und jede neue
brauchte eine Freigabe-ADR. Die gewünschte Änderung kostete damit mehr als
der direkte Aufruf, den sie ersetzt.

## Entscheidung

1. Produktionscode in `modules/` und `workflows/` liest die Uhr aus seiner
   Komposition (`now func() time.Time`, `Today func() calendar.Date`,
   `calendar.CalendarDateClock`). Die Wurzel verdrahtet die echte Uhr, Tests
   einen festen Tag. `TestModuleLiveClockRatchet` zählt die verbleibenden
   direkten Aufrufe je Owner und lässt sie nur fallen.
2. Ein Aufrufbares ohne Parameter mit genau einem Ergebnis vom Typ
   `time.Time` oder `calendar.Date` ist eine Uhr. Der Effekt-Scan folgt ihr
   nicht und meldet sie nicht (`effectFreeClock`). Eine Uhr liest die Zeit
   und schreibt nichts; welche Closure die Wurzel bindet, ändert keinen
   Effekt, den das Inventar festhält. Eine Closure dieses Typs, die doch
   schreibt, bricht die Konvention, die der Typ ausdrückt; das fängt das
   Review, nicht der Scan.
3. Die Bindungen, deren Körper oder Aufrufspur sich nur durch ihre Uhr
   geändert haben, sind mit dieser ADR neu bestätigt. Effekt und Einstufung
   jeder dieser Zeilen bleiben gleich.

## Folgen

- Das Inventar verliert 705 geprüfte `unresolved`-Zeilen, alle Uhren, und
  gewinnt keine.
- 63 Zeilen tragen eine neue Begründung, 14 davon als Ausnahme
  (`E*`, `unresolved`, `debt`) die Freigabe dieser ADR.
- `.github/workflows/clock-early-warning.yml` lässt die Suite jeden Sonntag
  an den kommenden Grenztagen laufen und meldet rote Tests in einem Issue,
  bevor ihr Tag kommt. `docs/agents/backend-testing.md` beschreibt, wie man
  einen Fund nachstellt.
- Die restlichen direkten Aufrufe (Budgets der Ratchet) und die eingefrorenen
  verschobenen Live-Daten in Tests (`calendarFixtureShiftedLiveDateDebt`)
  baut [#7104](https://github.com/moto-ogs/project-phoenix/issues/7104) ab.
