package application

import (
	"context"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
)

// StaffWorkTimeFacts serves the assignment dialog of the catalog page
// (#6921) in one statement, independent of the number of staff members.
func (s *Service) StaffWorkTimeFacts(ctx context.Context) ([]workforce.StaffWorkTimeFact, error) {
	var facts []domain.StaffWorkTimeFact
	err := s.run(ctx, "staff_work_time_facts", func(ctx context.Context, stats *domain.OperationStats) error {
		values, queryStats, err := s.store.StaffWorkTimeFacts(ctx, s.clock.Today())
		stats.Add(queryStats)
		facts = values
		return err
	})
	if err != nil {
		return nil, MapError(err)
	}
	result := make([]workforce.StaffWorkTimeFact, 0, len(facts))
	for _, fact := range facts {
		result = append(result, workforce.StaffWorkTimeFact(fact))
	}
	return result, nil
}

// AssignWorkTimeModel binds one offered template to several staff members at
// once (#6921). Everything happens in one unit of work: the per-staff balance
// gates and the staff rows are taken ascending, as refreshAssignedSchedules
// and a single assignment take them, so concurrent writers cannot deadlock.
// Members already on the template keep their schedule. Either every other
// member gets the new version or none does.
func (s *Service) AssignWorkTimeModel(ctx context.Context, input workforce.AssignWorkTimeModel) (workforce.WorkTimeModelAssignment, error) {
	if input.ModelID <= 0 {
		return workforce.WorkTimeModelAssignment{}, invalid("work time model ID is required")
	}
	staffIDs, err := domain.NormalizeAssignees(input.StaffIDs, workforce.MaxWorkTimeModelAssignees)
	if err == nil {
		err = domain.ValidateDate(input.ValidFrom, "valid_from")
	}
	if err != nil {
		return workforce.WorkTimeModelAssignment{}, MapError(err)
	}
	var result workforce.WorkTimeModelAssignment
	// The unit of work s.run opens or joins holds every lock and write
	// together, so no second boundary is needed.
	err = s.run(ctx, "assign_work_time_model", func(ctx context.Context, stats *domain.OperationStats) error {
		var writeErr error
		result, writeErr = s.assignWorkTimeModel(ctx, input.ModelID, staffIDs, input.ValidFrom, stats)
		return writeErr
	})
	if err != nil {
		return workforce.WorkTimeModelAssignment{}, MapError(err)
	}
	return result, nil
}

// assignWorkTimeModel is AssignWorkTimeModel inside its unit of work.
func (s *Service) assignWorkTimeModel(ctx context.Context, modelID int64, staffIDs []int64, validFrom string, stats *domain.OperationStats) (workforce.WorkTimeModelAssignment, error) {
	if err := s.lockAssignees(ctx, staffIDs); err != nil {
		return workforce.WorkTimeModelAssignment{}, err
	}
	model, found, modelStats, err := s.store.FindWorkTimeModel(ctx, modelID)
	stats.Add(modelStats)
	if err != nil {
		return workforce.WorkTimeModelAssignment{}, err
	}
	if !found {
		return workforce.WorkTimeModelAssignment{}, domain.ErrWorkTimeModelNotFound
	}
	if model.ArchivedAt != nil {
		return workforce.WorkTimeModelAssignment{}, workforce.ErrWorkTimeModelArchived
	}
	targets, unchanged, err := s.splitAssignees(ctx, model.ID, staffIDs, stats)
	if err != nil {
		return workforce.WorkTimeModelAssignment{}, err
	}
	today := s.clock.Today()
	result := workforce.WorkTimeModelAssignment{Assigned: []int64{}, Unchanged: unchanged, ValidFrom: today}
	if len(targets) == 0 {
		return result, nil
	}
	start, err := s.assignmentStart(ctx, targets, validFrom, today, stats)
	if err != nil {
		return workforce.WorkTimeModelAssignment{}, err
	}
	if err := s.writeAssignedSchedules(ctx, model, targets, start, today, stats); err != nil {
		return workforce.WorkTimeModelAssignment{}, err
	}
	result.Assigned = targets
	result.ValidFrom = start
	return result, nil
}

// lockAssignees refuses a member School Membership no longer holds as live,
// then takes every balance gate and every staff row ascending. The liveness
// read comes first so an unknown or offboarded member is a clean not-found
// rather than a failed lock.
func (s *Service) lockAssignees(ctx context.Context, staffIDs []int64) error {
	live, err := s.assignments.LiveStaffIDs(ctx, staffIDs)
	if err != nil {
		return err
	}
	if len(live) != len(staffIDs) {
		return workforce.ErrStaffEmploymentNotFound
	}
	for _, staffID := range staffIDs {
		if err := s.transaction.LockStaffBalance(ctx, staffID); err != nil {
			return err
		}
	}
	return s.lockAssignmentStaff(ctx, slices.Clone(staffIDs))
}

// splitAssignees separates the members already bound to the template from
// the ones that need it, and refuses the whole request when the Träger keeps
// the Soll of one of them (ADR 0089 section 6).
func (s *Service) splitAssignees(ctx context.Context, modelID int64, staffIDs []int64, stats *domain.OperationStats) (targets, unchanged []int64, err error) {
	bindings, bindingStats, err := s.store.StaffWorkTimeModelBindings(ctx, staffIDs)
	stats.Add(bindingStats)
	if err != nil {
		return nil, nil, err
	}
	targets, unchanged = []int64{}, []int64{}
	for _, staffID := range staffIDs {
		if bindings[staffID] == modelID {
			unchanged = append(unchanged, staffID)
		} else {
			targets = append(targets, staffID)
		}
	}
	kept, keptStats, err := s.store.StaffSollKeptByTraeger(ctx, targets, s.clock.Today())
	stats.Add(keptStats)
	if err != nil {
		return nil, nil, err
	}
	if len(kept) > 0 {
		return nil, nil, workforce.ErrStaffSollKeptByTraeger
	}
	return targets, unchanged, nil
}

// assignmentStart checks a start before today against every member's
// schedule history and closed months in two reads.
func (s *Service) assignmentStart(ctx context.Context, staffIDs []int64, validFrom, today string, stats *domain.OperationStats) (string, error) {
	if validFrom == "" || validFrom == today {
		return today, nil
	}
	history, historyStats, err := s.store.StaffIDsWithScheduleHistory(ctx, staffIDs)
	stats.Add(historyStats)
	if err != nil {
		return "", err
	}
	closed, closedStats, err := s.store.ClosedMonthSnapshotsForStaff(ctx, staffIDs)
	stats.Add(closedStats)
	if err != nil {
		return "", err
	}
	return domain.AssignmentVersionStart(validFrom, today, staffIDs, history, closed)
}

// writeAssignedSchedules closes the running versions at today, binds the
// template with its anchor and writes the template's entries as the new
// version from start: one statement each, whatever the number of members.
func (s *Service) writeAssignedSchedules(ctx context.Context, model domain.WorkTimeModel, staffIDs []int64, start, today string, stats *domain.OperationStats) error {
	closeStats, err := s.store.CloseStaffSchedules(ctx, staffIDs, today)
	stats.Add(closeStats)
	if err != nil {
		return err
	}
	bindStats, err := s.store.BindStaffWorkTimeModel(ctx, staffIDs, model.ID, model.RotationAnchorDate)
	stats.Add(bindStats)
	if err != nil {
		return err
	}
	rows := make([]domain.StaffWorkSchedule, 0, len(staffIDs)*len(model.Entries))
	for _, staffID := range staffIDs {
		for _, entry := range model.Entries {
			rows = append(rows, domain.StaffWorkSchedule{
				StaffID:            staffID,
				WeekIndex:          entry.WeekIndex,
				RotationLength:     model.RotationLength,
				DayOfWeek:          entry.DayOfWeek,
				TargetMinutes:      entry.TargetMinutes,
				StartTime:          entry.StartTime,
				RotationAnchorDate: model.RotationAnchorDate,
				ValidFrom:          start,
			})
		}
	}
	insertStats, err := s.store.InsertStaffSchedules(ctx, rows)
	stats.Add(insertStats)
	return err
}
