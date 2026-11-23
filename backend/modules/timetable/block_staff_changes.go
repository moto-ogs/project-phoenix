package timetable

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// BlockStaffChange is a block of a day that takes place and on which a
// planned supervisor is marked absent or somebody covers (#7675, "Heute
// anders"). Staff lists every staff row of the block, also the unchanged
// ones: they say who is planned on it. It carries no reason for an absence.
type BlockStaffChange struct {
	InstanceID int64
	Title      string
	// StartTime and EndTime are the block's wall clock, "HH:MM".
	StartTime string
	EndTime   string
	Staff     []BlockStaffRow
}

// BlockStaffRow is one staff member on a changed block.
type BlockStaffRow struct {
	StaffID    int64
	Absent     bool
	Substitute bool
	// SickReport marks an absence the cascade of a sick report set: the
	// staff member is absent for the day, not for this block alone.
	SickReport bool
}

// BlockStaffChangeQuery reads the blocks of a day with an absent or covering
// supervisor, for the whole school, in one statement. It applies no
// visibility: the Personal source of "Heute anders" applies its own rule
// (ADR 0299, addendum #7659).
type BlockStaffChangeQuery interface {
	BlockStaffChanges(ctx context.Context, date calendar.Date) ([]BlockStaffChange, error)
}

// ErrNoBlockStaffChanges reports an operational day without the read.
var ErrNoBlockStaffChanges = errors.New("timetable operations: the operational day reads no block staff changes")

// BlockStaffChangesOf is the read of the blocks with staff changes of an
// operational day the owner composed.
func BlockStaffChangesOf(day OperationCapability) (BlockStaffChangeQuery, error) {
	changes, ok := day.(BlockStaffChangeQuery)
	if !ok {
		return nil, ErrNoBlockStaffChanges
	}
	return changes, nil
}

// DayStaffShare holds the staff rows of one day, each with its block, for
// the block reads of one "Heute anders" request (#7666, the query budget of
// the route): BlockStaffChanges takes every row of the day once,
// BlockDayChanges filters them instead of a statement of its own. Only the
// owner's reads fill it.
type DayStaffShare struct {
	Day  string
	Rows []InstanceStaff
	Read bool
}

type dayStaffShareKey struct{}

// WithDayStaffShare marks a request whose block reads share the day's staff
// rows. The rows live as long as the context; the root scopes it to one
// read-only transaction.
func WithDayStaffShare(ctx context.Context) context.Context {
	return context.WithValue(ctx, dayStaffShareKey{}, &DayStaffShare{})
}

// DayStaffShareOf returns the request's share, if the root set one.
func DayStaffShareOf(ctx context.Context) (*DayStaffShare, bool) {
	share, ok := ctx.Value(dayStaffShareKey{}).(*DayStaffShare)
	return share, ok
}
