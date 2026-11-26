package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	scheduleModels "github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain/schedulerecords"
	"github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ChildBlockDayChanges reads the changed blocks of a day that one child is
// planned on, for the parents' "Heute anders" (#7671). Visibility is the
// child's day plan: the caller has checked the guardian's relationship
// permission before. The changes carry staff only as ids; the consumer names
// nobody. The read is set-based: the child's planned rows of the day, its
// blocks, their staff, the day's protocol and the room names, one statement
// each, and nothing past the first when the child is on no block.
func (s *operations) ChildBlockDayChanges(ctx context.Context, studentID int64, date calendar.Date) ([]timetable.BlockDayChange, error) {
	day := date.String()
	planned, err := s.deps.Participants.Plans.ListInstanceStudents(ctx, timetable.InstanceStudentFilter{StudentIDs: []int64{studentID}, Date: &day})
	if err != nil {
		return nil, fmt.Errorf("child block day changes: planned blocks: %w", err)
	}
	if len(planned) == 0 {
		return nil, nil
	}
	ids := make([]int64, 0, len(planned))
	seen := map[int64]bool{}
	for _, row := range planned {
		if !seen[row.InstanceID] {
			seen[row.InstanceID] = true
			ids = append(ids, row.InstanceID)
		}
	}
	instances, err := s.childBlocks(ctx, ids)
	if err != nil || len(instances) == 0 {
		return nil, err
	}
	staffRows, err := staffOfInstances(ctx, s.deps.InstanceStaff, retainedInstanceIDs(instances))
	if err != nil {
		return nil, err
	}
	staffByInstance := IndexInstanceStaffRows(staffRows)
	reinstated, err := s.reinstatedOn(ctx, date, instances)
	if err != nil {
		return nil, err
	}
	rooms := regularRooms(instances)
	changes := make([]timetable.BlockDayChange, 0)
	for _, inst := range instances {
		if change, ok := blockDayChange(inst, staffByInstance[inst.ID], reinstated[inst.ID], rooms[inst.ID]); ok {
			changes = append(changes, change)
		}
	}
	if len(changes) == 0 {
		return changes, nil
	}
	return changes, s.nameRooms(ctx, changes)
}

// childBlocks reads the child's blocks of the day by id, with the series'
// planned room as every block read carries it.
func (s *operations) childBlocks(ctx context.Context, ids []int64) ([]*scheduleModels.ActivityInstance, error) {
	return listLegacyInstances(ctx, s.deps.Instances, ports.LegacyInstanceFilter{IDs: ids, OrderByDateAndTime: true}, "find child blocks by ids")
}
