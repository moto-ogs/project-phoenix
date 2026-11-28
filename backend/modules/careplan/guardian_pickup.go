package careplan

import (
	"context"
	"errors"
	"slices"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Pickup permissions of a guardian (#2756). Whether a guardian may collect a
// child, and the note the school keeps about it, belong to Care Plan
// (users.student_guardian_pickup_permissions). The relationship they hang off
// belongs to People Directory; its unit of work creates both halves together
// and holds the relationship row lock while it writes this one.

// ErrGuardianPickupTenantMismatch refuses a command whose school differs from
// the school of the caller's tenant transaction.
var ErrGuardianPickupTenantMismatch = errors.New("care plan: pickup permission belongs to another school")

// GuardianPickupPermission is the pickup half of one relationship.
type GuardianPickupPermission struct {
	TenantID       int64
	RelationshipID int64
	CanPickup      bool
	PickupNotes    *string
}

// GuardianPickupPermissionChange writes only the supplied columns: a nil CanPickup is
// left alone, and PickupNotes is written only when SetPickupNotes is true
// (nil then clears it). Weekdays is written only when SetWeekdays is true:
// the plan weekdays (1 = Monday … 5 = Friday) the permission holds on, nil
// for every day (#4780).
type GuardianPickupPermissionChange struct {
	TenantID       int64
	RelationshipID int64
	CanPickup      *bool
	SetPickupNotes bool
	PickupNotes    *string
	SetWeekdays    bool
	Weekdays       []int
	// Expected makes the write conditional on the permission still having this
	// state. It prevents a request correction from overwriting a later change
	// made by staff.
	Expected *GuardianPickupPermissionState
	// Removed, when set, hears the pickup persons a withdrawal removed in the
	// same transaction (#8206), ordered by day; it is not called when none
	// were. A day before the caller's today may be among them: it was due for
	// the nightly retention and is shown nowhere.
	Removed func([]RemovedPickupDay)
}

// GuardianPickupPermissionState is the safety-relevant portion of a pickup
// permission. Nil weekdays mean that the permission applies every day.
type GuardianPickupPermissionState struct {
	CanPickup bool
	Weekdays  []int
}

// Allows reports whether the permission holds on the plan weekday
// (1 = Monday … 5 = Friday).
func (s GuardianPickupPermissionState) Allows(weekday int) bool {
	return s.CanPickup && (len(s.Weekdays) == 0 || slices.Contains(s.Weekdays, weekday))
}

// RemovedPickupDay is a future day whose pickup person a withdrawn pickup
// permission removed (#8206): the contact no longer may collect the child
// on that day. RequestedByGuardian is the guardian account whose one-day
// request had named the contact, nil for a day the staff set.
type RemovedPickupDay struct {
	StudentID           int64
	Date                calendar.Date
	Name                string
	RequestedByGuardian *int64
}

// GuardianPickupPermissions is the command side of the pickup permission.
// Every command runs in the caller's transaction and names its school
// explicitly, so it also serves the administrative transactions that write
// across schools.
type GuardianPickupPermissions interface {
	// CreateGuardianPickupPermission records the permission of a new
	// relationship.
	CreateGuardianPickupPermission(context.Context, GuardianPickupPermission) error
	// ChangeGuardianPickupPermission writes the supplied columns and reports
	// whether the relationship has a pickup permission in that school. A
	// change that withdraws the permission on some weekdays (or entirely)
	// removes the contact's pickup persons on those weekdays in the same
	// transaction and names them to Removed (#8206).
	ChangeGuardianPickupPermission(context.Context, GuardianPickupPermissionChange) (bool, error)
}

// GuardianPickupPermissionBatches records the pickup halves of many new
// relationships at once (#5552, ADR 0067 addendum of 2026-11-08, point 3:
// part of People Directory's LinkGuardiansToStudents). It is a leaf command
// outside GuardianPickupPermissions; People Directory's root binding asserts
// it.
type GuardianPickupPermissionBatches interface {
	// CreateGuardianPickupPermissions records every permission like
	// CreateGuardianPickupPermission, in the caller's transaction, all or
	// none. Every permission names the caller's school.
	CreateGuardianPickupPermissions(context.Context, []GuardianPickupPermission) error
}
