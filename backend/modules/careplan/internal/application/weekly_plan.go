package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

var _ careplan.WeeklyPlans = (*PickupAdjustments)(nil)

// WeeklyPlanVersion reads the token of the child's stored weekly plan
// (careplan.WeeklyPlanVersion). The editor reads it with the plan and every
// save of the plan checks it under the student lock.
func (s *PickupAdjustments) WeeklyPlanVersion(ctx context.Context, studentID int64) (string, error) {
	filter := careplan.StudentScheduleFilter{StudentIDs: []int64{studentID}}
	arrivals, err := s.deps.Records.ListArrivalSchedules(ctx, filter)
	if err != nil {
		return "", fmt.Errorf("weekly plan: read arrival schedules: %w", err)
	}
	pickups, err := s.pickupRows(ctx, studentID)
	if err != nil {
		return "", fmt.Errorf("weekly plan: read pickup schedules: %w", err)
	}
	notes, err := s.deps.Records.ListPickupNotes(ctx, filter)
	if err != nil {
		return "", fmt.Errorf("weekly plan: read pickup notes: %w", err)
	}
	return careplan.WeeklyPlanVersion(arrivals, pickups, notes), nil
}

// SaveWeeklyPlan replaces the weekly arrival plan and the weekday notes,
// each when given, in one unit. Under the student lock every plan writer takes,
// the stored plan must still be the one read at ExpectedVersion; otherwise
// nothing is written and readstate.ErrChanged is returned. It answers the
// token of the saved plan.
func (s *PickupAdjustments) SaveWeeklyPlan(ctx context.Context, input careplan.WeeklyPlanInput) (string, error) {
	var version string
	err := s.deps.UnitOfWork.RunInTenantTx(ctx, func(txCtx context.Context) error {
		if err := s.lockAndCheckWeeklyPlan(txCtx, input.StudentID, nil, input.ExpectedVersion); err != nil {
			return err
		}
		if input.ArrivalSchedules != nil {
			if err := s.deps.ArrivalSchedules.UpsertBulkStudentArrivalSchedules(txCtx, input.StudentID, *input.ArrivalSchedules); err != nil {
				return fmt.Errorf("weekly plan: update arrival schedules: %w", err)
			}
		}
		if err := s.replaceWeekdayNotes(txCtx, input.StudentID, input.CreatedByStaffID, input.WeekdayNotes); err != nil {
			return err
		}
		var readErr error
		version, readErr = s.WeeklyPlanVersion(txCtx, input.StudentID)
		return readErr
	})
	if err != nil {
		s.deps.UnitOfWork.MarkRollback(ctx)
		return "", err
	}
	return version, nil
}

// lockAndCheckWeeklyPlan takes the student lock, re-checks the caller against
// the locked student and compares the stored plan with the token the caller
// read. An empty token is refused like a changed one.
func (s *PickupAdjustments) lockAndCheckWeeklyPlan(
	ctx context.Context,
	studentID int64,
	authorize func(context.Context, careplan.ScheduleStudent) (bool, error),
	expectedVersion string,
) error {
	student, err := s.deps.Students.LockStudent(ctx, studentID)
	if err != nil || student == nil {
		return careplan.ErrPickupAdjustmentStudentNotFound
	}
	if authorize != nil {
		allowed, authorizeErr := authorize(ctx, *student)
		if authorizeErr != nil || !allowed {
			return careplan.ErrPickupAdjustmentUnauthorized
		}
	}
	current, err := s.WeeklyPlanVersion(ctx, studentID)
	if err != nil {
		return err
	}
	return readstate.Check(expectedVersion, current)
}

// replaceWeekdayNotes writes the recurring weekday notes of a saved plan; nil
// leaves them as they are.
func (s *PickupAdjustments) replaceWeekdayNotes(ctx context.Context, studentID, createdBy int64, notes map[int]string) error {
	if notes == nil {
		return nil
	}
	if err := s.deps.Records.ReplaceWeekdayPickupNotes(ctx, studentID, createdBy, notes); err != nil {
		return fmt.Errorf("weekly plan: replace weekday notes: %w", err)
	}
	return nil
}
