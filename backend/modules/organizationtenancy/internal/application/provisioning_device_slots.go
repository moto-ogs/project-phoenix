package application

import (
	"context"
	"errors"
	"fmt"
	"net"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/domain"
)

var _ organizationtenancy.DeviceSlotProvisioning = (*Provisioning)(nil)

// SetSchoolDeviceSlots sets the Geräteplätze a school bought (#2312); nil
// removes the limit. A number below the school's registered, not removed
// devices is rejected without changing the limit or any device: a
// commercial change never switches a kiosk off. The per-school Geräteplatz
// lock is held from the count to the write, so no registration slips in
// between. Every change commits only with its operator audit entry; setting
// the number the school already has changes nothing.
func (p *Provisioning) SetSchoolDeviceSlots(ctx context.Context, schoolID int64, slots *int, operatorID int64, clientIP net.IP) error {
	if schoolID <= 0 {
		return invalidData("school id is required")
	}
	if err := organizationtenancy.ValidateDeviceSlots(slots); err != nil {
		return &organizationtenancy.InvalidProvisioningDataError{Err: err}
	}
	_, err := adminValue(ctx, p, func(adminCtx context.Context) (struct{}, error) {
		return struct{}{}, p.setSchoolDeviceSlots(adminCtx, schoolID, slots, operatorID, clientIP)
	})
	return err
}

func (p *Provisioning) setSchoolDeviceSlots(ctx context.Context, schoolID int64, slots *int, operatorID int64, clientIP net.IP) error {
	change, err := p.deviceSlots.SetSchoolDeviceSlots(ctx, schoolID, slots, func(ctx context.Context) (int, error) {
		counts, err := p.devices.CountDevicesByTenant(ctx)
		if err != nil {
			return 0, fmt.Errorf("SetSchoolDeviceSlots: count devices: %w", err)
		}
		return counts[schoolID], nil
	})
	var below *organizationtenancy.DeviceSlotsBelowOccupiedError
	switch {
	case errors.As(err, &below):
		return below
	case errors.Is(err, organizationtenancy.ErrSchoolNotFound):
		return &organizationtenancy.SchoolNotFoundError{SchoolID: schoolID}
	case errors.Is(err, organizationtenancy.ErrSchoolAlreadyDeleted):
		return &organizationtenancy.SchoolAlreadyDeletedError{SchoolID: schoolID}
	case err != nil:
		return fmt.Errorf("SetSchoolDeviceSlots: %w", err)
	case !change.Changed:
		return nil
	}
	return p.recordAction(ctx, operatorID, domain.AuditActionUpdate, domain.AuditResourceSchool, &schoolID, clientIP, map[string]any{
		"device_slots": map[string]any{"old": change.Previous, "new": slots},
		"occupied":     change.Occupied,
	})
}
