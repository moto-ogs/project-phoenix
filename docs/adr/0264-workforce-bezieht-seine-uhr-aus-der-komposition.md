---
status: accepted
---

# Workforce bezieht seine Uhr aus der Komposition

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104), Schnitt
Workforce. Sie wendet [ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md)
und [ADR 0240](0240-stoppuhren-sind-keine-uhr-und-care-plan-bezieht-seine-uhr-aus-der-komposition.md)
auf Zeiterfassung, Abwesenheiten, Dienstplan und Personalstamm an und führt
keinen neuen Owner und keine neue Policy-Regel ein.

## Kontext

`TestModuleLiveClockRatchet` zählte in `modules/workforce` 62 direkte
Aufrufe von `time.Now()`, `calendar.TodayDate()` und `calendar.Now()`. Die
Zeiterfassungsdienste kannten zwar Felder für eine Testuhr, die Wurzel
setzte sie aber nicht: `BuildWorkSessionSide` übergab weder `Now` noch
`Today`, und jeder Dienst fiel auf die echte Uhr zurück. Dazu lasen
Monatsabschluss, Stundenkonto-Buchungen, Aufbewahrung, Audit-Feed,
Vertretungen, Postgres-Schreibstempel, Träger-Kontingente und die
Jahresvorgabe der Routen die Uhr selbst. Die Monatsrechnung der Übersicht
lief über eine eigene Monatsinstanz, die die Uhr der Übersicht nicht erbte.
Vier Testdateien reichten verschobene Live-Daten an den Code unter Test
(5 Funde in `calendarFixtureShiftedLiveDateDebt`).

## Entscheidung

1. **Eine Uhr für die Zeiterfassung.** `TimeTrackingPorts` tragen `Now` neben
   `Today`. `NewClock` und `NewEmploymentTimeReset` bilden daraus einmal die
   Uhr und den Berliner Tag (`nil` heißt echte Uhr, `Today` folgt sonst
   `Now`) und geben beide an Sitzungen, Monatskarte, Abwesenheiten,
   Stundenkonto, Monatsabschluss, Übersicht, Export und Audit-Feed. Die
   Monatsinstanz der Übersicht übernimmt deren Uhr. Die Aufbewahrung bekommt
   `Now` über `TimeTrackingCleanupDependencies`.
2. **Die Wurzel verdrahtet.** `BuildWorkSessionSide`, die Aufbewahrung, der
   Rücksetzer der Einladung und `BuildServeWorkforce` reichen `env.Now` und
   `env.Today` weiter; das Vertretungs-Repository und die Träger-Routen des
   Personalstamms bekommen `env.Today`. Die Zeiterfassungsrouten lesen den Tag
   aus der zusammengesetzten Zeiterfassung (`TimeTracking.Today`).
3. **Schreibstempel aus derselben Uhr.** Der Postgres-Store stempelt
   Soll-Versionen mit der Uhr seiner Komposition (`Store.WithClock`), der
   Spiegel des Träger-Vertrags mit der Uhr des Personalstamms.
4. **Budgets.** Das Compose-LOC-Budget von `modules/workforce/compose` steigt
   um das Uhrfeld der Aufbewahrung und seinen Import (+2, 928 auf 930,
   Summe 13.540 auf 13.542).
5. Die 28 Bindungen der Stammdaten-Entscheidung von Care Plan und die vier
   Vertretungs-Bindungen von School Structure, deren Aufrufspur jetzt die
   Uhr der Workforce-Komposition liest, sind mit dieser ADR neu bestätigt,
   die 14 E4-Ausnahmen darunter per `approval_adr`. Effekt und Einstufung
   bleiben gleich.

## Folgen

- Das Uhr-Budget fällt von 665 auf 603 Aufrufe; Workforce von 62 auf 0,
  der Eintrag entfällt.
- `calendarFixtureShiftedLiveDateDebt` verliert alle vier Workforce-Dateien
  (5 Funde, 420 auf 415).
- Tests, die den Tag festlegen, erreichen damit auch Monatsabschluss,
  Abwesenheiten und Stundenkonto: Der Monatsabschluss des Träger-Stundenkontos
  rechnet an einem verschobenen Tag mit dem festen Tag des Tests.
- Exportdateien zeigen weiterhin Berliner Zeit; der Zeitstempel kommt jetzt
  aus derselben Uhr.
