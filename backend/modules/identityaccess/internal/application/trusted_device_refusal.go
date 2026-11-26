package application

import (
	"context"
	"log/slog"
)

// Why a sign-in that needs the second factor did not skip it by a remembered
// device (#8159). The browser sent no cookie, the school switched remembered
// devices off, the cookie carries no signature of this deployment, no active
// device of this portal matches it (revoked, expired, another portal or an
// older credential), or the lookup failed.
const (
	deviceRefusalNoCookie         = "no_cookie"
	deviceRefusalDisabled         = "disabled"
	deviceRefusalInvalidSignature = "invalid_signature"
	deviceRefusalNoActiveDevice   = "no_active_device"
	deviceRefusalLookupFailed     = "lookup_failed"
)

// logTrustedDeviceRefused names the reason a sign-in asks for the code
// although a device may be remembered: the answer to the client is the same
// for every reason, so the log is the only place that tells them apart.
func logTrustedDeviceRefused(ctx context.Context, logger *slog.Logger, accountID, tenantID int64, reason string, err error) {
	binding := deviceBinding(ctx, tenantID)
	attrs := []any{
		slog.Int64("account_id", accountID),
		slog.Int64("tenant_id", binding.TenantID),
		slog.Int64("organization_id", binding.OrganizationID),
		slog.Bool("parent_portal", binding.ParentPortal),
		slog.String("reason", reason),
	}
	if err != nil {
		logger.Warn("trusted device not accepted", append(attrs, slog.String("error", err.Error()))...)
		return
	}
	logger.Info("trusted device not accepted", attrs...)
}

// logOperatorTrustedDeviceRefused names the reason an operator sign-in asks
// for the code although a device may be remembered (#8159).
func logOperatorTrustedDeviceRefused(logger *slog.Logger, operatorID int64, reason string, err error) {
	attrs := []any{
		slog.Int64("operator_id", operatorID),
		slog.String("reason", reason),
	}
	if err != nil {
		logger.Warn("operator trusted device not accepted", append(attrs, slog.String("error", err.Error()))...)
		return
	}
	logger.Info("operator trusted device not accepted", attrs...)
}
