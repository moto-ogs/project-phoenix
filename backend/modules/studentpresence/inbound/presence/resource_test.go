package presence

import (
	"context"
	"log/slog"
	"testing"
	"time"

	settingsFacts "github.com/moto-ogs/project-phoenix/modules/settings"

	"github.com/moto-ogs/project-phoenix/api/testutil"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// resourceForTest initializes settings and logging while allowing each handler test to
// supply only the collaborators its path calls.
func resourceForTest(resource Resource) *Resource {
	resource.logger = slog.Default()
	resource.displaySettings = settingsFacts.NewDisplaySettings(resource.SettingsService)
	resource.runtime.TenantID = tenant.FromContext
	resource.runtime.MarkRollback = tenant.MarkRollback
	if resource.runtime.Now == nil {
		resource.runtime.Now = time.Now
	}
	return &resource
}

func requestRuntimeForTest(withStaff func(context.Context, int64, int64) context.Context) RequestRuntime {
	return RequestRuntime{WithStaff: withStaff, TenantID: tenant.FromContext, MarkRollback: tenant.MarkRollback, Now: time.Now}
}

func TestResourceRequiresLogger(t *testing.T) {
	t.Parallel()
	require.PanicsWithValue(t, "active API: logger is required", func() {
		NewResource(nil, nil, nil, nil, nil, nil, nil, RequestRuntime{}, settingsFacts.NewDisplaySettings(nil))
	})
}

func TestResourceUsesInjectedLogger(t *testing.T) {
	t.Parallel()
	logger := slog.New(slog.DiscardHandler)
	resource := NewResource(nil, nil, nil, nil,
		func(testutil.Router, func(testutil.Router, common.Middleware)) {}, logger, sessionQueryStub{},
		requestRuntimeForTest(func(ctx context.Context, _, _ int64) context.Context { return ctx }), settingsFacts.NewDisplaySettings(nil))
	assert.Same(t, logger, resource.getLogger())
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
					runtime, settingsFacts.NewDisplaySettings(nil))
			})
		})
	}
}

func TestResourceRequiresDisplaySettings(t *testing.T) {
	t.Parallel()
	require.PanicsWithValue(t, "active API: display settings facts are required", func() {
		NewResource(nil, nil, nil, nil,
			func(testutil.Router, func(testutil.Router, common.Middleware)) {}, slog.Default(), sessionQueryStub{},
			requestRuntimeForTest(func(ctx context.Context, _, _ int64) context.Context { return ctx }), nil)
	})
}
