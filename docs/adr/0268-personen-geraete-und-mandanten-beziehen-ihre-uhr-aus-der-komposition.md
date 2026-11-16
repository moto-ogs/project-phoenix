---
status: accepted
---

# Personen, Geräte und Mandanten beziehen ihre Uhr aus der Komposition

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104), Schnitt der
Owner People Directory, Device Fleet, Device Scan, Organisation & Tenancy,
School Structure, School Membership, Facilities und Settings. Sie wendet
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) und
[ADR 0240](0240-stoppuhren-sind-keine-uhr-und-care-plan-bezieht-seine-uhr-aus-der-komposition.md)
auf diese acht Owner an und führt keinen neuen Owner ein.

## Kontext

`TestModuleLiveClockRatchet` zählte in den acht Ownern 47 direkte Aufrufe
der echten Uhr: People Directory 12, Device Fleet 12, Organisation & Tenancy 7,
Device Scan 6, School Structure 3, Settings 3, School Membership 2 und
Facilities 2. Darunter waren Tagesentscheidungen (Rosters, Geburtstage,
Aufbewahrungsfristen, Löschaufträge des Trägers, Vertretungsgruppen des
Aufrufers, Kinderkontingent, Moduswechsel der Anwesenheit), Stempel
(`last_seen`, `updated_at`, Audit-Zeitpunkte) und Zeitangaben in Antworten.
Die Tests dieser Owner konnten keinen festen Tag setzen, und
`calendarFixtureShiftedLiveDateDebt` führte 39 verschobene Live-Daten in
15 Dateien.

`RootEnvironment.Now` war im Produktionsprozess `nil`; jede Komposition
musste den Fall selbst abfangen.

## Entscheidung

1. **Die Wurzel fixiert die Uhr.** `newRootEnvironment` setzt `Now` auf
   `time.Now`, wenn kein Test eine eigene Uhr übergibt. `RootEnvironment.Now`
   ist damit nie `nil`.
2. **Die acht Owner lesen die Uhr aus ihrer Komposition.** Die Wurzel reicht
   `env.Now`/`env.Today` an die Kompositionen weiter (Organisation & Tenancy,
   Provisionierung, School Structure, School Membership, People Directory mit
   Guardian-Service und Retention, Settings, Device-Authentifizierung,
   IoT-Laufzeiten, Facilities-Routen, Geburtstags- und Schülerrouten,
   Operator-Router). Pflichtabhängigkeiten scheitern beim Bau; einen
   Nil-Default auf die echte Uhr haben nur Kompositionen, die Tests heute
   ohne Uhr bauen, und er liegt in der Komposition oder im Konstruktor.
3. **Signaturen, die einen Tag tragen.** Wo ein Port den Tag nicht kannte,
   nimmt er ihn jetzt als Wert: `FindBirthdaysOn` und `StudentBirthdaysOn`
   erhalten den Tag, `ListSubstitutedGroupsToday` die Tagesuhr,
   `NewAuditEntry` den Änderungszeitpunkt. Die IoT-Antworten an PyrePortal
   behalten Felder, Codes und Header; nur die Uhr hinter den Zeitstempeln
   wechselt.
4. **Budgets.** Die Compose-LOC-Budgets steigen nur um die Uhrfelder, ihre
   Importe und die Nil-Defaults: Device Fleet +5, Organisation & Tenancy +9,
   People Directory +6, School Membership +5, School Structure +6,
   Settings +2, Summe 13.540 auf 13.573.
5. Die 59 Effekt-Bindungen, deren Körper oder Aufrufspur sich nur durch ihre
   Uhr geändert haben, sind mit dieser ADR neu bestätigt, die 14 Ausnahmen
   darunter per `approval_adr`. Effekt und Einstufung bleiben gleich.

## Folgen

- Das Uhr-Budget fällt um 47 Aufrufe; die acht Einträge entfallen.
- `calendarFixtureShiftedLiveDateDebt` verliert zehn Dateien mit 27 Funden.
  Zwölf Funde in fünf Dateien bleiben mit Grund: die Datenrückgabe (fünf Funde in drei
  Dateien), weil `platform.data_return_issue` die Aufbewahrungsfrist gegen
  PostgreSQLs `now()` prüft; der Einladungsstatus im Guardian-Service, weil
  Identity & Access offene Einladungen mit eigener Uhr liest; das
  Mitarbeiter-Offboarding (sechs Funde), weil Workforce, Timetable und die
  Wurzelbindung des Offboarding-Workflows ihren Tag selbst lesen.
- People Directorys Rosters und Guardian-Retention leiten nicht mehr nur
  weiter; das Pass-through-Budget sinkt um 2.
- Die übrigen Owner folgen in eigenen Pull Requests nach #7104.
