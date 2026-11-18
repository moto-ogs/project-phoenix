---
status: accepted
---

# Care Plan behält seine Altprüfungen

Entscheidung vom 2026-11-18 für
[#7383](https://github.com/moto-ogs/project-phoenix/issues/7383). Sie ergänzt
[ADR 0281](0281-jede-zeitspalte-hat-eine-uhr-trigger-und-spaltenvorgaben-bleiben.md).

Die Datenbank stempelt `cleaned_at` auf der Uhr, mit der sie die Frist für
abgearbeitete Löschaufträge für Schülerdokumente bewacht. `retry_after`
bleibt auf der Uhr von Care Plan, die auch über den nächsten Versuch
entscheidet. Die Liste noch nicht gelöschter Dateien prüft
`file_deleted_at IS NULL`.

Alte Entscheidungen über Abholänderungen haben keine Version der damals
geschriebenen Tageszeilen. Eine Rückfüllung aus dem heutigen Inhalt könnte
eine spätere Änderung des Teams als Teil der Genehmigung ausgeben. Für
diese Entscheidungen bleiben die damaligen Prüfungen für Abholzeit und
Abholart sowie die Rücknahme des Abholhinweises erhalten.

Ein abgeschlossener Altantrag ohne `reviewed_at` bleibt aus dem
Zwei-Monats-Fenster des Elternportals. Der Triggerstempel `updated_at`
kann eine andere Änderung bezeichnen und liegt auf der Datenbankuhr.
Neue Entscheidungen speichern `reviewed_at` auf der Uhr von Care Plan.
