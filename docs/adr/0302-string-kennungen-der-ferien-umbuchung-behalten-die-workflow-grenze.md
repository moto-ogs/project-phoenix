---
status: accepted
---

# String-Kennungen der Ferien-Umbuchung behalten die Workflow-Grenze

Entscheidung vom 2026-11-21 für die Korrektur der Ferien-Umbuchung in PR #7772.
Sie setzt [ADR 0300](0300-kennungen-sind-ein-typ-des-shared-kernel.md) für
`parentbilling.HolidayBookingChoice` um: Wochen- und Zeitmodell-Kennungen sind
`ident.ID`. Der Request liest damit Strings und Zahlen, auch oberhalb der
JavaScript-Zahlengenauigkeit. Ungültige und überlaufende Kennungen werden weiter
abgelehnt.

Die Root-Bindung `api.parentBillingPlaceChanges.RebookHolidayChild` wandelt die
beiden Kennungen mit `Int64()` in die Eingabe des bestehenden Workflows um.
Sie übergibt dieselben Werte, Tage und Mittagessen-Angaben an
`holidayallocation.Workflow.RebookHolidayChild`. Berechtigung, Träger-Transaktion,
Sperrreihenfolge, Umbuchung und Beitragsberechnung bleiben die aus
[ADR 0206](0206-ferienplatz-aenderungen-und-neueinfrieren-haben-einen-workflow.md) und
[ADR 0235](0235-ferien-mittagessen-ist-eine-eigene-position-ausserhalb-der-regelkette.md).

Diese ADR bestätigt für den Port
`parentbilling/http.HolidayPlaceChanges.RebookHolidayChild` den Binding-Digest
`4345fae73ec60a5ec732f657ba4f0367`. Die Einstufung bleibt `workflow`, der Effekt
bleibt `mutation`. Es entstehen keine neue Zuständigkeit und keine Policy-Regel.

`TestHolidayRebookingRequestBindsIDs` und
`TestHolidayRebookingRequestRejectsInvalidIDs` prüfen die Request-Grenze.
`TestHolidayPlacesRebookingKeepsTheFrozenContribution` führt die Umbuchung mit
String-Kennungen über HTTP aus und prüft den unveränderten festgehaltenen Beitrag.
