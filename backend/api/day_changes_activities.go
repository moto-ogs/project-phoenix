package api

// The Stundenplan source of "Heute anders" (#7662). Timetable decides which
// blocks the caller sees, with the day plan's rule (PlannedNow): every block
// under the operational overview, otherwise the blocks the caller is planned
// for. The route of the day plan needs schedules:read; without it the source
// answers without entries. The binding names the people and builds one entry
// per change; it carries no reason for a cancellation or an absence.

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// dayChangesBlocks is Timetable's read of the day's changed blocks.
type dayChangesBlocks interface {
	BlockDayChanges(ctx context.Context, accountID int64, isAdmin bool, date calendar.Date) ([]timetable.BlockDayChange, error)
}

// dayChangesActivities is the Stundenplan source.
type dayChangesActivities struct{ sources DayChangesSources }

// Readable is the source's gate: the day plan needs schedules:read.
func (dayChangesActivities) Readable(ctx context.Context) bool {
	granted := sessiontoken.PermissionsFromCtx(ctx)
	return securityruntime.HasAdminWildcard(granted) || securityruntime.HasPermission(permissions.SchedulesRead, granted)
}

func (s dayChangesActivities) ActivityChanges(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	if !s.Readable(ctx) {
		// The day plan is closed to the account; nothing of it is visible.
		return nil, nil
	}
	claims := sessiontoken.ClaimsFromCtx(ctx)
	changes, err := s.sources.Blocks.BlockDayChanges(ctx, int64(claims.ID), claims.IsAdmin, day)
	if err != nil {
		return nil, fmt.Errorf("list changed blocks: %w", err)
	}
	if len(changes) == 0 {
		return nil, nil
	}
	selfID, _, err := s.sources.Caller.CurrentStaffID(ctx)
	if err != nil {
		return nil, fmt.Errorf("resolve caller staff: %w", err)
	}
	names, err := s.staffNames(ctx, changes)
	if err != nil {
		return nil, err
	}
	entries := make([]daychangesview.SourceEntry, 0, len(changes))
	for _, change := range changes {
		entries = append(entries, activityEntries(change, names, selfID)...)
	}
	return entries, nil
}

// staffNames names the substitutes and absent supervisors in one read.
func (s dayChangesActivities) staffNames(ctx context.Context, changes []timetable.BlockDayChange) (map[int64]string, error) {
	ids := map[int64]bool{}
	for _, change := range changes {
		for _, id := range change.SubstituteStaffIDs {
			ids[id] = true
		}
		for _, id := range change.AbsentStaffIDs {
			ids[id] = true
		}
	}
	if len(ids) == 0 {
		return map[int64]string{}, nil
	}
	names, err := s.sources.Names.StaffNames(ctx, sortedIDs(ids))
	if err != nil {
		return nil, fmt.Errorf("resolve staff names: %w", err)
	}
	return names, nil
}

// activityEntries builds one entry per change of a block. A cancelled block
// is only its cancellation; a block that takes place may at once be
// reinstated, moved and covered.
func activityEntries(change timetable.BlockDayChange, names map[int64]string, selfID int64) []daychangesview.SourceEntry {
	entry := func(kind daychangesview.Kind) daychangesview.SourceEntry {
		result := daychangesview.SourceEntry{
			Kind: kind, Involved: change.Involved,
			Activity: &daychangesview.BlockActivity{
				ID: change.InstanceID, Title: change.Title, StartTime: change.StartTime, EndTime: change.EndTime,
			},
			Link: &daychangesview.Link{Target: daychangesview.LinkDayPlan},
		}
		if change.RoomID > 0 {
			result.Room = &daychangesview.BlockRoom{ID: change.RoomID, Name: change.RoomName}
		}
		return result
	}
	if change.Cancelled {
		return []daychangesview.SourceEntry{entry(daychangesview.KindActivityCancelled)}
	}
	entries := make([]daychangesview.SourceEntry, 0, 3)
	if change.Reinstated {
		entries = append(entries, entry(daychangesview.KindActivityReinstated))
	}
	if change.RoomChanged() {
		moved := entry(daychangesview.KindActivityRoomChanged)
		moved.PreviousRoom = &daychangesview.BlockRoom{ID: change.RegularRoomID, Name: change.RegularRoomName}
		entries = append(entries, moved)
	}
	if change.LeadChanged() {
		covered := entry(daychangesview.KindActivityLeadChanged)
		for _, id := range change.SubstituteStaffIDs {
			covered.People = append(covered.People, daychangesview.Person{StaffID: id, Name: names[id], Role: daychangesview.RoleSubstitute, IsSelf: id == selfID})
		}
		for _, id := range change.AbsentStaffIDs {
			covered.People = append(covered.People, daychangesview.Person{StaffID: id, Name: names[id], Role: daychangesview.RoleAbsent, IsSelf: id == selfID})
		}
		entries = append(entries, covered)
	}
	return entries
}
