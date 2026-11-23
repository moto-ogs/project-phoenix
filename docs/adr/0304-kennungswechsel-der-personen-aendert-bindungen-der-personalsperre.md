---
status: proposed
---

# Kennungswechsel der Personen ändert Bindungen der Personalsperre

Entscheidung vom 2026-11-21 für Phase 2 von
[#2342](https://github.com/moto-ogs/project-phoenix/issues/2342) nach
[ADR 0300](0300-kennungen-sind-ein-typ-des-shared-kernel.md). Sie genehmigt
sechs neue Digests bestehender Command-Effect-Bindungen. Sie ändert keinen
Effekt, keine Klassifikation, keinen Owner, keine Policy-Regel und keine
Sperre.

## Kontext

Die Fachtypen von People Directory (`Staff`, `Person` und ihre Schnappschüsse)
tragen Kennungen jetzt als `ident.ID`. Die Wurzel bindet die Personal-Updates
und die Sperre eines Personaldatensatzes (`LockStaff`) an School Membership
und People Directory und wandelt dabei zwischen `ident.ID` und `int64`. Das
ändert den Text der Bindungen und damit ihre Digests. Die Bindungen sind als
`E3` klassifiziert; eine geänderte Bindung dieser Art braucht eine neue
`approval_adr`.

| Port | Ziel | Klasse | Digest |
|---|---|---|---|
| `peopledirectory/ports.StaffRepository.Update` | `schoolmembership.Capability.UpdateStaff` | `E3` | `c32a1efdd9f6873dd94233031126545e` |
| `peopledirectory/ports.StaffRepository.Update` | `schoolmembership.Owner.UpdateStaff` | `E3` | `a702e1a3c515ca20fa0e119f4a518f5f` |
| `workforce.StaffAdminSubjects.LockStaff` | `peopledirectory/ports.PersonRepository.FindByIDForUpdate` | `E3` | `93d984b3dd7d3da493f03f26f9af442a` |
| `workforce.StaffAdminSubjects.LockStaff` | `peopledirectory/ports.StaffRepository.FindByIDForUpdate` | `E3` | `be55a3407e91ce95b5562a99de350d79` |
| `workforce.StaffAdminSubjects.LockStaff` | `schoolmembership.Capability.FindStaffForMutation` | `E3` | `f499f021eba7a802a82a19586c23017f` |
| `workforce.StaffAdminSubjects.LockStaff` | `schoolmembership.Owner.FindStaffForMutation` | `E3` | `9af03ef8f9954a666b6ed6816c2f5eac` |

## Entscheidung

Die Bindungen rufen dieselben Befehle und Sperr-Lesungen in derselben
Reihenfolge auf wie vorher; nur der Go-Typ der Kennungen an der Grenze
wechselt. Ihre Review-Einträge nennen diese ADR als `approval_adr`.
Transaktion, Sperrreihenfolge und Fehlerpfad bleiben unverändert.
