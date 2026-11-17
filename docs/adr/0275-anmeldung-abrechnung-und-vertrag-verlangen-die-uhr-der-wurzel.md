---
status: accepted
---

# Anmeldung, Abrechnung und Vertrag verlangen die Uhr der Wurzel

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104), Schnitt der
Owner Enrollment, Parent Billing, Care Contract und des Demo-Zugangs von
Identity & Access. Sie wendet
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) und
[ADR 0272](0272-die-echte-uhr-wird-nur-in-wurzeln-und-kompositionen-benannt.md)
auf diese Owner an und führt keinen neuen Owner ein.

## Kontext

`moduleLiveClockValueBudget` zählte in diesen Ownern 31 Stellen, die die
echte Uhr als Wert außerhalb der Komposition banden: Enrollment 24, Parent
Billing 5, Care Contract 1, Identity & Access 1. Fast alle waren
Nil-Defaults in Konstruktoren (`if today == nil { today = calendar.TodayDate }`).
Eine fehlende Uhr der Wurzel fiel deshalb nicht auf, und an mehreren Stellen
lief eine Entscheidung auf zwei Uhren:

- Die öffentliche Ferienanmeldung bekam von der Wurzel nur den Tag. Ihre Uhr
  zum Öffnen versiegelter Nachweise (Konto, Ferienwunsch) war immer die echte
  Uhr, die Nachweise selbst siegelte die Komposition ebenfalls mit der echten
  Uhr, unabhängig vom Tag der Wurzel.
- Die Vorbefüllung der Elternanmeldung bekam gar keine Uhr.
- Die Gast-Hinweise „Gast aus …“ am Kiosk lasen in Produktion den echten Tag,
  weil die Wurzel `nil` übergab.
- Die Belegaufbewahrung lief im Worker und in den Operator-Routen ohne Uhr der
  Wurzel.
- Die Übersichten der Elternabrechnung stempelten ihre Erstellungszeit, der
  DATEV-Export, die Finanzexporte und die SEPA-Lastschrift ihren Zeitpunkt
  mit der echten Uhr, obwohl der Tag von der Wurzel kam.

## Entscheidung

1. **Die Uhr ist Pflicht.** Jeder Konstruktor dieser Owner, der eine Uhr
   nimmt, lehnt `nil` ab (Panik beim Bau, beim Demo-Zugang ein Fehler). Die
   Wurzeln reichen `env.Now`/`env.Today` oder die Uhr ihres Aufrufers; wo
   keine Umgebung erreichbar ist, binden sie die echte Uhr ausdrücklich
   (unverändert: `NewParentContractInboxNotices`).
2. **Eine Uhr je Entscheidung.** Die Ferienanmeldung bekommt die Uhr der
   Wurzel statt nur des Tages und leitet den Tag daraus ab; Konto- und
   Wunschnachweise siegeln mit derselben Uhr, die sie wieder öffnet.
   Der Enrollment-Store stempelt nur mit einer Uhr aus `WithClock`; ein
   Schreibzugriff ohne Uhr ist ein Verdrahtungsfehler. Lesende Stores
   bleiben ohne Uhr.
3. **Signaturen.** Die HTTP-Ressourcen von Enrollment (`NewResource`,
   `NewHolidayPeriodResource`, `NewHolidayHostResource`) nehmen die Uhr im
   Konstruktor statt als nachträglich gesetztes Feld. Der Renderer der
   Elternabrechnung teilt sich in `LetterRenderer` (Briefe, ohne Uhr) und
   `Renderer` (Übersichten, mit Pflicht-Uhr). `NewParentFamilyChildren`
   hält keine Uhr mehr; nur die Liste des Büros liest den Tag. Die Facaden
   der Owner bleiben gleich.
4. **Budgets.** Das Compose-LOC-Budget von `modules/parentbilling/compose`
   steigt um 2 (der `time`-Import der Uhr), Summe 13.641 auf 13.643.
   Enrollment bleibt im Budget.
5. Die 28 Effekt-Bindungen von Care Plan, deren Aufrufspur nur durch die Uhr
   des Enrollment-Stores (`currentTime`) geändert ist, sind mit dieser ADR
   neu bestätigt, die 14 Ausnahmen (E4) darunter per `approval_adr`. Effekt
   und Einstufung bleiben gleich.

## Folgen

- `moduleLiveClockValueBudget` fällt um 31 Verweise (111 auf 80); die vier
  Einträge entfallen. `moduleLiveClockBudget` und
  `calendarFixtureShiftedLiveDateDebt` hatten für diese Owner keine Einträge.
- Tests, die die Dienste bauen, geben jetzt eine Uhr: Unit-Tests eine feste
  (Montag, 16.11.2026), Integrationstests über Live-Fixtures oder über
  Vergleiche mit PostgreSQLs `now()` die echte Uhr ausdrücklich.
- Ein vergessener Uhrparameter einer neuen Wurzel scheitert beim Start statt
  still auf der echten Uhr zu laufen.
