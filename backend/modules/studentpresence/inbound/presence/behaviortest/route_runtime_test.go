package presence_test

import (
	"context"
	"time"

	presenceAPI "github.com/moto-ogs/project-phoenix/modules/studentpresence/inbound/presence"
	"github.com/moto-ogs/project-phoenix/tenant"
)

func requestRuntimeForTest(withStaff func(context.Context, int64, int64) context.Context) presenceAPI.RequestRuntime {
	return presenceAPI.RequestRuntime{WithStaff: withStaff, TenantID: tenant.FromContext, MarkRollback: tenant.MarkRollback, Now: time.Now}
}
