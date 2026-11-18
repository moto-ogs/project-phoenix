package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
)

// DeviceHistory reads the history of one device across the schools it went
// through, newest first (#2321). Each entry names its school, so a transfer
// shows the school it left and the school it reached.
func (p *Provisioning) DeviceHistory(ctx context.Context, id int64) ([]organizationtenancy.DeviceHistoryEntry, error) {
	if id <= 0 {
		return nil, invalidData("device id is required")
	}
	return adminValue(ctx, p, func(adminCtx context.Context) ([]organizationtenancy.DeviceHistoryEntry, error) {
		entries, found, err := p.devices.ListDeviceLifecycle(adminCtx, id)
		if err != nil {
			return nil, fmt.Errorf("DeviceHistory: %w", err)
		}
		if !found {
			return nil, &organizationtenancy.OperatorDeviceNotFoundError{DeviceID: id}
		}
		schools, err := p.organizations.ListSchools(adminCtx)
		if err != nil {
			return nil, fmt.Errorf("DeviceHistory: load schools: %w", err)
		}
		names := make(map[int64]string, len(schools))
		for _, school := range schools {
			names[school.ID] = school.Name
		}
		for i := range entries {
			entries[i].SchoolName = names[entries[i].SchoolID]
		}
		return entries, nil
	})
}
