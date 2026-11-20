package presence_test

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	presenceAPI "github.com/moto-ogs/project-phoenix/modules/studentpresence/inbound/presence"
	"github.com/moto-ogs/project-phoenix/tenant"
)

func authorizationForTest() presenceAPI.Authorization {
	return presenceAPI.Authorization{
		OperationalOverview: func(ctx context.Context, settings presenceAPI.Settings, staff presenceAPI.StaffAccess, assignmentBound, admin bool) (bool, error) {
			return securityruntime.CanViewOperationalOverview(ctx, settings, staff, assignmentBound, admin)
		},
	}
}

func requestRuntimeForTest(withStaff func(context.Context, int64, int64) context.Context) presenceAPI.RequestRuntime {
	return presenceAPI.RequestRuntime{WithStaff: withStaff, TenantID: tenant.FromContext, MarkRollback: tenant.MarkRollback, Now: time.Now}
}
