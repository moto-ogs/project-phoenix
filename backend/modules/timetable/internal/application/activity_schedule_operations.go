package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	activityContract "github.com/moto-ogs/project-phoenix/modules/timetable/activitycontract"
)

// ======== Schedule Methods ========

// AddSchedule adds a schedule to an activity group
func (s *ActivityService) AddSchedule(ctx context.Context, groupID int64, schedule *activityContract.Schedule) (*activityContract.Schedule, error) {
	group, err := s.findMutableActivityGroup(ctx, groupID)
	if err != nil {
		return nil, &activityContract.ActivityError{Op: opFindGroup, Err: err}
	}

	// Set group ID
	schedule.ActivityGroupID = groupID
	schedule.SetTenantID(group.GetTenantID())

	// Validate the schedule
	if err := schedule.Validate(); err != nil {
		return nil, &activityContract.ActivityError{Op: opValidateSchedule, Err: err}
	}

	// Create the schedule
	if err := createLegacySchedule(ctx, s.scheduleRepo, schedule); err != nil {
		return nil, &activityContract.ActivityError{Op: "create schedule", Err: err}
	}

	return schedule, nil
}

// GetGroupSchedules retrieves all schedules for a group
func (s *ActivityService) GetGroupSchedules(ctx context.Context, groupID int64) ([]*activityContract.Schedule, error) {
	values, err := s.scheduleRepo.ListSchedules(ctx, timetable.ScheduleFilter{GroupIDs: []int64{groupID}})
	if err != nil {
		return nil, &activityContract.ActivityError{Op: "get group schedules", Err: legacyActivityScheduleError("find by group ID", err)}
	}

	return legacySchedules(values), nil
}

// DeleteSchedule deletes a schedule
func (s *ActivityService) DeleteSchedule(ctx context.Context, id int64) error {
	// Check if schedule exists
	schedule, err := findLegacySchedule(ctx, s.scheduleRepo, id)
	if err != nil {
		if isRepositoryNotFound(err) {
			return &activityContract.ActivityError{Op: "delete schedule", Err: activityContract.ErrScheduleNotFound}
		}
		return &activityContract.ActivityError{Op: "delete schedule", Err: err}
	}
	if _, err := s.findMutableActivityGroup(ctx, schedule.ActivityGroupID); err != nil {
		return &activityContract.ActivityError{Op: "delete schedule", Err: err}
	}

	// Delete the schedule
	if err := deleteLegacySchedule(ctx, s.scheduleRepo, id); err != nil {
		return &activityContract.ActivityError{Op: "delete schedule", Err: err}
	}

	return nil
}
