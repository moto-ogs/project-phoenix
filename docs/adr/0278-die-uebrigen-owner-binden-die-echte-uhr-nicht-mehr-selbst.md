---
status: accepted
---

# Die übrigen Owner binden die echte Uhr nicht mehr selbst

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104). Sie wendet
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) und
[ADR 0272](0272-die-echte-uhr-wird-nur-in-wurzeln-und-kompositionen-benannt.md)
auf zwölf Owner an und führt keinen neuen Owner ein.

## Kontext

`moduleLiveClockValueBudget` zählte in zwölf Ownern 16 Stellen, an denen ein
Konstruktor außerhalb der Komposition die echte Uhr als Wert band, meist als
Vorbelegung `if now == nil { now = time.Now }`: Mandanten 3, Personen 3 und je
eine in Datenimport, Geräte, Notfallübersicht, Dateiablage, Planexport,
Schulkalender, Schulsuche, Schulstruktur, Einstellungen und
Aufsichtsübersicht. Eine Wurzel, die keine Uhr reichte, fiel damit still auf
die echte Uhr zurück, und ein Test mit fester Uhr merkte es nicht.

## Entscheidung

1. **Die Uhr ist Pflicht.** Die betroffenen Konstruktoren verlangen ihre Uhr
   und lehnen `nil` ab, statt die echte Uhr vorzubelegen. Die Helfer
   `clockOr` (Datenimport) und `application.Clock` (Dateiablage) sowie die
   Option `WithClock` der Erziehungsberechtigten-Ablage entfallen.
2. **Die Wurzeln reichen die Uhr.** Jede Baustelle in `api`, `roots` und `cmd`
   übergibt `RootEnvironment.Now` oder den daraus abgeleiteten Tag. Die
   Datenrückgabe (`NewDataReturn`, `NewDataReturnRelease`) erhält ihre Uhr als
   Parameter; das CLI bindet `time.Now` an seiner Wurzel.
3. **Termine überlassen `updated_at` dem Trigger.** Die Ablage der Termine
   setzte `updated_at` bei jeder Änderung aus der Go-Uhr, der Trigger
   `update_modified_column()` überschrieb den Wert mit der Datenbankuhr. Die
   Ablage setzt die Spalte nicht mehr; `cancelled_at` und `deleted_at` bleiben
   auf der Uhr der Komposition.
4. **Benannte Ausnahme.** `documentrendering` behält einen direkten Aufruf:
   `records.GeneratedAtLabel` druckt für einen fehlenden Erstellzeitpunkt den
   Moment der Ausgabe, und der Renderer wird auch ohne Abhängigkeiten gebaut.
5. **Budgets.** Das Compose-LOC-Budget steigt um drei Importzeilen:
   `modules/peopledirectory/compose` 1.005 auf 1.006,
   `modules/schoolcalendar/compose` 162 auf 163,
   `modules/schoolsearchview/compose` 38 auf 39, zusammen 13.643 auf 13.646.

## Folgen

- `moduleLiveClockValueBudget` verliert zwölf Einträge (111 auf 95 Verweise).
- `calendarFixtureShiftedLiveDateDebt` verliert
  `modules/peopledirectory/contracttest/guardian_service_test.go`.
- Ein Konstruktor ohne Uhr bricht beim Start ab, statt auf der echten Uhr zu
  laufen.
