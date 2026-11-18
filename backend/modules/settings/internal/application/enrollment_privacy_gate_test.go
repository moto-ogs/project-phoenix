package config

import (
	"encoding/json"
	"errors"
	"testing"

	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The public enrollment form may only go online with a privacy notice under
// Art. 13 DSGVO (#7176). The notice counts as present only when its switch is
// on and its text is not blank, because the form shows the block only then.
// gateTenant is a tenant of its own; the bootstrap tenant 1 is phased out.
const gateTenant int64 = 47

func TestSetValue_EnrollmentEnabled_RequiresPrivacyNotice(t *testing.T) {
	t.Parallel()

	setup := func(t *testing.T, stored map[string]string) config.SettingsService {
		t.Helper()
		registry := setupTest(t)
		registerTestSetting(registry, config.KeyEnrollmentEnabled, config.FieldBoolean, false)
		registerTestSetting(registry, config.KeyEnrollmentLegalDSGVOEnabled, config.FieldBoolean, false)
		registerTestSetting(registry, config.KeyEnrollmentLegalDSGVOText, config.FieldTextarea, "")
		repo := newMockValueRepo()
		for key, value := range stored {
			repo.values[repo.key(gateTenant, key)] = &config.SettingValue{TenantID: gateTenant, SettingKey: key, Value: json.RawMessage(value)}
		}
		return createService(registry, repo, &mockAuditRepo{})
	}

	rejected := []struct {
		name    string
		stored  map[string]string
		missing config.EnrollmentPrivacyNoticeGap
	}{
		{name: "nothing set", stored: nil, missing: config.EnrollmentPrivacyNoticeTextMissing},
		{
			name:    "switch on, text blank",
			stored:  map[string]string{config.KeyEnrollmentLegalDSGVOEnabled: `true`, config.KeyEnrollmentLegalDSGVOText: `"  \n "`},
			missing: config.EnrollmentPrivacyNoticeTextMissing,
		},
		{
			name:    "text set, switch off",
			stored:  map[string]string{config.KeyEnrollmentLegalDSGVOText: `"Wir verarbeiten Ihre Daten."`},
			missing: config.EnrollmentPrivacyNoticeSwitchOff,
		},
	}
	for _, tc := range rejected {
		t.Run("rejects enabling when "+tc.name, func(t *testing.T) {
			t.Parallel()
			svc := setup(t, tc.stored)

			err := svc.SetValue(tenantCtx(gateTenant), config.KeyEnrollmentEnabled, true, nil, nil)

			gap, ok := errors.AsType[*config.EnrollmentPrivacyNoticeError](err)
			require.True(t, ok, "want EnrollmentPrivacyNoticeError, got %v", err)
			assert.Equal(t, tc.missing, gap.Missing)
			assert.ErrorIs(t, err, config.ErrInvalidValue, "the rejection is a 400, not an operational failure")
			enabled, resolveErr := svc.ResolveBool(tenantCtx(gateTenant), config.KeyEnrollmentEnabled)
			require.NoError(t, resolveErr)
			assert.False(t, enabled, "a rejected write must not persist")
		})
	}

	t.Run("accepts enabling with switch on and text", func(t *testing.T) {
		t.Parallel()
		svc := setup(t, map[string]string{
			config.KeyEnrollmentLegalDSGVOEnabled: `true`,
			config.KeyEnrollmentLegalDSGVOText:    `"Wir verarbeiten Ihre Daten."`,
		})

		require.NoError(t, svc.SetValue(tenantCtx(gateTenant), config.KeyEnrollmentEnabled, true, nil, nil))
	})

	t.Run("switching off stays possible without a notice", func(t *testing.T) {
		t.Parallel()
		// Bestandsschulen without a notice must be able to close the form.
		svc := setup(t, map[string]string{config.KeyEnrollmentEnabled: `true`})

		require.NoError(t, svc.SetValue(tenantCtx(gateTenant), config.KeyEnrollmentEnabled, false, nil, nil))
		require.NoError(t, svc.ResetValue(tenantCtx(gateTenant), config.KeyEnrollmentEnabled, nil, nil))
	})
}
