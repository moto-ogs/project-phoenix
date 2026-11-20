package application

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	scheduleModels "github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain/schedulerecords"
	"github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// BlockDayChanges reads the blocks of a day that do not run as planned, for
// "Heute anders" (#7662). Visibility is the day plan's (PlannedNow): the
// operational overview sees every block of the school, everyone else the
// blocks they are planned for. A caller without a staff record and without
// the overview sees nothing; that is no error. The read is set-based: the
// day's blocks, their staff, their series, the room names and the day's
// protocol, one statement each.
func (s *operations) BlockDayChanges(ctx context.Context, accountID int64, isAdmin bool, date calendar.Date) ([]timetable.BlockDayChange, error) {
	viewer, err := s.blockDayViewer(ctx, accountID, isAdmin)
	if err != nil || !viewer.sees {
		return nil, err
	}
	visible, staffByInstance, err := s.visibleBlocks(ctx, viewer, date)
	if err != nil || len(visible) == 0 {
		return nil, err
	}
	reinstated, err := s.reinstatedOn(ctx, date)
	if err != nil {
		return nil, err
	}
	regularRooms, err := s.regularRooms(ctx, visible)
	if err != nil {
		return nil, err
	}
	changes := make([]timetable.BlockDayChange, 0)
	for _, inst := range visible {
		change, ok := blockDayChange(inst, staffByInstance[inst.ID], reinstated[inst.ID], regularRooms[inst.ID])
		if !ok {
			continue
		}
		change.Involved = viewer.planned(staffByInstance[inst.ID])
		changes = append(changes, change)
	}
	if len(changes) == 0 {
		return changes, nil
	}
	return changes, s.nameRooms(ctx, changes)
}

// blockDayViewer is what the day plan's rule needs to know of the caller.
type blockDayViewer struct {
	staffID  int64
	hasStaff bool
	overview bool
	// sees is false for a caller without a staff record and without the
	// overview: the day plan shows such a caller nothing.
	sees bool
}

func (v blockDayViewer) planned(rows []*scheduleModels.InstanceStaff) bool {
	return v.hasStaff && staffPlanned(rows, v.staffID)
}

func (s *operations) blockDayViewer(ctx context.Context, accountID int64, isAdmin bool) (blockDayViewer, error) {
	staffID, hasStaff, err := s.resolveStaffID(ctx, accountID)
	if errors.Is(err, timetable.ErrTimetableOperationForbidden) {
		return blockDayViewer{}, nil
	}
	if err != nil {
		return blockDayViewer{}, err
	}
	overview, err := s.operationalOverview(ctx, isAdmin, hasStaff)
	if err != nil {
		return blockDayViewer{}, err
	}
	return blockDayViewer{staffID: staffID, hasStaff: hasStaff, overview: overview, sees: hasStaff || overview}, nil
}

// visibleBlocks reads the day's blocks with their staff and keeps those the
// caller sees on the day plan.
func (s *operations) visibleBlocks(ctx context.Context, viewer blockDayViewer, date calendar.Date) ([]*scheduleModels.ActivityInstance, map[int64][]*scheduleModels.InstanceStaff, error) {
	instances, err := instancesOn(ctx, s.deps.Instances, date)
	if err != nil {
		return nil, nil, err
	}
	staffRows, err := staffOfInstances(ctx, s.deps.InstanceStaff, retainedInstanceIDs(instances))
	if err != nil {
		return nil, nil, err
	}
	staffByInstance := IndexInstanceStaffRows(staffRows)
	visible := make([]*scheduleModels.ActivityInstance, 0, len(instances))
	for _, inst := range instances {
		if viewer.overview || viewer.planned(staffByInstance[inst.ID]) {
			visible = append(visible, inst)
		}
	}
	return visible, staffByInstance, nil
}

// staffPlanned reports any staff row of the caller on the block: planned,
// covering or marked absent. An absent supervisor still learns who covers.
func staffPlanned(rows []*scheduleModels.InstanceStaff, staffID int64) bool {
	for _, row := range rows {
		if row.StaffID == staffID {
			return true
		}
	}
	return false
}

// blockDayChange maps one block; ok is false for a block that runs as
// planned. A cancelled block reports only its cancellation: who would have
// covered and where no longer matters.
func blockDayChange(inst *scheduleModels.ActivityInstance, staff []*scheduleModels.InstanceStaff, reinstated bool, regularRoomID int64) (timetable.BlockDayChange, bool) {
	change := timetable.BlockDayChange{
		InstanceID: inst.ID, Title: inst.Title, RoomID: inst.RoomID,
		StartTime: calendar.NormalizeWallClock(inst.StartTime).Format("15:04"),
		EndTime:   calendar.NormalizeWallClock(inst.EndTime).Format("15:04"),
	}
	if inst.Status == scheduleModels.InstanceStatusCancelled {
		change.Cancelled = true
		return change, true
	}
	change.Reinstated = reinstated
	if regularRoomID > 0 && inst.RoomID > 0 && regularRoomID != inst.RoomID {
		change.RegularRoomID = regularRoomID
	}
	for _, row := range staff {
		switch {
		case row.IsAbsent:
			change.AbsentStaffIDs = append(change.AbsentStaffIDs, row.StaffID)
		case row.IsSubstitute:
			change.SubstituteStaffIDs = append(change.SubstituteStaffIDs, row.StaffID)
		}
	}
	return change, change.Reinstated || change.RoomChanged() || change.LeadChanged()
}

// reinstatedOn names the blocks of the day whose last cancellation event in
// the protocol is a reinstatement. The protocol is the only record of it: the
// block itself returns to planned.
func (s *operations) reinstatedOn(ctx context.Context, date calendar.Date) (map[int64]bool, error) {
	result := map[int64]bool{}
	if s.deps.DeviationEvents == nil {
		return result, nil
	}
	events, err := s.deps.DeviationEvents.ListDeviationEvents(ctx, date, date, nil, nil)
	if err != nil {
		return nil, &ports.ScheduleError{Op: "block day changes: read protocol", Err: err}
	}
	sort.SliceStable(events, func(i, j int) bool {
		if !events[i].OccurredAt.Equal(events[j].OccurredAt) {
			return events[i].OccurredAt.Before(events[j].OccurredAt)
		}
		return events[i].ID < events[j].ID
	})
	for _, event := range events {
		if event.InstanceID == nil {
			continue
		}
		switch event.EventType {
		case DeviationEventCancellation:
			result[*event.InstanceID] = false
		case DeviationEventReinstatement:
			result[*event.InstanceID] = true
		}
	}
	return result, nil
}

// regularRooms maps each series block to the room its series plans. A block
// without a series (spontaneous or one-off) has no regular room.
func (s *operations) regularRooms(ctx context.Context, instances []*scheduleModels.ActivityInstance) (map[int64]int64, error) {
	seriesIDs := make([]int64, 0, len(instances))
	seen := map[int64]bool{}
	for _, inst := range instances {
		if inst.ActivityGroupID == nil || inst.IsSpontaneous || seen[*inst.ActivityGroupID] {
			continue
		}
		seen[*inst.ActivityGroupID] = true
		seriesIDs = append(seriesIDs, *inst.ActivityGroupID)
	}
	result := map[int64]int64{}
	if len(seriesIDs) == 0 {
		return result, nil
	}
	series, err := listLegacyGroups(ctx, s.deps.Templates, timetable.GroupFilter{IDs: seriesIDs}, "block day changes: series")
	if err != nil {
		return nil, err
	}
	planned := make(map[int64]int64, len(series))
	for _, group := range series {
		if group != nil && group.PlannedRoomID != nil {
			planned[group.ID] = *group.PlannedRoomID
		}
	}
	for _, inst := range instances {
		if inst.ActivityGroupID != nil && !inst.IsSpontaneous {
			result[inst.ID] = planned[*inst.ActivityGroupID]
		}
	}
	return result, nil
}

// nameRooms names the current and the regular rooms in one read.
func (s *operations) nameRooms(ctx context.Context, changes []timetable.BlockDayChange) error {
	names, err := s.deps.Rooms.AllRoomNames(ctx)
	if err != nil {
		return fmt.Errorf("block day changes: room names: %w", err)
	}
	for i := range changes {
		changes[i].RoomName = names[changes[i].RoomID]
		if changes[i].RegularRoomID != 0 {
			changes[i].RegularRoomName = names[changes[i].RegularRoomID]
		}
	}
	return nil
}
