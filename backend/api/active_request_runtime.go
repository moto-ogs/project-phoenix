package api

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/devicefleet/deviceauth"

	devicescanCompose "github.com/moto-ogs/project-phoenix/modules/devicescan/compose"
	presenceAPI "github.com/moto-ogs/project-phoenix/modules/studentpresence/inbound/presence"
)

func activeRequestRuntime(now func() time.Time) presenceAPI.RequestRuntime {
	return presenceAPI.RequestRuntime{
		WithStaff:    deviceauth.WithAttendanceStaff,
		TenantID:     devicescanCompose.AttendanceTenantID,
		MarkRollback: devicescanCompose.MarkAttendanceRollback,
		Now:          now,
	}
}
