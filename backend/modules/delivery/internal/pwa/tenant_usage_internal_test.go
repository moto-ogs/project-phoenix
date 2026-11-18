package pwa

import (
	"context"
	"database/sql"
	"testing"

	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestNewTenantUsageServiceBindsTheRuntimeAtConstruction(t *testing.T) {
	t.Parallel()
	// The connector opens no connection until a query runs.
	db := bun.NewDB(sql.OpenDB(pgdriver.NewConnector()), pgdialect.New())
	runtime, err := tenant.NewUnitOfWork(
		func(ctx context.Context, _ int64, fn func(context.Context, any) error) error {
			return fn(ctx, bun.Tx{})
		},
		func(ctx context.Context, fn func(context.Context, any) error) error { return fn(ctx, bun.Tx{}) },
		func(context.Context, tenant.SavepointAction) error { return nil },
		func(error) bool { return false },
	)
	require.NoError(t, err)
	repo, summaries, schools, settings := &recordingUsageRepository{}, &summariesStub{}, accountTenantStub{}, &settingsDouble{}

	_, err = NewTenantUsageService(tenant.UnitOfWork{}, db, repo, summaries, schools, settings, nil, usageTestNow)
	require.ErrorIs(t, err, tenant.ErrRuntimeRequired)
	for name, construct := range map[string]func() error{
		"database": func() error {
			_, err := NewTenantUsageService(runtime, nil, repo, summaries, schools, settings, nil, usageTestNow)
			return err
		},
		"repo": func() error {
			_, err := NewTenantUsageService(runtime, db, nil, summaries, schools, settings, nil, usageTestNow)
			return err
		},
		"summaries": func() error {
			_, err := NewTenantUsageService(runtime, db, repo, nil, schools, settings, nil, usageTestNow)
			return err
		},
		"schools": func() error {
			_, err := NewTenantUsageService(runtime, db, repo, summaries, nil, settings, nil, usageTestNow)
			return err
		},
		"settings": func() error {
			_, err := NewTenantUsageService(runtime, db, repo, summaries, schools, nil, nil, usageTestNow)
			return err
		},
		"clock": func() error {
			_, err := NewTenantUsageService(runtime, db, repo, summaries, schools, settings, nil, nil)
			return err
		},
	} {
		assert.Error(t, construct(), name)
	}

	service, err := NewTenantUsageService(runtime, db, repo, summaries, schools, settings, nil, usageTestNow)
	require.NoError(t, err)
	assert.NotNil(t, service.(*usageService).tenantRuntime)
	assert.NotNil(t, service.(*usageService).logger, "a missing logger falls back to the default")
}
