package application

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A sign-in that asks for the code although a device may be remembered
// answers the client the same way for every reason. The log names the
// reason, so a report like #8159 can be settled from the server.

// deviceLookupRecords answers the device lookup the way the test sets it.
type deviceLookupRecords struct {
	*memoryMFARecords
	found bool
	err   error
}

func (r deviceLookupRecords) FindActiveTrustedDevice(context.Context, int64, domain.DeviceBinding, string) (domain.AccountTrustedDevice, bool, error) {
	return domain.AccountTrustedDevice{ID: 1}, r.found, r.err
}

func (deviceLookupRecords) TouchTrustedDevice(context.Context, int64, time.Time) error { return nil }

// devicesOffSettings is a school that switched remembered devices off.
type devicesOffSettings struct{ optionalMFASettings }

func (devicesOffSettings) TrustedDeviceEnabled(context.Context, int64) (bool, error) {
	return false, nil
}

func TestTrustedDeviceRefusalNamesItsReason(t *testing.T) {
	t.Parallel()
	secret := []byte("trusted-device-secret")
	signed := domain.SignTrustedDeviceToken("raw-token", secret)
	traeger := identityaccess.WithTraegerDevice(context.Background(), 7)

	cases := []struct {
		name     string
		ctx      context.Context
		tenantID int64
		cookie   string
		records  deviceLookupRecords
		off      bool
		want     []string
	}{
		{name: "school switched devices off", ctx: context.Background(), tenantID: 3, cookie: signed, off: true,
			want: []string{"level=INFO", "reason=disabled", "account_id=1", "tenant_id=3"}},
		{name: "cookie without this deployment's signature", ctx: context.Background(), tenantID: 3, cookie: "raw-token.forged",
			want: []string{"level=INFO", "reason=invalid_signature", "tenant_id=3"}},
		{name: "no active device at the Träger", ctx: traeger, cookie: signed,
			want: []string{"level=INFO", "reason=no_active_device", "tenant_id=0", "organization_id=7"}},
		{name: "lookup failed", ctx: context.Background(), tenantID: 3, cookie: signed, records: deviceLookupRecords{err: errors.New("database unavailable")},
			want: []string{"level=WARN", "reason=lookup_failed", `error="database unavailable"`}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var logs bytes.Buffer
			tc.records.memoryMFARecords = newMemoryMFARecords()
			deps := AccountMFAFlowDependencies{Now: time.Now, PermissionGranted: func(string, []string) bool { return false },
				Records: tc.records, Settings: optionalMFASettings{}, Codec: &fakeMFAChallengeCodec{}, Codes: fakeShortCodes{},
				Mail: &fakeMFAMail{}, Audit: &fakeMFAAudit{}, Runtime: &fakeRuntime{}, Secret: secret,
				Logger: slog.New(slog.NewTextHandler(&logs, nil)),
			}
			if tc.off {
				deps.Settings = devicesOffSettings{}
			}
			flows, err := NewAccountMFAFlows(deps)
			require.NoError(t, err)

			verified, err := flows.VerifyTrustedDevice(tc.ctx, 1, tc.tenantID, tc.cookie)
			require.NoError(t, err)
			assert.False(t, verified)
			assert.Contains(t, logs.String(), `msg="trusted device not accepted"`)
			for _, want := range tc.want {
				assert.Contains(t, logs.String(), want)
			}
			assert.NotContains(t, logs.String(), "raw-token", "the cookie never reaches the log")
		})
	}
}

func TestAcceptedTrustedDeviceLogsNoRefusal(t *testing.T) {
	t.Parallel()
	secret := []byte("trusted-device-secret")
	var logs bytes.Buffer
	flows, err := NewAccountMFAFlows(AccountMFAFlowDependencies{Now: time.Now, PermissionGranted: func(string, []string) bool { return false },
		Records: deviceLookupRecords{memoryMFARecords: newMemoryMFARecords(), found: true}, Settings: optionalMFASettings{},
		Codec: &fakeMFAChallengeCodec{}, Codes: fakeShortCodes{}, Mail: &fakeMFAMail{}, Audit: &fakeMFAAudit{}, Runtime: &fakeRuntime{},
		Secret: secret, Logger: slog.New(slog.NewTextHandler(&logs, nil)),
	})
	require.NoError(t, err)

	verified, err := flows.VerifyTrustedDevice(context.Background(), 1, 3, domain.SignTrustedDeviceToken("raw-token", secret))
	require.NoError(t, err)
	assert.True(t, verified)
	assert.Empty(t, logs.String())
}

// The browser sent no cookie: the case a cleared browser profile produces.
func TestSignInWithoutDeviceCookieLogsNoCookie(t *testing.T) {
	t.Parallel()
	f := newAuthFixture(t)
	f.mfa.configured = true
	var logs bytes.Buffer
	f.auth.logger = slog.New(slog.NewTextHandler(&logs, nil))

	assert.False(t, f.auth.trustedDeviceVerified(identityaccess.WithTraegerDevice(context.Background(), 7), 9, 0, ""))
	assert.Contains(t, logs.String(), `msg="trusted device not accepted"`)
	assert.Contains(t, logs.String(), "reason=no_cookie")
	assert.Contains(t, logs.String(), "account_id=9")
	assert.Contains(t, logs.String(), "organization_id=7")
}

func TestOperatorTrustedDeviceRefusalNamesItsReason(t *testing.T) {
	t.Parallel()
	operator := domain.Operator{ID: 21, Email: "ops@example.test", DisplayName: "Ops", Active: true}

	t.Run("no active device", func(t *testing.T) {
		t.Parallel()
		fixture := newOperatorMFAFixture(t, operator, nil)
		var logs bytes.Buffer
		fixture.flows.logger = slog.New(slog.NewTextHandler(&logs, nil))

		verified, err := fixture.flows.VerifyOperatorTrustedDevice(context.Background(), operator.ID,
			domain.SignTrustedDeviceToken("raw-token", []byte("operator-mfa-secret")))
		require.NoError(t, err)
		assert.False(t, verified)
		assert.Contains(t, logs.String(), `msg="operator trusted device not accepted"`)
		assert.Contains(t, logs.String(), "reason=no_active_device")
		assert.Contains(t, logs.String(), "operator_id=21")
	})
	t.Run("cookie without this deployment's signature", func(t *testing.T) {
		t.Parallel()
		fixture := newOperatorMFAFixture(t, operator, nil)
		var logs bytes.Buffer
		fixture.flows.logger = slog.New(slog.NewTextHandler(&logs, nil))

		verified, err := fixture.flows.VerifyOperatorTrustedDevice(context.Background(), operator.ID, "raw-token.forged")
		require.NoError(t, err)
		assert.False(t, verified)
		assert.Contains(t, logs.String(), "reason=invalid_signature")
	})
	t.Run("no cookie", func(t *testing.T) {
		t.Parallel()
		f := newOperatorFixture(t)
		f.seedOperator(42)
		f.mfa.configured = true
		f.mfa.enrolled = true
		f.mfa.challenge = "challenge-xyz"
		var logs bytes.Buffer
		f.auth.logger = slog.New(slog.NewTextHandler(&logs, nil))

		_, err := f.auth.loginWithMFAGate(context.Background(), "operator42@example.com", "secret", "127.0.0.1", "ua", "")
		require.NoError(t, err)
		assert.Contains(t, logs.String(), "reason=no_cookie")
		assert.Contains(t, logs.String(), "operator_id=42")
	})
}
