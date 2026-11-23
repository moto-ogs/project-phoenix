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
// day's blocks with their series' planned room, their staff, the room names
// and the day's protocol, one statement each.
func (s *operations) BlockDayChanges(ctx context.Context, accountID int64, isAdmin bool, date calendar.Date) ([]timetable.BlockDayChange, error) {
	viewer, err := s.blockDayViewer(ctx, accountID, isAdmin)
	if err != nil || !viewer.sees {
		return nil, err
	}
	visible, staffByInstance, err := s.visibleBlocks(ctx, viewer, date)
	if err != nil || len(visible) == 0 {
		return nil, err
	}
	reinstated, err := s.reinstatedOn(ctx, date, visible)
	if err != nil {
		return nil, err
	}
	regularRooms := regularRooms(visible)
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
	var staffRows []*scheduleModels.InstanceStaff
	if shared, ok := sharedStaffOf(ctx, date.String()); ok {
		// The Personal source read the day's staff rows already (#7666).
		staffRows = staffOfShared(shared, retainedInstanceIDs(instances))
	} else if staffRows, err = staffOfInstances(ctx, s.deps.InstanceStaff, retainedInstanceIDs(instances)); err != nil {
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
// block itself returns to planned. A re-plan replaces the instance row, so
// template-backed events additionally resolve through their stable slot.
func (s *operations) reinstatedOn(ctx context.Context, date calendar.Date, instances []*scheduleModels.ActivityInstance) (map[int64]bool, error) {
	if s.deps.DeviationEvents == nil {
		return map[int64]bool{}, nil
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
	return reinstatedInstances(instances, events), nil
}

// blockDaySlot identifies a template-backed occurrence independently of its
// materialized row. Re-plans replace that row, while the protocol retains the
// activity group, occurrence date and wall-clock start time.
type blockDaySlot struct {
	activityGroupID int64
	date            calendar.Date
	startTime       string
}

func instanceBlockDaySlot(instance *scheduleModels.ActivityInstance) (blockDaySlot, bool) {
	if instance == nil || instance.ActivityGroupID == nil || *instance.ActivityGroupID <= 0 {
		return blockDaySlot{}, false
	}
	return blockDaySlot{
		activityGroupID: *instance.ActivityGroupID,
		date:            calendar.Date(instance.Date),
		startTime:       calendar.NormalizeWallClock(instance.StartTime).Format("15:04:05"),
	}, true
}

func eventBlockDaySlot(event timetable.DeviationEvent) (blockDaySlot, bool) {
	if event.ActivityGroupID == nil || *event.ActivityGroupID <= 0 || event.OccurrenceDate.IsZero() {
		return blockDaySlot{}, false
	}
	return blockDaySlot{
		activityGroupID: *event.ActivityGroupID,
		date:            event.OccurrenceDate,
		startTime:       calendar.NormalizeWallClock(event.StartTime).Format("15:04:05"),
	}, true
}

// reinstatedInstances transfers the latest cancellation state from the
// protocol to the current rows. Instance IDs retain compatibility for
// one-off blocks; template-backed rows use their stable occurrence slot.
func reinstatedInstances(instances []*scheduleModels.ActivityInstance, events []timetable.DeviationEvent) map[int64]bool {
	states := latestReinstatementStates(events)
	result := make(map[int64]bool)
	for _, instance := range instances {
		if reinstated, found := states.forInstance(instance); found {
			result[instance.ID] = reinstated
		}
	}
	return result
}

type reinstatementStates struct {
	byInstance map[int64]bool
	bySlot     map[blockDaySlot]bool
}

func latestReinstatementStates(events []timetable.DeviationEvent) reinstatementStates {
	states := reinstatementStates{
		byInstance: make(map[int64]bool),
		bySlot:     make(map[blockDaySlot]bool),
	}
	for _, event := range events {
		reinstated, relevant := reinstatementState(event.EventType)
		if !relevant {
			continue
		}
		if event.InstanceID != nil {
			states.byInstance[*event.InstanceID] = reinstated
		}
		if slot, ok := eventBlockDaySlot(event); ok {
			states.bySlot[slot] = reinstated
		}
	}
	return states
}

func reinstatementState(eventType string) (bool, bool) {
	switch eventType {
	case DeviationEventCancellation:
		return false, true
	case DeviationEventReinstatement:
		return true, true
	default:
		return false, false
	}
}

func (states reinstatementStates) forInstance(instance *scheduleModels.ActivityInstance) (bool, bool) {
	if instance == nil {
		return false, false
	}
	if slot, ok := instanceBlockDaySlot(instance); ok {
		if reinstated, found := states.bySlot[slot]; found {
			return reinstated, true
		}
	}
	reinstated, found := states.byInstance[instance.ID]
	return reinstated, found
}

// regularRooms maps each series block to the room its series plans, read
// along with the block (#7675 saved the series read). A block without a
// series (spontaneous or one-off) has no regular room.
func regularRooms(instances []*scheduleModels.ActivityInstance) map[int64]int64 {
	result := map[int64]int64{}
	for _, inst := range instances {
		if inst.ActivityGroupID != nil && !inst.IsSpontaneous && inst.TemplatePlannedRoomID != nil {
			result[inst.ID] = *inst.TemplatePlannedRoomID
		}
	}
	return result
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
