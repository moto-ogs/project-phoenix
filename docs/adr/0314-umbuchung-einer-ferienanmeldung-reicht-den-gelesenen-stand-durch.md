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

Der Token einer Anmeldung (`holidayRegistrationVersion`) umfasst neben Status,
Angaben und gebuchten Wochen auch die Platzierung jeder Buchung (Platz,
Warteliste, Entscheidung offen). Die Karte der Umbuchung zeigt sie, und das
Büro entscheidet nach ihr, etwa wenn es eine Woche streicht, die es für einen
Wartelistenplatz hält. Rückt eine Buchung nach dem Lesen von der Warteliste
nach oder bekommt sie ihren Platz durch die Vergabe, lehnt Enrollment die
Umbuchung mit 409 `general.changed_since_read` ab, und das Büro sieht die neue
Platzierung. Jeder Schreiber einer Platzierung (Einreichung, Umbuchung,
Stornierung, Kapazität, Vergabe) hält die Sperre des Zeitraums, unter der
Enrollment prüft. Die Position auf der Warteliste gehört nicht zum Token: Sie
verschiebt sich mit anderen Anmeldungen, und keine Umbuchung dieser Anmeldung
entscheidet über sie. Lesen, Antwort eines Speicherns und Prüfung nehmen den
Token aus derselben Funktion über denselben gespeicherten Stand.

Die geänderte Bindung nennt diese ADR als `approval_adr`; Wirkung und
Einordnung bleiben die aus ADR 0206.

| Port | Bindung | Ziel | Digest |
|---|---|---|---|
| `parentbilling/http.HolidayPlaceChanges.RebookHolidayChild` | `api.parentBillingPlaceChanges.RebookHolidayChild` | `holidayallocation.Workflow.RebookHolidayChild` | `5f1ce720c2a5bd7be1b3f32069d7c987` |

Liegt diese ADR in der Basis, kann sie keine weitere Änderung der Bindung
genehmigen. Ein anderer Digest braucht eine neue Genehmigung.

## Folgen

- `api.TestTraegerFreezesReopensAndRebooksHolidayRegistrations` weist die
  Ablehnung eines veralteten und eines leeren Tokens nach;
  `api.TestHolidayAllocationWorkflowTakesTheBillingLockBeforeThePeriod`
  weist die unveränderte Sperrreihenfolge nach.
- `TestHolidayRebookingRefusesAReadBeforeAMoveUp` weist nach, dass eine
  Umbuchung über einen vor dem Nachrücken gelesenen Token abgelehnt wird und
  nichts schreibt.
- Ein Client, der keinen Token schickt, bekommt 409
  `general.changed_since_read`. Das Träger-Portal und der Seeder schicken ihn.
