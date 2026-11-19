---
status: accepted
---

# Geschlecht aus der Einladung nutzt den Beobachter der Stammdaten

Entscheidung vom 2026-11-18. Sie genehmigt eine neue Command-Effect-Diagnose.
Sie fügt keinen Owner, keine Policy-Regel, keine Sperre und keine
Laufzeitausnahme hinzu.

## Kontext

Die Schule kann beim Einladen neuer Mitarbeitender das Geschlecht angeben
(`auth.invitation_tokens.gender`). Nimmt die Person die Einladung an, schreibt
Identity & Access es über den bestehenden Port `EmploymentResetCommands` in die
Stammdaten. Workforce bietet dafür den neuen Befehl
`workforce.EmploymentResetter.ApplyInvitedGender`. Er setzt das Geschlecht über
den bestehenden, protokollierten Abschnitt „Person“ der Stammdaten
(`UpdateStaffStammdatenPerson`), genau wie eine Bearbeitung im Personalbogen,
und läuft nur in der Transaktion der Annahme.

Dieser Weg meldet seine Messwerte an den Beobachter
`modules/workforce/internal/application.observe`. Der Binding-Flow-Scan aus
[ADR 0098](0098-command-effect-binding-flow-and-platform-protocols.md) kann
diesen Funktionswert nicht verfolgen und verzeichnet `unresolved:callable:…`.
Für `EmploymentResetter.ResetEmployment` ist dieselbe Diagnose schon genehmigt
([ADR 0176](0176-command-effects-folgen-owner-internen-interfaces-in-ihre-bindungen.md)). Eine ADR,
die schon in der Basis liegt, kann keine neue Diagnose genehmigen.

| Port | Ziel | Digest |
|---|---|---|
| `workforce.EmploymentResetter.ApplyInvitedGender` | `application.observe` | `a4203d183cd9c0f618bb13f73d8c59af` |

## Entscheidung

`ApplyInvitedGender` verwendet den bestehenden Stammdaten-Abschnitt unverändert.
Seine Diagnose nennt diese ADR als `approval_adr`. Der Beobachter liefert nur
Messwerte, erreicht keinen Zustand eines anderen Owners, nimmt keine Sperre und
erweitert keinen Scope. Der Digest ist derselbe wie beim genehmigten Eintrag von
`ResetEmployment`, die Zuordnung des Beobachters bleibt also gleich.

Die übrigen neuen Einträge brauchen keine Genehmigung: Identity & Access ruft
`ApplyInvitedGender` als Leaf-Befehl nach ADR 0067 auf (eigene Prüfung und
Protokollierung in Workforce, Transaktion der Annahme, nur die eigene Sperre der
Personalzeile), und Workforce erreicht People Directory und die Tenant-Runtime
wie bei `ResetEmployment`.

Ein eigener Schreibweg ohne Beobachter würde die Protokollierung der Stammdaten
doppeln. Den Scanner so zu erweitern, dass er den Funktionswert auflöst, gehört
nicht zu dieser Änderung.

Liegt diese ADR in der Basis, kann sie keine weitere Diagnose genehmigen. Eine
geänderte Zuordnung ändert den Digest und braucht eine neue Genehmigung.
