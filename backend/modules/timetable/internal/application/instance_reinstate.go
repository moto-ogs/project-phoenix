package application

import (
	"context"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	scheduleModel "github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain/schedulerecords"
	"github.com/moto-ogs/project-phoenix/modules/timetable/ports"
)

// Reinstate takes back the cancellation of one block (#7151): cancelled →
// planned. It accepts a block that was planned or already running when it
// was cancelled, as long as it still exists and has not ended. The
// cancellation discarded a running block's session; the block returns as
// planned, and starting it opens a new session. The protocol records the reinstatement, the
// planned staff hear "findet doch statt" in the same transaction, and the
// tenant gets the planned-instance signal its open plans refetch on. It runs
// in the caller's tenant transaction, which the route opens.
func (s *InstanceLifecycleService) Reinstate(ctx context.Context, instanceID int64, actorAccountID *int64) (*timetable.LifecycleInstance, error) {
	if !s.hasTx(ctx) {
		return nil, &ports.ScheduleError{Op: "reinstate instance", Err: errors.New("requires the tenant transaction")}
	}
	instance, err := s.reinstatableInstance(ctx, instanceID)
	if err != nil {
		return nil, err
	}
	oldValue := map[string]any{"status": scheduleModel.InstanceStatusCancelled}
	if instance.CancelReason != nil {
		oldValue["cancel_reason"] = *instance.CancelReason
	}
	instance.Status = scheduleModel.InstanceStatusPlanned
	instance.CancelReason = nil
	if err := s.updateLifecycleColumns(ctx, instance, "status", "cancel_reason"); err != nil {
		return nil, &ports.ScheduleError{Op: "reinstate instance: update", Err: err}
	}
	if err := s.logDeviationEvent(ctx, deviationEventInput{
		instance:       instance,
		eventType:      DeviationEventReinstatement,
		oldValue:       oldValue,
		newValue:       map[string]any{"status": scheduleModel.InstanceStatusPlanned},
		actorAccountID: actorAccountID,
	}); err != nil {
		return nil, err
	}
	if err := s.noticeStaffOfReinstatement(ctx, instance, actorAccountID); err != nil {
		return nil, err
	}
	s.broadcastPlannedInstanceChanged(ctx, "instance_reinstate")
	return LifecycleInstanceOf(instance), nil
}

// reinstatableInstance loads a cancelled block under its day lock, the lock
// Cancel and the staffing saves take, and decides on the re-read row. A
// block removed by a delete or a bulk cancellation is not found.
func (s *InstanceLifecycleService) reinstatableInstance(ctx context.Context, instanceID int64) (*scheduleModel.ActivityInstance, error) {
	instance, err := s.loadForTransition(ctx, instanceID)
	if err != nil {
		return nil, err
	}
	instance, err = s.lockDayAndReload(ctx, instance, "reinstate instance")
	if err != nil {
		return nil, err
	}
	if instance.Status != scheduleModel.InstanceStatusCancelled {
		return nil, fmt.Errorf("%w: cannot reinstate instance in status %q", timetable.ErrInvalidInstanceTransition, instance.Status)
	}
	end := timetable.LifecycleBoundary(instance.Date, instance.EndTime)
	if !end.After(timetable.LifecycleBoundary(instance.Date, instance.StartTime)) {
		// A block without an end after its start runs until the end of its day.
		end = instance.Date.EndOfDay()
	}
	if !s.now().Before(end) {
		return nil, timetable.ErrInstanceReinstateEnded
	}
	return instance, nil
}
