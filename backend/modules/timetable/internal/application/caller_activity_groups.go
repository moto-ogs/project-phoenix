package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
)

// CallerActivityGroups serves the Identity & Access caller context the
// planned activity groups a staff member supervises, read from the owner's
// group and planned supervisor capability (#3501).
type CallerActivityGroups struct {
	timetable timetable.Query
}

// NewCallerActivityGroups binds the reads to the owner's capability.
func NewCallerActivityGroups(owner timetable.Query) CallerActivityGroups {
	return CallerActivityGroups{timetable: owner}
}

// SupervisedActivityGroupIDs reads the activity groups a staff member
// supervises as planned.
func (g CallerActivityGroups) SupervisedActivityGroupIDs(ctx context.Context, staffID int64) ([]int64, error) {
	supervisors, err := g.timetable.ListPlannedSupervisors(ctx, timetable.PlannedSupervisorFilter{StaffID: &staffID})
	if err != nil {
		return nil, legacyDatabaseError("find by staff supervisor", err)
	}
	groupIDs := uniqueSupervisorGroupIDs(supervisors)
	if len(groupIDs) == 0 {
		return []int64{}, nil
	}
	groups, err := g.timetable.ListGroups(ctx, timetable.GroupFilter{IDs: groupIDs})
	if err != nil {
		return nil, legacyDatabaseError("find by staff supervisor", err)
	}
	ids := make([]int64, 0, len(groups))
	for _, group := range groups {
		ids = append(ids, group.ID)
	}
	return ids, nil
}
