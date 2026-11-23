---
status: proposed
---

# Mensa-Schreibwege sperren das Kind ohne Schlüsselsperre

Entscheidung vom 2026-11-23 für
[#7904](https://github.com/moto-ogs/project-phoenix/issues/7904) (PR #7956).
Sie genehmigt neun neue Command-Effect-Diagnosen und zwei neue
Durchreicher-Methoden. Sie fügt keinen Owner, keine Policy-Regel und keine neue
Sperrklasse hinzu.

## Kontext

Jeder Schreibweg einer Mensa-Anmeldung hält die Zeile des Kindes
(`users.student_profiles`), während er auf die Bestellsperre der Schule
(`meal-orders:<schule>`) wartet: die Schule über `mealplan.StudentLock`, die
Eltern über den Kind-Wächter des Elternportals. Wer die Bestellsperre hält (der
Worker beim Festschreiben, der Schreibweg eines anderen Kindes beim Nachtragen
offener Änderungen), fügt Bestellzeilen und -änderungen des Kindes ein. Deren
Fremdschlüssel nimmt eine Schlüsselsperre (`FOR KEY SHARE`) auf dieselbe
Kinderzeile. `FOR UPDATE` verweigert sie: beide warten aufeinander, PostgreSQL
bricht einen mit 40P01 ab. `api.TestMealWritesLetTheOrderLockHolderReferenceTheChild`
weist das für die Schule und die Eltern nach.

## Entscheidung

Die Mensa-Schreibwege sperren die Kinderzeile `FOR NO KEY UPDATE`:

- People Directory bietet `StudentKeyShareLock.LockStudentNoKeyUpdate` neben
  seiner Fassade an (wie `StudentRowLocks`; die Fassade wächst nicht) und
  `StudentSnapshotReads.StudentSnapshotForNoKeyUpdate`, dieselben Wege wie
  `LockStudent` und `StudentSnapshotForUpdate`, nur mit dieser Sperrstärke;
- die Wurzel bindet `mealplan.StudentLock` an `LockStudentNoKeyUpdate` des
  Directory-Owners und bricht beim Zusammensetzen ab, wenn er fehlt;
- der Kind-Wächter des Elternportals nimmt sie für Mensa-Schreibwege
  (`ChildWriteAccess.NoKeyUpdate`), die Betreuungsprüfung danach ebenso.

`FOR NO KEY UPDATE` wartet auf jede andere Sperre und Änderung der Zeile; die
Schreibwege eines Kindes bleiben in derselben Reihenfolge (Kind, feste Tage,
Bestellung) nacheinander. Es lässt nur die Schlüsselsperre eines Fremdschlüssels
durch. Eine Löschung des Kindes wartet weiter, weil `DELETE` die Zeile stärker
sperrt. Andere Schreiber behalten `FOR UPDATE`: wer sich darauf verlässt, dass
während seiner Sperre keine neue Zeile auf das Kind verweist, ändert sich nicht.

Die neuen Methoden erreichen dieselben nicht auflösbaren Ziele wie ihre
`FOR UPDATE`-Gegenstücke, mit denselben Digests. Ihre Diagnosen nennen diese
ADR als `approval_adr`; Wirkung und Einordnung sind die der Gegenstücke.

| Port | Bindung | Ziel | Digest |
|---|---|---|---|
| `peopledirectory.StudentKeyShareLock.LockStudentNoKeyUpdate` | `application.Service.LockStudentNoKeyUpdate` | `application.observe` | `6cdc81b797832cc1539502ea4216aa98` |
| `peopledirectory.StudentSnapshotReads.StudentSnapshotForNoKeyUpdate` | `ports.StudentRepository.StudentSnapshotForNoKeyUpdate` | `compose.StudentClassWriteGate` | `c6ab471024aa3df81ffba3b732ca5909` |
| `peopledirectory.StudentSnapshotReads.StudentSnapshotForNoKeyUpdate` | `ports.StudentRepository.StudentSnapshotForNoKeyUpdate` | `application.observe` | `6cdc81b797832cc1539502ea4216aa98` |
| `ports.StudentRepository.StudentSnapshotForNoKeyUpdate` | `application.StudentRecords.StudentSnapshotForNoKeyUpdate` | `compose.StudentClassWriteGate` | `c6ab471024aa3df81ffba3b732ca5909` |
| `ports.StudentRepository.StudentSnapshotForNoKeyUpdate` | `application.StudentRecords.StudentSnapshotForNoKeyUpdate` | `application.observe` | `6cdc81b797832cc1539502ea4216aa98` |
| `ports.StudentRepository.StudentSnapshotForNoKeyUpdate` | `owners.OverlappingRosterGroupNames.StudentSnapshotForNoKeyUpdate` | `compose.StudentClassWriteGate` | `c6ab471024aa3df81ffba3b732ca5909` |
| `ports.StudentRepository.StudentSnapshotForNoKeyUpdate` | `owners.OverlappingRosterGroupNames.StudentSnapshotForNoKeyUpdate` | `application.observe` | `6cdc81b797832cc1539502ea4216aa98` |
| `ports.StudentRepository.StudentSnapshotForNoKeyUpdate` | `owners.groupStudentRepository.StudentSnapshotForNoKeyUpdate` | `compose.StudentClassWriteGate` | `c6ab471024aa3df81ffba3b732ca5909` |
| `ports.StudentRepository.StudentSnapshotForNoKeyUpdate` | `owners.groupStudentRepository.StudentSnapshotForNoKeyUpdate` | `application.observe` | `6cdc81b797832cc1539502ea4216aa98` |

Zwei neue Methoden sind Durchreicher im Sinn von ADR 0075 und nennen diese ADR
als `decision`: `application.Service.LockStudentNoKeyUpdate` und
`parentportal.portalStudentReads.FindByIDForNoKeyUpdate`, je in der Form ihres
registrierten Gegenstücks. `StudentRecords.FindByIDForUpdate` und
`care.Service.RequireCareRunningForUpdate` rufen jetzt eine gemeinsame Methode
für beide Sperrstärken auf und sind keine Durchreicher mehr; ihre Einträge
entfallen.

## Verworfen

- **Alle Schülersperren auf `FOR NO KEY UPDATE`.** Löschungen und Aufräumwege,
  die während ihrer Sperre keine neuen verweisenden Zeilen erwarten, verlören
  diese Zusage.
- **Bestellsperre vor der Kinderzeile.** Der Kind-Wächter des Elternportals
  sperrt das Kind vor jedem Schreibweg; die Schule müsste dieselbe Reihenfolge
  nehmen, sonst entsteht der Deadlock zwischen Schule und Eltern wieder.
- **Kinderzeilen vor der Bestellsperre im Worker sperren.** Welche Kinder eine
  Bestellung erreicht, steht erst unter der Bestellsperre fest.

Liegt diese ADR in der Basis, kann sie keine weitere Diagnose genehmigen.
