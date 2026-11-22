---
status: proposed
---

# Kennungswechsel der Anmeldung ändert die Umbuchungsbindung

Entscheidung vom 2026-11-21 für Phase 2 von
[#2342](https://github.com/moto-ogs/project-phoenix/issues/2342) nach
[ADR 0300](0300-kennungen-sind-ein-typ-des-shared-kernel.md) und
[ADR 0301](0301-kennungswechsel-der-elternabrechnung-aendert-zwei-workflow-bindungen.md).
Sie genehmigt einen neuen Digest einer bestehenden Command-Effect-Bindung. Sie
ändert keinen Effekt, keine Klassifikation, keinen Owner, keine Policy-Regel und
keine Sperre.

## Kontext

ADR 0301 genehmigte die Bindung von `HolidayPlaceChanges.RebookHolidayChild`
an den Workflow `holiday-allocation`, die zwischen den `ident.ID` der
Elternabrechnung und den `int64` der Anmeldung wandelte. Mit der Anmeldung
tragen beide Seiten `ident.ID`; die Umwandlungen in der Bindung entfallen.
Das ändert ihren Digest.

| Port | Ziel | Digest |
|---|---|---|
| `parentbilling/http.HolidayPlaceChanges.RebookHolidayChild` | `holidayallocation.Workflow.RebookHolidayChild` | `6ad9166c90cd13bd7bcf431244583813` |

## Entscheidung

Die Bindung ruft denselben Workflow mit denselben Werten auf; nur die
Umwandlung der Kennungen entfällt. Ihr Review-Eintrag nennt diese ADR als
`approval_adr`. Transaktion, Sperrreihenfolge und Fehlerpfad bleiben die aus
ADR 0206 und ADR 0235.
