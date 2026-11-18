package compose

import (
	"errors"
	"log/slog"
	"time"

	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/application"
	identityPorts "github.com/moto-ogs/project-phoenix/modules/identityaccess/ports"
)

func newPasswordReset(auth *application.AccountAuthentication, store *postgres.Store, sessions *identityPorts.SessionDependencies, deps *identityPorts.PasswordResetDependencies, runtime tenantRuntime) (*application.PasswordReset, error) {
	if deps == nil {
		return nil, nil
	}
	if auth == nil || sessions == nil {
		return nil, errors.New("identity access compose: the password reset flows require the session dependencies")
	}
	if deps.DeliveryFor == nil || deps.Passwords == nil {
		return nil, errors.New("identity access compose: every password reset dependency is required")
	}
	delivery := deps.DeliveryFor(application.NewPasswordResetDeliveryRecords(store, sessions.TenantRuntime, runtime))
	if delivery == nil {
		return nil, errors.New("identity access compose: every password reset dependency is required")
	}
	return application.NewPasswordReset(auth, application.PasswordResetDependencies{
		Store: store, Logins: store, Passwords: deps.Passwords,
		Delivery:         application.PasswordResetDelivery{Source: delivery},
		Runtime:          runtime,
		Expiry:           deps.Expiry,
		RateLimitEnabled: deps.RateLimitEnabled,
		RateLimitSecret:  deps.RateLimitSecret,
		Logger:           deps.Logger,
	})
}

func NewRequestRateLimits(db *bun.DB, fingerprint func(string) string, now func() time.Time, logger *slog.Logger) identityaccess.RequestRateLimits {
	return postgres.NewRequestRateLimits(db, fingerprint, now, logger)
}
