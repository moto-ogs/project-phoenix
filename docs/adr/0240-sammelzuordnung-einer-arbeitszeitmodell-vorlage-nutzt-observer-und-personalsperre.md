---
status: proposed
---

# Assigning a work-time template to several people uses the Workforce observer and the staff-row lock

Decision of 2026-11-15 for
[#6921](https://github.com/moto-ogs/project-phoenix/issues/6921). It approves
six new command-effect diagnostics. It adds no owner, no policy rule, no new
lock class and no runtime exception.

## Context

A school assigns one Arbeitszeitmodell-Vorlage to several people at once on
the catalog page (#6921). Workforce serves this through two new methods of
`workforce.WorkTimeModelCatalog` (ADR 0221): `StaffWorkTimeFacts`, which tells
the dialog which people can take the template from which day, and
`AssignWorkTimeModel`, which binds the template and writes the new schedule
versions.

Both run through the service's operation wrapper, which reports to the
injected observer `observe`. The binding-flow scan of
[ADR 0098](0098-command-effect-binding-flow-and-platform-protocols.md) cannot
follow that function value and records
`unresolved:callable:…/workforce/internal/application.observe` with the binding
digest `a4203d183cd9c0f618bb13f73d8c59af` of every approved observer entry.

`AssignWorkTimeModel` takes the staff-row lock of every assignee through the
existing `LockStaffAssignment` dependency, which the root binds to School
Membership's `FindStaffForMutation`. Substitutions, shifts and the other
Workforce writes reach the same target with the same binding digest
`7620f78db126afb1df79e9d96d521520`; ADR 0098 recorded those as `debt` for a
later protocol review. An ADR already in the base cannot approve new
diagnostics.

| Port | Binding | Target |
|---|---|---|
| `workforce.WorkTimeModelCatalog.StaffWorkTimeFacts` | `compose.WorkTime.StaffWorkTimeFacts` | observer |
| `workforce.WorkTimeModelCatalog.AssignWorkTimeModel` | `compose.WorkTime.AssignWorkTimeModel` | observer |
| `workforce.WorkTimeModelCatalog.AssignWorkTimeModel` | `compose.WorkTime.AssignWorkTimeModel` | `schoolmembership.Query.FindStaffForMutation` |
| `compose.WorkTime.StaffWorkTimeFacts` | `application.Service.StaffWorkTimeFacts` | observer |
| `compose.WorkTime.AssignWorkTimeModel` | `application.Service.AssignWorkTimeModel` | observer |
| `compose.WorkTime.AssignWorkTimeModel` | `application.Service.AssignWorkTimeModel` | `schoolmembership.Query.FindStaffForMutation` |

## Decision

Both operations run through the operation wrapper like every template
operation. Their observer diagnostics cite this ADR as `approval_adr`; the
observer only reports measurements.

The assignment first holds the template row `FOR SHARE`. A template edit
updates that row before it reads who is bound and refreshes them, so both
writers take the template before the people. Without this lock an
assignment could copy the old pattern while an edit was still open, and the
edit, reading the bindings before the assignment committed, would leave those
people on the old Soll. Two assignments share the lock and do not wait for
each other.

Then the assignment keeps the lock protocol of a single assignment and of a
template edit (`refreshAssignedSchedules`): every assignee's balance gate,
ascending, then every staff row, ascending, in the caller's unit of work
(the canonical order of `tenant.LockClass`). The staff-row lock is the same
`FindStaffForMutation` the other Workforce writes take; its classification
stays `debt` with the same digest, and the protocol review ADR 0098 names
remains follow-up work for all of them. A liveness read through the existing
`StaffAssignments` port comes first, so an offboarded person is a clean
not-found.

Every other read and write is set-based: one statement each for the bindings,
the Träger's Soll, the schedule history, the closed months, closing the
running versions, the binding upsert on `users.staff_employment_profiles`
(Workforce, #2753) and the new versions. Only the locks are per person (balance
gate, staff row with its profile), as the issue requires; the query budget
`api.workforce.work_time_models.assign` pins the rest for one and for four
people.

After this ADR enters the base it cannot approve another diagnostic. A
changed observer assignment or lock binding changes its digest and needs
fresh approval.
