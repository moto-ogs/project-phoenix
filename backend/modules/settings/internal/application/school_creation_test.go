package config

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

type adminUnitKey struct{}

func inTestAdminUnit(ctx context.Context) bool { return ctx.Value(adminUnitKey{}) == true }

// The federal state a school gets on creation (#7174) is stored with its
// audit entry inside the creating administrative unit, and only there.
func TestSchoolCreationSettingsRecordTheFederalStateInTheAdminUnit(t *testing.T) {
	t.Parallel()
	values, audit := newMockValueRepo(), &mockAuditRepo{}
	createdAt := time.Date(2031, time.June, 2, 12, 0, 0, 0, time.UTC)
	settings, err := NewSchoolCreationSettings(config.DefaultRegistry(), values, audit, inTestAdminUnit, func() time.Time { return createdAt })
	require.NoError(t, err)
	admin := context.WithValue(t.Context(), adminUnitKey{}, true)

	for _, region := range []string{"", "NRW", "DE-XX"} {
		recorded, err := settings.RecordFederalState(admin, 7, region)
		require.NoError(t, err, region)
		assert.False(t, recorded, region)
	}
	_, err = settings.RecordFederalState(t.Context(), 7, "DE-BW")
	require.ErrorIs(t, err, ErrSchoolCreationOutsideAdminUnit)
	stored, err := values.FindByTenantAndKey(t.Context(), 7, config.KeyFederalState)
	require.NoError(t, err)
	assert.Nil(t, stored, "a refused write stores nothing")

	recorded, err := settings.RecordFederalState(admin, 7, "DE-BW")
	require.NoError(t, err)
	assert.True(t, recorded)
	stored, err = values.FindByTenantAndKey(t.Context(), 7, config.KeyFederalState)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.JSONEq(t, `"DE-BW"`, string(stored.Value))
	assert.Nil(t, stored.UpdatedBy, "a system write: an operator is no account")
	require.Len(t, audit.entries, 1)
	assert.Equal(t, "set", audit.entries[0].Action)
	assert.Nil(t, audit.entries[0].ChangedBy)
	assert.Equal(t, createdAt, audit.entries[0].ChangedAt, "the audit entry carries the composition's clock")
}
