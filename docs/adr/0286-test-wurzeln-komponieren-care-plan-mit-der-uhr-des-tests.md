---
status: accepted
---

# Test-Wurzeln komponieren Care Plan mit der Uhr des Tests

Entscheidung vom 2026-11-17 für
[#7295](https://github.com/moto-ogs/project-phoenix/issues/7295). Sie wendet
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) auf die
Test-Wurzeln von Care Plan an und führt keinen neuen Owner ein.

## Kontext

`owners.NewCarePlan` (Build-Tag `testhooks`) band `Now: time.Now`, auch wenn
der Testgraph eine Uhr bekam. Die Schüler-Testwurzel reichte ihre Uhr an
Anwesenheit, Stundenplan und Einstellungen, nicht aber an die Persistenz von
Care Plan. Ein Test, der Go- und Datenbankuhr auseinanderlegen wollte,
stempelte die Anfragen deshalb trotzdem mit der echten Uhr: Der Verlaufstest
aus ADR 0281 (`TestAggregatedChangeRequests_HistoryOrdersSourcesOnOneClock`)
blieb auch mit den alten, auf der Owner-Uhr stempelnden Schreibern grün.

## Entscheidung

1. `owners.NewCarePlan` und `owners.NewUnobservedCarePlan` nehmen höchstens
   eine Uhr an; ohne Uhr bleibt es die echte.
2. `api.NewActiveTestModule` und die Schüler-Testwurzel
   (`NewStudentTestRepositories`, `NewStudentTestRepositoriesWithMembers`)
   reichen ihre Uhr an Care Plan weiter. Ein Test mit fester Uhr stempelt
   damit auch die Care-Plan-Zeilen auf dieser Uhr.
3. Die 28 Effekt-Bindungen von Care Plan (Stammdaten-Entscheidung,
   -Korrektur, Klassenfolge und Konfliktlösung), deren Aufrufspur sich nur
   durch diese Uhr geändert hat, sind mit dieser ADR neu bestätigt, die 14
   Ausnahmen darunter per `approval_adr`. Effekt und Einstufung bleiben
   gleich.

## Folgen

- Der Verlaufstest und `TestRecentlyDecidedWindowUsesOwnerClock` prüfen die
  Trennung der Uhren auch ohne `scripts/fake-clock.sh`.
- Produktionswurzeln ändern sich nicht.
