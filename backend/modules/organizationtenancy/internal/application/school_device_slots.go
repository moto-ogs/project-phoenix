package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/domain"
)

var _ organizationtenancy.SchoolDeviceSlotCommand = (*Service)(nil)

// SetSchoolDeviceSlots replaces a live school's Geräteplätze (#2312); nil
// removes the limit. The Geräteplatz lock is taken first and held until the
// caller's transaction ends; occupied counts the school's registered, not
// removed devices under it.
func (s *Service) SetSchoolDeviceSlots(ctx context.Context, id int64, slots *int, occupied func(context.Context) (int, error)) (change organizationtenancy.DeviceSlotChange, err error) {
	if id <= 0 || occupied == nil {
		return organizationtenancy.DeviceSlotChange{}, invalidSchool("school ID and the occupied count are required")
	}
	if err := organizationtenancy.ValidateDeviceSlots(slots); err != nil {
		return organizationtenancy.DeviceSlotChange{}, err
	}
	err = s.run(ctx, "set_school_device_slots", func(txCtx context.Context, stats *domain.OperationStats) error {
		lockStats, lockErr := s.store.LockSchoolDeviceSlots(txCtx, id)
		stats.Add(lockStats)
		if lockErr != nil {
			return lockErr
		}
		existing, found, queryStats, findErr := s.store.FindSchoolByID(txCtx, id, "UPDATE")
		stats.Add(queryStats)
		switch {
		case findErr != nil:
			return findErr
		case !found:
			return organizationtenancy.ErrSchoolNotFound
		case existing.IsDeleted():
			return organizationtenancy.ErrSchoolAlreadyDeleted
		}
		change.Previous = existing.DeviceSlots
		if sameDeviceSlots(existing.DeviceSlots, slots) {
			return nil
		}
		count, countErr := occupied(txCtx)
		if countErr != nil {
			return countErr
		}
		change.Occupied = count
		if slots != nil && *slots < count {
			return &organizationtenancy.DeviceSlotsBelowOccupiedError{SchoolID: id, Requested: *slots, Occupied: count}
		}
		_, queryStats, err = s.store.SetSchoolDeviceSlots(txCtx, id, slots)
		stats.Add(queryStats)
		change.Changed = err == nil
		return err
	})
	return change, err
}

func sameDeviceSlots(current, next *int) bool {
	if current == nil || next == nil {
		return current == nil && next == nil
	}
	return *current == *next
}
