package ports

import (
	"context"
	"log/slog"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
)

// PasswordResetDelivery mails a reset link asynchronously. The root resolves
// the portal host for the scope and records the outcome through
// RecordPasswordResetDelivery once the send settles.
type PasswordResetDelivery interface {
	DispatchPasswordReset(ctx context.Context, link identityaccess.PasswordResetLink, recipient string, scope identityaccess.PasswordResetScope, expiry time.Duration) error
}

// PasswordResetDependencies add reset policy and delivery to the session flows.
type PasswordResetDependencies struct {
	// DeliveryFor builds delivery over its outcome recorder once.
	DeliveryFor      func(identityaccess.PasswordResetDeliveryRecorder) PasswordResetDelivery
	Passwords        PasswordPolicy
	Expiry           time.Duration
	RateLimitEnabled bool
	RateLimitSecret  []byte
	Logger           *slog.Logger
}
