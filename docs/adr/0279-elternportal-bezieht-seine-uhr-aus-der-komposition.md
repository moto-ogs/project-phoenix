---
status: accepted
---

# Elternportal bezieht seine Uhr aus der Komposition

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104), Schnitt des
Workflows Parent Portal (`workflows/parentportal`) und der Projektion
Parent Request Feed. Sie wendet
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md),
[ADR 0240](0240-stoppuhren-sind-keine-uhr-und-care-plan-bezieht-seine-uhr-aus-der-komposition.md)
und [ADR 0271](0271-die-echte-uhr-wird-nur-in-wurzeln-und-kompositionen-benannt.md)
auf diesen Workflow an und führt keinen neuen Owner ein.

## Kontext

`TestModuleLiveClockRatchet` zählte im Elternportal 19 direkte Aufrufe der
echten Uhr und 3 Bindungen der echten Uhr als Wert außerhalb der Komposition.
Die Kinder- und Nachrichtenabläufe (`internal/care`, `internal/messaging`)
kannten schon ein Feld `Now`, fielen aber auf `calendar.Now` zurück, wenn es
fehlte, und lasen an zehn Stellen trotzdem `time.Now()`: Abwesenheitsmeldung,
Zeitfenster der Entschuldigungs- und Abholanfragen, offene Einladungen,
Stammdatenprotokoll, Erklärungen, Rückmeldefrist und Sichtbarkeit von
Elternmitteilungen. Die HTTP-Schicht las die Uhr für das Ausstellungsdatum der
Nachweise, den Tag des Anmeldeformulars, den Standardzeitraum der
Abwesenheitsliste und `care_ended` der Kinderliste selbst. Ein Test mit fester
Uhr lief damit auf zwei Uhren.

`calendarFixtureShiftedLiveDateDebt` führte 73 verschobene Live-Daten in
15 Testdateien des Elternportals und 2 in 2 Dateien der Projektion Parent
Request Feed.

## Entscheidung

1. **Die Abläufe verlangen eine Uhr.** `care.New` und `messaging.New`
   scheitern ohne `Now`; der Rückfall auf die echte Uhr entfällt.
   `NewResource` der HTTP-Schicht verlangt `ResourceConfig.Now`. Alle
   direkten Aufrufe lesen diese Uhr; `announcementIsLive` und
   `declarationAdmitsAction` erhalten den Zeitpunkt als Wert,
   `parseSickDayRange` und `toChildResponse` den Tag.
2. **Die Wurzel reicht die Uhr.** `BuildParentPortal` und
   `BuildParentDocumentNotices` reichen `env.Now`, `newParentResource` die
   Uhr der Wurzel. `compose.New` belegt eine fehlende Uhr mit `time.Now` vor,
   weil rund 70 Tests das Portal ohne Uhr bauen; diese Vorbelegung steht nur
   in der Komposition (ADR 0271).
3. **Tests auf festem Tag.** Die Tests der 17 Schuldendateien stehen auf
   Montag, dem 24. August 2026 (`careFixtureToday`/`careFixtureNow` und
   Gegenstücke in den Testpaketen), und reichen diese Uhr auch an Care Plans
   Anfragedienst (`WithCareRequestToday`), die Entschuldigungsanfragen
   (`ExcusedRequestTestOptions.Today`, neuer optionaler Uhr-Parameter von
   `api.NewParentRouteTestRepositories`) und Communications Zielgruppe weiter.
   Die Projektion Parent Request Feed liest ab einem festen Zeitpunkt vor
   allen Testzeilen, die PostgreSQL beim Insert stempelt.
4. **Budget.** Das Compose-LOC-Budget von `workflows/parentportal/compose`
   steigt um die drei Zeilen der Vorbelegung (336 auf 339, Summe 13.643 auf
   13.646). Die Uhr selbst war schon Teil der Abhängigkeiten.
5. Keine Effekt-Bindung ändert sich; die Uhr ist nach ADR 0239 effektfrei.

## Folgen

- `moduleLiveClockBudget` und `moduleLiveClockValueBudget` verlieren den
  Eintrag `workflows/parentportal` (19 und 3 auf 0).
- `calendarFixtureShiftedLiveDateDebt` verliert 17 Dateien mit 75 Funden.
- Tests mit Mitteilungen, die Communication auf der echten Uhr veröffentlicht
  und mit PostgreSQLs `now()` filtert, reichen dem Portal ausdrücklich
  `time.Now`; die Testdaten liegen dort auf der echten Uhr.
- Die übrigen Owner folgen in eigenen Pull Requests nach #7104.
