---
status: accepted
---

# Stundenplan, Workforce, Anwesenheit und Klassentag binden die echte Uhr nicht mehr selbst

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104), Schnitt der
Owner Timetable, Workforce, Class Day, Student Presence und Presence
Projection sowie der Wurzelbindung des Mitarbeiter-Offboardings. Sie wendet
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) und
[ADR 0272](0272-die-echte-uhr-wird-nur-in-wurzeln-und-kompositionen-benannt.md)
auf diese Owner an und führt keinen neuen Owner ein.

## Kontext

`moduleLiveClockValueBudget` zählte in den fünf Ownern 30 Stellen, an denen
ein Konstruktor oder eine Methode außerhalb der Komposition die echte Uhr als
Wert band: Timetable 14, Workforce 8, Student Presence 5, Class Day 2 und
Presence Projection 1. Meist war es eine Vorbelegung
(`if now == nil { now = time.Now }`, `clockOrWall`, `application.NewClock`),
in Workforce zusätzlich der Alias `TodayDate = calendar.TodayDate`. Eine
Wurzel, die keine Uhr reichte, fiel still auf die echte Uhr zurück: Die
Wochenprotokolle des Workers, die Abwesenheitsmeldungen und Klassenfahrten
des Klassentags und das Mitarbeiter-Offboarding (`calendar.TodayDate` in
`roots/owners/binding_staffoffboarding.go`) liefen so.

Der Alias verdeckte außerdem 40 verschobene Live-Daten in vier
Workforce-Testdateien, und `calendarFixtureShiftedLiveDateDebt` führte sechs
Funde im Offboarding-Vertragstest. Zwei Testgruppen waren auf
`development` an einem späten Tag (2031-06-02) rot, weil die Testdaten einen
festen Tag annahmen, der Dienst aber die echte Uhr las:
`TestUpdateTemplate_StartDatePullForward_*` (fester „heute“ 2030-08-26) und
`TestWTMMonthSummary_PastFutureCheckOutClampedAtDayEnd` (feste Tagesuhr, aber
echte Uhr für offene Sitzungen).

## Entscheidung

1. **Die Uhr ist Pflicht.** Die Konstruktoren dieser Owner verlangen ihre
   Uhr und lehnen `nil` ab: Timetable (Store `WithClock`, Lebenszyklus,
   Operationen, Abweichungen, Konfliktprüfung, Planungsspuren,
   Vorlagenschreiben und -teilung, Mitteilungen, Ferienhinweise,
   Raumreferenzen, HTTP-Ressource und Wochenprotokolle), Workforce
   (Zeiterfassungsdienste, Export, Bereinigung, Krankmeldungs-Aufbewahrung,
   Schichtplanung), Class Day (`NewClassDay`, Abholungslisten), Student
   Presence (Anwesenheit, Statustage, Statistik, HTTP-Ressourcen) und
   Presence Projection (HTTP-Ressource). Die Helfer `application.NewClock`,
   `NewToday`, `clockOrWall`, `dayOrWall` und der Workforce-Alias entfallen.
2. **Die Kompositionen verlangen die Uhr ebenfalls.** `timetable/compose.New`,
   die Mitteilungen, die Planungsspuren und die Schichtplanung lehnen eine
   fehlende Uhr ab, statt sie vorzubelegen; dafür braucht keine Komposition
   eine neue Zeile. Student Presence behält seine bestehende Vorbelegung in
   der Komposition (ADR 0272 Punkt 1).
3. **Die Wurzeln reichen die Uhr.** Jede Baustelle in `api`, `roots` und
   `cmd` übergibt `RootEnvironment.Now` oder den Tag daraus:
   `WeekProtocolDayLog(env.Now)` für den Worker, die Abwesenheitsmeldungen
   und Klassenfahrten des Klassentags und der Student-Presence-Owner in den
   Wurzeln von Care Plan, Elternanträgen, Reminders, Timetable-Repositories
   und Server.
   Wo keine Umgebung erreichbar ist (CLI-Cleanup, Mitarbeiter-Laufzeit,
   geplante Austritte, Personen-Lesepfade), bindet die Wurzel `time.Now`.
4. **Das Mitarbeiter-Offboarding liest die Uhr der Wurzel.**
   `staffoffboarding/compose.Dependencies` erhält `Now`;
   `NewStaffOffboardingOwners` reicht sie an School Membership, Student
   Presence und Workforce weiter, und `NewStaffOffboarding` bildet daraus den
   Tag des Austritts. Der Vertragstest läuft auf dem 2026-03-11.
5. **Eine Uhr je Entscheidung in den Tests.** Die Monatskarte rechnet offene
   Sitzungen und den Tag aus derselben Uhr; ihre Testdaten setzen beide auf
   den 2026-07-15. Die Vorverlegungs-Tests der Vorlagen setzen die Uhr des
   Timetable-Graphen auf ihren festen Tag. Die Zeiterfassungs- und
   Anwesenheits-Einheitentests laufen auf festen Tagen; die
   Statustag-Ressource der Schüler-Testwurzel liest dieselbe Uhr wie die
   übrigen Ressourcen.
6. **`updated_at` und Trigger.** In Workforce setzt kein UPDATE `updated_at`
   aus Go auf einer Tabelle mit `update_modified_column()`: Die drei
   Go-gestempelten UPDATEs treffen `users.staff_offboarding_cleanup`,
   `active.payroll_dispatches` und `active.staff_work_schedules`, die keinen
   solchen Trigger tragen.
7. **Budgets.** Das Compose-LOC-Budget steigt nur um Uhrzeilen:
   `modules/workforce/compose` 936 auf 937 (der `time`-Import der
   Krankmeldungs-Aufbewahrung), `workflows/staffoffboarding/compose` 74 auf 76
   (das Feld `Now` und sein Import), Summe 13.651 auf 13.654.
8. Die 87 Effekt-Bindungen, deren Körper oder Aufrufspur sich nur durch ihre
   Uhr geändert haben, sind mit dieser ADR neu bestätigt, die 42 Ausnahmen
   darunter per `approval_adr`. Effekt und Einstufung bleiben gleich.

## Folgen

- `moduleLiveClockValueBudget` verliert fünf Einträge (92 auf 62 Verweise).
- `calendarFixtureShiftedLiveDateDebt` verliert
  `modules/peopledirectory/contracttest/staff_offboarding_test.go`.
- Eine Wurzel oder ein Test ohne Uhr scheitert beim Bau, statt auf der echten
  Uhr zu laufen.
- `CompletionTimestamp` des Timetable-Stores liest weiterhin
  `transaction_timestamp()` der Datenbank; das bleibt Thema der
  SQL-Uhr-Phase von #7104.
