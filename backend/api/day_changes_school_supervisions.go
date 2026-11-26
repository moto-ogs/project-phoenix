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

// schoolDayMemo holds the caller and Timetable's read of one day for the
// sources of one savepoint. A failed read is not kept: the next savepoint
// reads again.
type schoolDayMemo struct {
	caller     schoolDayCaller
	callerRead bool
	day        calendar.Date
	changes    timetable.SchoolDayChanges
	dayRead    bool
}

// schoolDayCaller is the caller's staff record (0 without one, which reads
// no blocks and no appointments) and the classes assigned to it.
type schoolDayCaller struct {
	staffID int64
	classes []string
}

// schoolDayCallerRead resolves the caller: the person from Identity &
// Access, then the staff record and its classes in one School Membership
// statement (#8155).
type schoolDayCallerRead struct {
	person schoolDayChangesCaller
	staff  schoolDayChangesStaff
}

func (r schoolDayCallerRead) resolve(ctx context.Context) (schoolDayCaller, error) {
	memo, _ := ctx.Value(schoolDayMemoKey{}).(*schoolDayMemo)
	if memo != nil && memo.callerRead {
		return memo.caller, nil
	}
	caller, err := r.read(ctx)
	if err != nil {
		return schoolDayCaller{}, err
	}
	if memo != nil {
		memo.caller, memo.callerRead = caller, true
	}
	return caller, nil
}

func (r schoolDayCallerRead) read(ctx context.Context) (schoolDayCaller, error) {
	person, err := r.person.Person(ctx)
	switch {
	case errors.Is(err, identityaccess.ErrCallerNotLinkedToPerson):
		return schoolDayCaller{}, nil
	case err != nil:
		return schoolDayCaller{}, fmt.Errorf("resolve caller person: %w", err)
	}
	staffID, classes, found, err := r.staff.FindStaffClassesByPerson(ctx, person.ID)
	if err != nil {
		return schoolDayCaller{}, fmt.Errorf("resolve caller staff: %w", err)
	}
	if !found {
		return schoolDayCaller{}, nil
	}
	return schoolDayCaller{staffID: staffID, classes: classes}, nil
}

// schoolDayChangesRead is Timetable's read of the day for the caller's
// staff record.
type schoolDayChangesRead struct {
	caller schoolDayCallerRead
	query  timetable.SchoolDayChangeQuery
}

// read returns the day's class changes and the changed blocks the caller is
// on, with the caller.
func (r schoolDayChangesRead) read(ctx context.Context, day calendar.Date) (timetable.SchoolDayChanges, schoolDayCaller, error) {
	caller, err := r.caller.resolve(ctx)
	if err != nil {
		return timetable.SchoolDayChanges{}, schoolDayCaller{}, err
	}
	memo, _ := ctx.Value(schoolDayMemoKey{}).(*schoolDayMemo)
	if memo != nil && memo.dayRead && memo.day == day {
		return memo.changes, caller, nil
	}
	changes, err := r.query.SchoolDayChanges(ctx, day, caller.staffID)
	if err != nil {
		return timetable.SchoolDayChanges{}, schoolDayCaller{}, fmt.Errorf("list school day changes: %w", err)
	}
	if memo != nil {
		memo.day, memo.changes, memo.dayRead = day, changes, true
	}
	return changes, caller, nil
}

// schoolDayChangesSupervisions is the Aufsichten source.
type schoolDayChangesSupervisions struct{ day schoolDayChangesRead }

func (s schoolDayChangesSupervisions) SupervisionChanges(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	if !securityruntime.HasPermission(permissions.SupervisionOwn, sessiontoken.PermissionsFromCtx(ctx)) {
		// The account has no Aufsichten of its own: no entries, not a failure.
		return nil, nil
	}
	changes, caller, err := s.day.read(ctx, day)
	if err != nil {
		return nil, err
	}
	staffID := caller.staffID
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
