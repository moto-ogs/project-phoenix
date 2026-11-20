package api

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/devicefleet/deviceauth"

	devicescanCompose "github.com/moto-ogs/project-phoenix/modules/devicescan/compose"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	presenceAPI "github.com/moto-ogs/project-phoenix/modules/studentpresence/inbound/presence"
)

func activeAuthorization() presenceAPI.Authorization {
	return presenceAPI.Authorization{
		OperationalOverview: func(ctx context.Context, settings presenceAPI.Settings, staff presenceAPI.StaffAccess, assignmentBound, admin bool) (bool, error) {
			return securityruntime.CanViewOperationalOverview(ctx, settings, staff, assignmentBound, admin)
		},
	}
}

func activeRequestRuntime(now func() time.Time) presenceAPI.RequestRuntime {
	return presenceAPI.RequestRuntime{
		WithStaff:    deviceauth.WithAttendanceStaff,
		TenantID:     devicescanCompose.AttendanceTenantID,
		MarkRollback: devicescanCompose.MarkAttendanceRollback,
		Now:          now,
	}
}
