---
status: accepted
---

# School Membership verwendet die Uhr der Wurzel

Entscheidung vom 2026-11-18 für
[#7383](https://github.com/moto-ogs/project-phoenix/issues/7383). Sie ergänzt
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) und
[ADR 0281](0281-jede-zeitspalte-hat-eine-uhr-trigger-und-spaltenvorgaben-bleiben.md).

`NewSchoolMembership` gibt die optionale Uhr als `Now` an den Owner.
Die Komposition leitet daraus den Berliner Kalendertag ab. Der Adapter
liest dieselbe Uhr für die Zeitpunkte, die School Membership stempelt,
etwa `users.teachers.deleted_at`. Ohne vorgegebene Uhr verwendet die
Komposition die Systemzeit. Datenbankseitig gestempelte Spalten behalten
ihre Datenbankuhr.

Die Freigabe bestätigt die 42 neu erzeugten Digests in Care Plan,
Facilities und School Structure. Darunter sind 14 E4-Bindungen, deren
`approval_adr` diese Entscheidung nennt. Die Prüfung umfasst die bestehende
Mandantengrenze, die Sperren, den Transaktionsrahmen und die Einstufung
jeder Bindung.
