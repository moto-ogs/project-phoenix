---
status: proposed
---

# Kennungswechsel der Organisation ändert die Bindung der Schulkonten

Entscheidung vom 2026-11-21 für Phase 2 von
[#2342](https://github.com/moto-ogs/project-phoenix/issues/2342) nach
[ADR 0300](0300-kennungen-sind-ein-typ-des-shared-kernel.md). Sie genehmigt drei
neue Digests einer bestehenden Command-Effect-Bindung. Sie ändert keinen Effekt,
keine Klassifikation, keinen Owner, keine Policy-Regel und keine Sperre.

## Kontext

Die Fachtypen von Organization Tenancy tragen Kennungen jetzt als `ident.ID`.
Die Wurzel bindet `ProvisioningIdentity.RegisterSchoolAccount` an Identity &
Access und reicht das angelegte Konto als `TenantAccountInfo` zurück; dessen
`AccountID` ist jetzt ebenfalls `ident.ID`, damit die Struct-Umwandlung in
`organizationtenancy/compose.SchoolAccount` gültig bleibt. Das ändert den Text
der Bindung und damit ihre Digests. Die Bindung ist als `E5` klassifiziert;
eine geänderte Bindung dieser Art braucht eine neue `approval_adr`.

| Port | Ziel | Klasse | Digest |
|---|---|---|---|
| `organizationtenancy/internal/ports.ProvisioningIdentity.RegisterSchoolAccount` | `identityaccess.AccountProvisioning.RegisterSchoolAccount` | `E5` | `25f27a38d202a9776bf907d1989d2620` |
| `organizationtenancy/internal/ports.ProvisioningIdentity.RegisterSchoolAccount` | `identityaccess.Owner.RegisterSchoolAccount` | `E5` | `1c3b4bf35db141a3f039d3c841389a6b` |
| `organizationtenancy/internal/ports.ProvisioningIdentity.RegisterSchoolAccount` | `identityaccess/compose.TenantUnitOfWork.WithTenantID` | `E5` | `3a407e310ef155015d18c17c3d2951c5` |

## Entscheidung

Die Bindung ruft dieselben Befehle von Identity & Access in derselben
Mandanten-Einheit auf wie vorher; nur der Go-Typ der Kontokennung im Ergebnis
wechselt. Ihre Review-Einträge nennen diese ADR als `approval_adr`.
Transaktion, Sperrreihenfolge und Fehlerpfad bleiben unverändert.
