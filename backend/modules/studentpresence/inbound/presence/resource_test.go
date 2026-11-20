package presence

import (
	"context"
	"log/slog"
	"testing"
	"time"

	settingsFacts "github.com/moto-ogs/project-phoenix/modules/settings"

	"github.com/moto-ogs/project-phoenix/api/testutil"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// resourceForTest initializes policies and logging while allowing each handler test to
// supply only the collaborators its path calls.
func resourceForTest(resource Resource) *Resource {
	resource.logger = slog.Default()
	resource.displaySettings = settingsFacts.NewDisplaySettings(resource.SettingsService)
	resource.authorization = authorizationForTest()
	resource.runtime.TenantID = tenant.FromContext
	resource.runtime.MarkRollback = tenant.MarkRollback
	if resource.runtime.Now == nil {
		resource.runtime.Now = time.Now
	}
	return &resource
}

func authorizationForTest() Authorization {
	return Authorization{
		OperationalOverview: func(ctx context.Context, settings Settings, staff StaffAccess, assignmentBound, admin bool) (bool, error) {
			return securityruntime.CanViewOperationalOverview(ctx, settings, staff, assignmentBound, admin)
		},
	}
}

func requestRuntimeForTest(withStaff func(context.Context, int64, int64) context.Context) RequestRuntime {
	return RequestRuntime{WithStaff: withStaff, TenantID: tenant.FromContext, MarkRollback: tenant.MarkRollback, Now: time.Now}
}

func TestResourceRequiresLogger(t *testing.T) {
	t.Parallel()
	require.PanicsWithValue(t, "active API: logger is required", func() {
		NewResource(nil, nil, nil, nil, nil, nil, nil, RequestRuntime{}, Authorization{}, settingsFacts.NewDisplaySettings(nil))
	})
}

func TestResourceUsesInjectedLogger(t *testing.T) {
	t.Parallel()
	logger := slog.New(slog.DiscardHandler)
	resource := NewResource(nil, nil, nil, nil,
		func(testutil.Router, func(testutil.Router, common.Middleware)) {}, logger, sessionQueryStub{},
		requestRuntimeForTest(func(ctx context.Context, _, _ int64) context.Context { return ctx }), authorizationForTest(), settingsFacts.NewDisplaySettings(nil))
	assert.Same(t, logger, resource.getLogger())
}

func TestResourceRequiresOverviewAuthorization(t *testing.T) {
	t.Parallel()
	require.PanicsWithValue(t, "active API: overview authorization is required", func() {
		NewResource(nil, nil, nil, nil,
			func(testutil.Router, func(testutil.Router, common.Middleware)) {}, slog.Default(), sessionQueryStub{},
			requestRuntimeForTest(func(ctx context.Context, _, _ int64) context.Context { return ctx }), Authorization{}, settingsFacts.NewDisplaySettings(nil))
	})
}

func TestResourceRequiresTenantRequestRuntime(t *testing.T) {
	t.Parallel()
	for _, missing := range []string{"tenant ID", "rollback marker", "clock"} {
		t.Run(missing, func(t *testing.T) {
			t.Parallel()
			runtime := requestRuntimeForTest(func(ctx context.Context, _, _ int64) context.Context { return ctx })
			switch missing {
			case "tenant ID":
				runtime.TenantID = nil
			case "rollback marker":
				runtime.MarkRollback = nil
			default:
				runtime.Now = nil
			}
			require.PanicsWithValue(t, "active API: tenant request runtime is required", func() {
				NewResource(nil, nil, nil, nil,
					func(testutil.Router, func(testutil.Router, common.Middleware)) {}, slog.Default(), sessionQueryStub{},
					runtime, authorizationForTest(), settingsFacts.NewDisplaySettings(nil))
			})
		})
	}
}

func TestResourceRequiresDisplaySettings(t *testing.T) {
	t.Parallel()
	require.PanicsWithValue(t, "active API: display settings facts are required", func() {
		NewResource(nil, nil, nil, nil,
			func(testutil.Router, func(testutil.Router, common.Middleware)) {}, slog.Default(), sessionQueryStub{},
			requestRuntimeForTest(func(ctx context.Context, _, _ int64) context.Context { return ctx }), authorizationForTest(), nil)
	})
}
