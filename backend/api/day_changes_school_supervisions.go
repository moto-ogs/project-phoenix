package api

// The Aufsichten source of "Heute anders" in moto schule (#8148): a cover on
// a block of the Lehrkraft's own Aufsichten. She takes a block over, or
// somebody takes her block over. Timetable owns the blocks and their staff
// rows. The rule of moto schule stands on its own: an entry needs
// supervision:own, the right of the page Aufsichten, and the caller's own
// row on the block. No colleague is named, no staff ID of a colleague and
// no reason leave this file; the only person of an entry is the caller.
//
// Timetable reads these blocks and the classes' changed Unterrichtsschluss
// in one statement; both sources of a savepoint share it, so the query
// budget of the route does not grow.

import (
	"context"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// schoolDayChangesSavepoints runs the sources like the staff portal's and
// lets the sources of one savepoint share Timetable's read of the day.
type schoolDayChangesSavepoints struct{}

func (schoolDayChangesSavepoints) Run(ctx context.Context, read func(context.Context) error) error {
	return dayChangesSavepoints{}.Run(ctx, func(ctx context.Context) error {
		return read(context.WithValue(ctx, schoolDayMemoKey{}, &schoolDayMemo{}))
	})
}

func (schoolDayChangesSavepoints) IsFatal(err error) bool {
	return dayChangesSavepoints{}.IsFatal(err)
}

type schoolDayMemoKey struct{}

// schoolDayMemo holds Timetable's read of one day for the sources of one
// savepoint. A failed read is not kept: the next savepoint reads again.
type schoolDayMemo struct {
	day     calendar.Date
	staffID int64
	changes timetable.SchoolDayChanges
	read    bool
}

// schoolDayChangesRead is Timetable's read of the day for the caller's
// staff record.
type schoolDayChangesRead struct {
	caller schoolDayChangesCaller
	query  timetable.SchoolDayChangeQuery
}

// read returns the day's class changes and the changed blocks the caller is
// on, with the caller's staff ID (0 without a staff record, which reads no
// blocks).
func (r schoolDayChangesRead) read(ctx context.Context, day calendar.Date) (timetable.SchoolDayChanges, int64, error) {
	memo, _ := ctx.Value(schoolDayMemoKey{}).(*schoolDayMemo)
	if memo != nil && memo.read && memo.day == day {
		return memo.changes, memo.staffID, nil
	}
	staffID, err := r.caller.StaffID(ctx)
	switch {
	case errors.Is(err, identityaccess.ErrCallerNotLinkedToStaff), errors.Is(err, identityaccess.ErrCallerNotLinkedToPerson):
		staffID = 0
	case err != nil:
		return timetable.SchoolDayChanges{}, 0, fmt.Errorf("resolve caller staff: %w", err)
	}
	changes, err := r.query.SchoolDayChanges(ctx, day, staffID)
	if err != nil {
		return timetable.SchoolDayChanges{}, 0, fmt.Errorf("list school day changes: %w", err)
	}
	if memo != nil {
		*memo = schoolDayMemo{day: day, staffID: staffID, changes: changes, read: true}
	}
	return changes, staffID, nil
}

// schoolDayChangesSupervisions is the Aufsichten source.
type schoolDayChangesSupervisions struct{ day schoolDayChangesRead }

func (s schoolDayChangesSupervisions) SupervisionChanges(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	if !securityruntime.HasPermission(permissions.SupervisionOwn, sessiontoken.PermissionsFromCtx(ctx)) {
		// The account has no Aufsichten of its own: no entries, not a failure.
		return nil, nil
	}
	changes, staffID, err := s.day.read(ctx, day)
	if err != nil {
		return nil, err
	}
	if staffID == 0 {
		return nil, nil
	}
	entries := []daychangesview.SourceEntry{}
	for _, block := range changes.Blocks {
		people, ok := supervisionCover(block, staffID)
		if !ok {
			continue
		}
		entry := daychangesview.SourceEntry{
			Kind: daychangesview.KindBlockSubstitution, Involved: true, People: people,
			Activity: &daychangesview.BlockActivity{ID: ident.ID(block.InstanceID), Title: block.Title},
			Link:     &daychangesview.Link{Target: daychangesview.LinkSchoolSupervisions},
		}
		entry.StartsAt, entry.EndsAt = wallClockInstants(day, block.StartTime, block.EndTime)
		entries = append(entries, entry)
	}
	return entries, nil
}

// supervisionCover names the cover on one of the caller's blocks: the
// caller takes it over, or somebody takes it over for the caller. Only the
// caller is named; a cover for the caller is "somebody" without a name and
// without a staff ID. A block the caller misses without a cover, and a
// colleague's absence or cover on the caller's block, are no entry.
func supervisionCover(block timetable.BlockStaffChange, selfID int64) ([]daychangesview.Person, bool) {
	var self *timetable.BlockStaffRow
	covered := false
	for i, row := range block.Staff {
		if row.StaffID == selfID {
			self = &block.Staff[i]
		} else if row.Substitute && !row.Absent {
			covered = true
		}
	}
	switch {
	case self == nil:
		return nil, false
	case self.Substitute && !self.Absent:
		return []daychangesview.Person{{StaffID: ident.ID(selfID), Role: daychangesview.RoleSubstitute, IsSelf: true}}, true
	case self.Absent && covered:
		return []daychangesview.Person{
			{Role: daychangesview.RoleSubstitute},
			{StaffID: ident.ID(selfID), Role: daychangesview.RoleReplaced, IsSelf: true},
		}, true
	default:
		return nil, false
	}
}
