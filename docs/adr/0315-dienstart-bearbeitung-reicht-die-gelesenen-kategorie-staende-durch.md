---
status: accepted
---

# Dienstart-Bearbeitung reicht die gelesenen Kategorie-Stände durch

Entscheidung vom 2026-11-24 für
[#7904](https://github.com/moto-ogs/project-phoenix/issues/7904) und
[#7939](https://github.com/moto-ogs/project-phoenix/issues/7939), Folge aus
[ADR 0311](0311-ein-speichern-traegt-den-gelesenen-stand.md). Sie genehmigt
eine geänderte Bindung. Sie fügt keinen Owner, keine Policy-Regel und keinen
Effekt hinzu.

## Kontext

Das Formular einer Dienstart (`PUT /api/shift-types/{id}`) bearbeitet die
Dienstart selbst (Workforce, `schedule.shift_types`) und die
Terminkategorien, die zu ihr gehören. Die Zuordnung steht an den Kategorien
(`activities.categories.shift_type_id`, Timetable). Workforce schreibt sie
über den Linker `activitycontract.ActivityService.SetCategoryShiftTypeLinks`,
im Root an Timetable gebunden. Das Architekturregister führt diese Bindung
als Ausnahme (`debt`, ADR 0098) und verlangt für jede geänderte Bindung eine
in derselben Änderung hinzugefügte ADR.

Nach ADR 0311 speichert das Formular nur über den Stand, den es gelesen hat.
Der Token der Dienstart (`workforce.ShiftTypeVersion`, `updated_at`) deckt
die Zuordnung nicht ab: eine Kategorie wechselt ihre Dienstart, ohne dass die
Zeile der Dienstart sich bewegt. Die Zuordnung in den Token der Dienstart zu
nehmen, hieße, die Kategorien in der Liste der Dienstarten mitzulesen; deren
Abfragebudget (`api.workforce.shift_types.list`) ist exakt und darf nicht
steigen.

## Entscheidung

Die Zuordnung bekommt einen eigenen Token je Kategorie, und der Linker
reicht ihn an Timetable durch:

- Jede Kategorie der Kategorienliste trägt
  `shift_type_link_version` = `timetable.CategoryShiftTypeLinkVersion`, ein
  Fingerabdruck über Kategorie und zugeordnete Dienstart.
- Das Bearbeiten einer Dienstart schickt mit `category_ids` die Tokens aller
  Kategorien, die das Formular beim Öffnen gelesen hat
  (`expected_category_link_versions`).
- `SetCategoryShiftTypeLinks` nimmt sie als `expected` entgegen. Timetable
  sperrt die Kategorien, die die Dienstart hat oder bekommen soll
  (`FOR UPDATE`, aufsteigend), liest sie danach und lehnt mit
  `readstate.ErrChanged` ab, wenn eine Kategorie, deren Zuordnung das
  Speichern ändert, keinen oder einen anderen Token hat. Eine Kategorie,
  deren Zuordnung bleibt, braucht keinen.
- Workforce übergibt beim Bearbeiten immer eine Token-Map, auch eine leere;
  nur das Anlegen einer Dienstart übergibt `nil`: ihr Formular hat keine
  Zuordnung gelesen, die Kategorien sind eine Auswahlliste (ADR 0311, Punkt
  5).
- Sperrreihenfolge: die Zeile der Dienstart (`LockReference`
  `schedule.shift_types`, die Prüfung des Dienstart-Tokens), dann die
  Kategorien (`LockReference` `activities.categories`).

Wirkung und Einordnung der Bindung bleiben, wie ADR 0098 sie führt.

| Port | Bindung | Ziel | Digest |
|---|---|---|---|
| `workforce.ShiftTypeAdministration.CreateShiftType` | `planning.shiftTypeAdministration.CreateShiftType` | `activitycontract.ActivityService.SetCategoryShiftTypeLinks` | `3972a21f8a00f52fc9419f2f41a15e1b` |
| `workforce.ShiftTypeAdministration.UpdateShiftType` | `planning.shiftTypeAdministration.UpdateShiftType` | `activitycontract.ActivityService.SetCategoryShiftTypeLinks` | `3972a21f8a00f52fc9419f2f41a15e1b` |

Liegt diese ADR in der Basis, kann sie keine weitere Änderung der Bindungen
genehmigen. Ein anderer Digest braucht eine neue Genehmigung.

## Folgen

- `TestModuleRefusesShiftTypeLinksChangedSinceRead` (Timetable) weist nach,
  dass eine seit dem Lesen zugeordnete oder ohne Token gesendete Kategorie
  das Speichern ablehnt und nichts schreibt;
  `TestShiftTypeEditHandsTheCategoryLinksTheTokensItRead` (Workforce), dass
  jedes Bearbeiten eine Token-Map übergibt.
- Eine Kategorie, die ein Kollege umbenennt, bewegt den Token ihrer Zuordnung
  nicht; ein Bearbeiten der Kategorie (`PUT /api/activities/categories/{id}`)
  prüft seinen eigenen Token (`timetable.CategoryVersion`).
- Ein Client, der keine Tokens schickt, bekommt 409
  `general.changed_since_read`, sobald sein Speichern eine Zuordnung ändert.
