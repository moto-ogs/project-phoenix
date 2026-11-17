package application

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A login refused for an account without a live school (a Träger member, a
// parent whose school left) has no school audit log: audit.auth_events is
// school-scoped. That is no server fault, so it logs a WARN, not the ERROR
// that reached Sentry for every such login. A failed tenant lookup stays an
// error.
func TestRejectedLoginOfAnAccountWithoutSchool(t *testing.T) {
	t.Parallel()
	f := newAuthFixture(t)
	f.store.addAccount(7, "traeger@example.com", "hash:secret", true)
	var logs bytes.Buffer
	f.auth.logger = slog.New(slog.NewTextHandler(&logs, nil))

	err := f.auth.logAuthEvent(context.Background(), 7, domain.AuthEventLogin, false, "192.0.2.1", "tests", "No Träger membership at Träger login")
	require.ErrorIs(t, err, errAuthEventWithoutSchool)

	f.auth.logFailedLogin(context.Background(), 7, "192.0.2.1", "tests", "No Träger membership at Träger login")
	assert.Contains(t, logs.String(), "level=WARN")
	assert.Contains(t, logs.String(), "account_id=7")
	assert.NotContains(t, logs.String(), "level=ERROR")
	assert.Empty(t, f.audit.eventsOfType(domain.AuthEventLogin))
}

func TestRejectedLoginAuditKeepsTenantLookupFailures(t *testing.T) {
	t.Parallel()
	f := newAuthFixture(t)
	f.store.addAccount(8, "staff@example.com", "hash:secret", true)
	f.store.listTenantsErr = errors.New("database unavailable")

	err := f.auth.logAuthEvent(context.Background(), 8, domain.AuthEventLogin, false, "192.0.2.1", "tests", "Password login refused")
	require.Error(t, err)
	assert.NotErrorIs(t, err, errAuthEventWithoutSchool)
}
