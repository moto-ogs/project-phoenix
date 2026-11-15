---
status: accepted
---

# Stoppuhren sind keine Uhr, und Care Plan bezieht seine Uhr aus der Komposition

Entscheidung vom 2026-11-15 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104), erster
Schnitt. Sie ergänzt [ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md)
und führt keinen neuen Owner ein.

## Kontext

`TestModuleLiveClockRatchet` zählte nach ADR 0239 jeden Aufruf von
`time.Now()` im Produktionscode, 1.646 Aufrufe. 935 davon starten nur eine
Latenzmessung: `started := time.Now()` und später `time.Since(started)` für
Metriken und Statistiken. `time.Since` liest die Uhr selbst wieder; eine feste
Testuhr ändert an dieser Messung nichts, und kein Test bricht an einem
bestimmten Tag ihretwegen. Das Budget überzeichnete die Altlast damit um mehr
als die Hälfte.

Care Plan war mit 177 Aufrufen nach Identity & Access und Student Presence
der drittgrößte Owner und stand mit 84 eingefrorenen verschobenen Live-Daten
in Tests an der Spitze von `calendarFixtureShiftedLiveDateDebt`. #7119 hat
parallel Ankunft, Abholung, Lebenszyklus, Angebotswechsel, Entschuldigungen
und Handler verdrahtet (177 auf 139); diese Entscheidung schließt den Rest.

## Entscheidung

1. **Stoppuhren zählen nicht.** Ein `time.Now()`, das einer lokalen Variablen
   zugewiesen wird, die nur als einziges Argument von `time.Since` gelesen
   (oder erneut mit `time.Now()` gestartet) wird, ist keine Uhr im Sinne von
   ADR 0239. Jede andere Verwendung der Variablen (weitergeben, vergleichen,
   speichern) zählt den Aufruf. Hilfsfunktionen, die einen Startzeitpunkt
   entgegennehmen und selbst `time.Since` rechnen, nehmen stattdessen die
   gemessene Dauer.
2. **Care Plan liest die Uhr aus seiner Komposition.** Die Wurzel reicht
   `RootEnvironment.Now`/`Today` an Care Plans Kompositionen (`BuildCarePlanRows`,
   `BuildCarePlanSchedules`, `ComposeCarePlan`, die Entschuldigungen); Tests
   reichen ihre feste Uhr über dieselben Testfabriken. Ankunfts- und
   Abholpläne, Klassen-Ausnahmen, Lebenszyklus, Entschuldigungen,
   Angebotswechsel, Dokumente, Handler und die Schreibstempel der Postgres-
   Adapter lesen diese Uhr. `careplan.Today()` entfällt.
3. **Budgets.** Das Compose-LOC-Budget von `modules/careplan/compose` steigt um
   die Zeilen der Uhrfelder in den Abhängigkeiten (+8, 1.695 auf 1.703); die Verdrahtung folgt
   der Zielarchitektur aus ADR 0239 und ist keine abzubauende Altlast.
4. Die 28 Effekt-Bindungen der Stammdaten-Entscheidung, deren Körper sich
   nur durch ihre Uhr geändert haben (die Wurzel bindet den Berliner Tag
   statt `careplan.Today`), sind mit dieser ADR neu bestätigt, die 14
   Ausnahmen darunter per `approval_adr`. Effekt und Einstufung bleiben
   gleich.

## Folgen

- Das Uhr-Budget fällt von 1.594 auf 672 Aufrufe; Care Plan von 139 auf 1
  (`PickupBaselineQueries.HasBookedOfferingPickupForWeekday`, deren öffentliche
  Methode keinen Tag nennt).
- Care Plans Tests stehen mit #7119 auf festen Tagen und reichen die feste
  Uhr jetzt auch an Lebenszyklus, Entschuldigungen und Stammdaten weiter; das
  Schuldenregister führt keine Care-Plan-Einträge mehr.
- Die übrigen Owner folgen in eigenen Pull Requests nach #7104.
