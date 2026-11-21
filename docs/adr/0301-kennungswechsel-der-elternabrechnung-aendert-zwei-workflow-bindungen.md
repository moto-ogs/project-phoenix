---
status: proposed
---

# Kennungswechsel der Elternabrechnung ändert zwei Workflow-Bindungen

Entscheidung vom 2026-11-21 für Phase 2 von
[#2342](https://github.com/moto-ogs/project-phoenix/issues/2342) nach
[ADR 0300](0300-kennungen-sind-ein-typ-des-shared-kernel.md). Sie genehmigt zwei
neue Digests bestehender Command-Effect-Bindungen. Sie ändert keinen Effekt,
keine Klassifikation, keinen Owner, keine Policy-Regel und keine Sperre.

## Kontext

Die Fachtypen der Elternabrechnung tragen Kennungen jetzt als `ident.ID`, damit
Go sie als JSON-String sendet. Die Wurzel bindet zwei Schreibports des
`http`-Pakets an den Workflow `holiday-allocation` und wandelt dabei zwischen
`ident.ID` und den `int64` des Workflows (`.Int64()`, `ident.ID(…)`,
`ident.IDs(…)`). Das ändert den Text der Bindung und damit ihren Digest. Die
Bindungen sind als `workflow` klassifiziert; eine geänderte Bindung dieser Art
braucht eine neue `approval_adr`.

| Port | Ziel | Digest |
|---|---|---|
| `parentbilling/http.HolidayPlaceChanges.RebookHolidayChild` | `holidayallocation.Workflow.RebookHolidayChild` | `24f2f75f0f63ee9818d69787f8651150` |
| `parentbilling/http.HolidayPlaceChanges.SetHolidayWeekCapacity` | `holidayallocation.Workflow.SetHolidayWeekCapacity` | `7282681ffbd5c71a13f4f5fc61b3c43a` |

## Entscheidung

Beide Bindungen rufen denselben Workflow mit denselben Werten auf wie vorher;
nur der Go-Typ der Kennungen an der Grenze wechselt. Ihre Review-Einträge nennen
diese ADR als `approval_adr`. Transaktion, Sperrreihenfolge und Fehlerpfad
bleiben die aus ADR 0206 und ADR 0235.
