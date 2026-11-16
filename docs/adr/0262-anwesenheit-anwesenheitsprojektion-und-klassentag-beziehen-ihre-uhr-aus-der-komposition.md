---
status: accepted
---

# Anwesenheit, Anwesenheitsprojektion und Klassentag beziehen ihre Uhr aus der Komposition

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104). Sie wendet
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) und
[ADR 0240](0240-stoppuhren-sind-keine-uhr-und-care-plan-bezieht-seine-uhr-aus-der-komposition.md)
auf Student Presence, Presence Projection und Class Day an. Sie fügt keinen
Owner, keine Policy-Regel, keine Sperre und keine Methode an einer öffentlichen
Capability hinzu.

## Kontext

Die drei Owner lasen die Uhr an 115 Stellen selbst: Student Presence an 86,
Presence Projection an 15, Class Day an 14. Teiluhren gab es schon
(`Dependencies.Now`, `SessionRecordDependencies.Now`, ADR 0101 und ADR 0226 für
Übergabe und Raumanmeldung, `MorningAttendanceDependencies.Now`,
`StudentNoteDependencies.Today`, `ResourceConfig.Now` der Projektion). Der
Postgres-Store, die Aufbewahrung, die Sitzungs- und Besuchsbefehle, die
HTTP-Adapter und die meisten Lesesichten des Klassentags lasen trotzdem
`time.Now()` oder `calendar.TodayDate()`. 16 Testdateien unter
`modules/studentpresence` reichten mit 48 Funden verschobene Live-Daten an den
Code (`calendarFixtureShiftedLiveDateDebt`).

Zwei Entscheidungen lasen dabei zwei Uhren:

- Die Aufbewahrung der Raumbesuche listete die abgelaufenen Kinder über SQL
  `NOW()`, löschte aber mit Stichtagen aus der Go-Uhr.
- Das Beenden offener Aufsichten einer Gruppe wählte die Zeilen nach dem
  Berliner Tag der Go-Uhr und setzte das Enddatum mit SQL `now()`.

## Entscheidung

1. **Student Presence** liest die Uhr aus `Dependencies.Now`. Der Store
   (`postgres.New`) und der Dienst bekommen dieselbe Uhr; der Store schreibt
   `created_at` und `updated_at` daraus. Die Wurzel reicht `env.Now` an den
   Presence-Owner (`BuildPresenceOwner`). Die Aufbewahrung
   (`NewPresenceCleanup`) nimmt statt einer Tagesuhr die Instant-Uhr: Stichtag,
   Löschstempel und Laufzeiten lesen sie. Der Aktiv-Adapter bekommt die Uhr
   über `RequestRuntime.Now`, die Wurzel setzt `env.Now`.
2. **Eine Uhr je Entscheidung.** Die Liste der abgelaufenen Besuche rechnet
   ihr Fenster mit der Uhr des Stores, mit der auch die Löschung rechnet. Das
   Enddatum offener Aufsichten ist der Berliner Tag der Uhr des Stores.
3. **Presence Projection** liest in allen Handlern `ResourceConfig.Now`. Die
   Wurzel setzt es für die Projektion und die Schülerressource der Anwesenheit
   (`mountStudentRoutes`).
4. **Class Day** hat eine Uhr: `MorningAttendanceDependencies.Now`. Tagesbericht,
   Schultag, Aufsichtsblatt, freigegebene Notizen, Fehlzeitenliste,
   Klassenfahrten und Tageshinweise lesen sie; `StudentNoteDependencies.Today`
   bleibt die Tagesuhr der Hinweise und fällt auf diese Uhr zurück. Die
   Slot-Listen bekommen `env.Now`. Die HTTP-Ressource nimmt die Tagesuhr als
   Konstruktorparameter, die Wurzel reicht `ClassDayViews.Today`.
5. **Tests** reichen eine feste Uhr über dieselben Fabriken und rechnen ihre
   Daten von einem festen Montag (2026-11-02) statt vom heutigen Tag.
6. **Bindungen.** Weil die Wurzel ihre Uhr an Student Presence reicht, ändern
   sich die Digests von 28 Care-Plan-Bindungen der Stammdaten-Entscheidung und
   10 Facilities-Bindungen des Schulhofs. Sie sind mit dieser ADR neu
   bestätigt, die 14 Ausnahmen darunter per `approval_adr`. Effekt und
   Einstufung bleiben gleich.

## Folgen

- Das Uhr-Budget fällt von 665 auf 550 Aufrufe; die Einträge von Student
  Presence, Presence Projection und Class Day entfallen.
- `calendarFixtureShiftedLiveDateDebt` fällt von 420 auf 372 Funde und führt
  keine Datei unter `modules/studentpresence` mehr.
- Das Compose-LOC-Budget bleibt unverändert; die Pass-through-Evidenz verliert
  `visitAccessQuery.SupervisedActiveGroupIDs`.
- Die Personalabwesenheiten im Test von Student Presence gehören zu Workforce,
  das seine Uhr in einem eigenen Schnitt bekommt.
