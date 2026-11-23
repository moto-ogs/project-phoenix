---
status: accepted
---

# Umbuchung einer Ferienanmeldung reicht den gelesenen Stand durch

Entscheidung vom 2026-11-23 für
[#7904](https://github.com/moto-ogs/project-phoenix/issues/7904), Folge aus
[ADR 0311](0311-ein-speichern-traegt-den-gelesenen-stand.md). Sie genehmigt
eine geänderte Workflow-Bindung. Sie fügt keinen Owner, keine Policy-Regel,
keine Sperre und keinen Effekt hinzu.

## Kontext

Das Träger-Büro bucht ein Kind einer Ferienanmeldung um
(`PUT /traeger/holiday-contributions/{periodId}/registrations/{registrationId}/children/{childId}/bookings`).
Die Route gehört der Elternabrechnung; ihr schmaler Port
`HolidayPlaceChanges.RebookHolidayChild` ist im Root an den Workflow
`holidayallocation.Workflow.RebookHolidayChild` gebunden (ADR 0206). Der
Workflow nimmt die Abrechnungssperre des Zeitraums, dann die Zeile des
Zeitraums, dann lässt er Enrollment umbuchen und die Elternabrechnung die
nachgerückten Geschwistergruppen neu festschreiben.

Nach ADR 0311 schickt eine Umbuchung den Token der Anmeldung, die das Büro
gelesen hat; Enrollment vergleicht ihn unter seinen Sperren. Dafür bekommt
jede Stufe der Bindung einen Parameter mehr. Das Architekturregister führt
diese Bindung als Ausnahme (`workflow`) und verlangt für jede geänderte
Bindung eine in derselben Änderung hinzugefügte ADR.

## Entscheidung

Die Bindung reicht den Token unverändert durch:

- `HolidayPlaceChanges.RebookHolidayChild` und
  `holidayallocation.Workflow.RebookHolidayChild` nehmen `expectedVersion`
  entgegen und geben ihn ohne Prüfung und ohne Übersetzung weiter.
- Enrollment (`HolidayRegistrationReview.RebookHolidayChild`) prüft ihn unter
  der Sperre des Zeitraums und der Anmeldung, bevor es umbucht, und lehnt
  einen anderen oder leeren Token mit `readstate.ErrChanged` ab. Die Bindung
  übersetzt diese Ablehnung nicht.

Sperrreihenfolge, Transaktion, Effekte und Neufestschreibung bleiben, wie
ADR 0206 sie festlegt.

## Folgen

- `api.TestTraegerFreezesReopensAndRebooksHolidayRegistrations` weist die
  Ablehnung eines veralteten und eines leeren Tokens nach;
  `api.TestHolidayAllocationWorkflowTakesTheBillingLockBeforeThePeriod`
  weist die unveränderte Sperrreihenfolge nach.
- Ein Client, der keinen Token schickt, bekommt 409
  `general.changed_since_read`. Das Träger-Portal und der Seeder schicken ihn.
