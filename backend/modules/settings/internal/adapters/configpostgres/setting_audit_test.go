package config

import (
	"encoding/json"
	"testing"
	"time"

	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSettingAuditRepository_Create(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	repo := NewSettingAuditRepository(testpkg.ConfigRuntime(db))
	ctx := testpkg.Ctx(t)

	entry := &config.SettingAuditEntry{
		TenantID:   testpkg.Tenant(t),
		SettingKey: "test.audit_create",
		Action:     "set",
		OldValue:   nil,
		NewValue:   json.RawMessage(`"new_value"`),
		ChangedAt:  time.Now(),
	}

	err := testpkg.TenantCommand1(t, ctx, db, repo.Create, entry)
	require.NoError(t, err)
	assert.Greater(t, entry.ID, int64(0), "should have an auto-generated ID")
}

func TestSettingAuditRepository_Create_ValidatesEntry(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	repo := NewSettingAuditRepository(testpkg.ConfigRuntime(db))
	ctx := testpkg.Ctx(t)

	// Missing key
	err := testpkg.TenantCommand1(t, ctx, db, repo.Create, &config.SettingAuditEntry{
		TenantID: testpkg.Tenant(t),
		Action:   "set",
	})
	assert.Error(t, err)

	// Invalid action
	err = testpkg.TenantCommand1(t, ctx, db, repo.Create, &config.SettingAuditEntry{
		TenantID:   testpkg.Tenant(t),
		SettingKey: "test.key",
		Action:     "invalid",
	})
	assert.Error(t, err)
}

func TestSettingAuditRepository_CreateNil(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	repo := NewSettingAuditRepository(testpkg.ConfigRuntime(db))
	ctx := testpkg.Ctx(t)

	err := testpkg.TenantCommand1(t, ctx, db, repo.Create, nil)
	assert.Error(t, err)
}

// A setting change is dated on the database clock, the clock its retention
// function config.delete_expired_setting_audit compares with (ADR 0281):
// the entry carries no time of its own, the column default stamps it, and the
// three-year retention keeps the fresh change whatever clock the caller runs
// on.
func TestSettingChangeIsDatedOnTheClockOfItsRetention(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	ctx := testpkg.Ctx(t)
	entry := config.NewAuditEntry(tenantID, "test.audit_clock", "set", nil, json.RawMessage(`"value"`), nil)
	require.NoError(t, testpkg.TenantCommand1(t, ctx, db, NewSettingAuditRepository(testpkg.ConfigRuntime(db)).Create, entry))

	_, err := testpkg.TenantQuery1(t, ctx, db, NewSettingAuditRetention(testpkg.ConfigRuntime(db)).deleteExpired, tenantID)
	require.NoError(t, err)
	var fresh bool
	require.NoError(t, db.NewRaw(`SELECT changed_at > now() - INTERVAL '1 hour' FROM config.setting_audit WHERE id = ?`, entry.ID).Scan(ctx, &fresh),
		"the retention keeps the fresh change")
	assert.True(t, fresh, "the column default stamps the change on the database clock")
}
