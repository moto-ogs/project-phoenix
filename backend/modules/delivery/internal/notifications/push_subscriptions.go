package notifications

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	deliveryPorts "github.com/moto-ogs/project-phoenix/modules/delivery/internal/ports"

	"github.com/moto-ogs/project-phoenix/modules/delivery/devices"

	deliveryModels "github.com/moto-ogs/project-phoenix/modules/delivery/subscriptions"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
)

var (
	// ErrWebPushNotConfigured is returned when VAPID keys are missing: devices
	// cannot subscribe while the server cannot sign pushes.
	ErrWebPushNotConfigured = errors.New("web push is not configured on this server")
	// ErrInvalidPushSubscription marks browser-supplied subscription data that
	// failed model validation. Handlers map only this error family to HTTP 400.
	ErrInvalidPushSubscription = errors.New("invalid push subscription")
)

// PushSubscriptionInput is the browser's PushSubscription in wire form.
type PushSubscriptionInput struct {
	Endpoint      string
	P256dh        string
	Auth          string
	UserAgent     string
	TokenFamilyID string
}

// PushSubscriptionService manages Web Push device registrations. Staff and
// school methods use the current tenant. Parent devices belong to the
// authenticated account and are managed in an administrative transaction.
type PushSubscriptionService interface {
	StaffDevices() devices.StaffPushSubscriptions
	ParentDevices() devices.PushSubscriptions
	// PublicKey returns the VAPID public key the browser subscribes with.
	PublicKey() (string, error)
	// Subscribe registers (or refreshes) a staff device for the current tenant.
	Subscribe(ctx context.Context, accountID int64, input PushSubscriptionInput) error
	// SubscribeSchool registers a device of the school portal (#2208). The row
	// carries portal "school" so pushes get the school host's deep link and a
	// school logout revokes only these devices. Registration rebinds the
	// endpoint: a school registration left by a login at another school is
	// removed in the same transaction.
	SubscribeSchool(ctx context.Context, accountID int64, input PushSubscriptionInput) error
	// Unsubscribe removes a staff device registration for the current tenant.
	Unsubscribe(ctx context.Context, accountID int64, endpoint string) error
	// UnsubscribeSchool removes only a school-portal device registration for
	// the current tenant.
	UnsubscribeSchool(ctx context.Context, accountID int64, endpoint string) error
	// SubscribeParent registers one device for the account, even without a school.
	// Rebinding replaces the previous parent account on the same browser.
	SubscribeParent(ctx context.Context, accountID int64, input PushSubscriptionInput) error
	// UnsubscribeParent removes the caller’s device, including any legacy school bindings.
	UnsubscribeParent(ctx context.Context, accountID int64, endpoint string) error
}

type pushSubscriptionService struct {
	db            *bun.DB
	repo          deliveryPorts.PushSubscriptionRepository
	vapid         VAPIDConfig
	logger        *slog.Logger
	tenantRuntime *tenant.UnitOfWork
}

func (s *pushSubscriptionService) withTenantRuntime(ctx context.Context) context.Context {
	if s.tenantRuntime == nil {
		return ctx
	}
	return tenant.WithUnitOfWork(ctx, *s.tenantRuntime)
}

// NewPushSubscriptionService builds the push subscription service.
func NewPushSubscriptionService(
	db *bun.DB,
	repo deliveryPorts.PushSubscriptionRepository,
	vapid VAPIDConfig,
	logger *slog.Logger,
) PushSubscriptionService {
	return &pushSubscriptionService{db: db, repo: repo, vapid: vapid, logger: logger}
}

func (s *pushSubscriptionService) PublicKey() (string, error) {
	if !s.vapid.Configured() {
		return "", ErrWebPushNotConfigured
	}
	return s.vapid.PublicKey, nil
}

func (s *pushSubscriptionService) buildSubscription(accountID int64, portal string, input PushSubscriptionInput) (*deliveryModels.PushSubscription, error) {
	sub := &deliveryModels.PushSubscription{
		AccountID:     accountID,
		Portal:        portal,
		Endpoint:      input.Endpoint,
		P256dh:        input.P256dh,
		Auth:          input.Auth,
		UserAgent:     input.UserAgent,
		TokenFamilyID: input.TokenFamilyID,
	}
	if err := sub.Validate(); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidPushSubscription, err)
	}
	return sub, nil
}

func (s *pushSubscriptionService) Subscribe(ctx context.Context, accountID int64, input PushSubscriptionInput) error {
	ctx = s.withTenantRuntime(ctx)
	if !s.vapid.Configured() {
		return ErrWebPushNotConfigured
	}
	sub, err := s.buildSubscription(accountID, deliveryModels.PushPortalStaff, input)
	if err != nil {
		return err
	}
	return tenant.WithinCurrentTenant(ctx, func(txCtx context.Context) error {
		return s.repo.RegisterSubscription(txCtx, sub)
	})
}

func (s *pushSubscriptionService) SubscribeSchool(ctx context.Context, accountID int64, input PushSubscriptionInput) error {
	ctx = s.withTenantRuntime(ctx)
	if !s.vapid.Configured() {
		return ErrWebPushNotConfigured
	}
	sub, err := s.buildSubscription(accountID, deliveryModels.PushPortalSchool, input)
	if err != nil {
		return err
	}
	tenantID, tenantErr := tenant.TenantFromContext(ctx)
	if tenantErr != nil {
		return errors.New("school push subscription requires a school context")
	}
	sub.TenantID = tenantID.Int64()

	// A school session is pinned to one school, so a browser endpoint holds at
	// most one school registration. After a login at another school the
	// previous school's row must go: it survives the login, its account still
	// holds the Lehrkraft role there, and it would keep pushing that school's
	// notifications to a device now looking at a different one. The clearing
	// delete crosses tenants and therefore needs its own admin transaction;
	// the upsert joins it so a failed rebind never leaves the device
	// unregistered.
	return tenant.WithAdminTx(ctx, s.db, func(txCtx context.Context, _ bun.Tx) error {
		if err := s.repo.DeleteSchoolByEndpointAcrossTenants(txCtx, sub.Endpoint); err != nil {
			return fmt.Errorf("clearing previous school push subscription bindings: %w", err)
		}
		return s.repo.RegisterSubscription(txCtx, sub)
	})
}

func (s *pushSubscriptionService) Unsubscribe(ctx context.Context, accountID int64, endpoint string) error {
	ctx = s.withTenantRuntime(ctx)
	return tenant.WithinCurrentTenant(ctx, func(txCtx context.Context) error {
		return s.repo.DeleteByEndpoint(txCtx, accountID, endpoint)
	})
}

func (s *pushSubscriptionService) UnsubscribeSchool(ctx context.Context, accountID int64, endpoint string) error {
	ctx = s.withTenantRuntime(ctx)
	return tenant.WithinCurrentTenant(ctx, func(txCtx context.Context) error {
		return s.repo.DeleteSchoolByEndpoint(txCtx, accountID, endpoint)
	})
}

func (s *pushSubscriptionService) SubscribeParent(ctx context.Context, accountID int64, input PushSubscriptionInput) error {
	ctx = s.withTenantRuntime(ctx)
	if !s.vapid.Configured() {
		return ErrWebPushNotConfigured
	}
	sub, err := s.buildSubscription(accountID, deliveryModels.PushPortalParent, input)
	if err != nil {
		return err
	}
	return tenant.WithAdminTx(ctx, s.db, func(txCtx context.Context, _ bun.Tx) error {
		// Rebind atomically, including bindings left by a previous account on
		// this browser. The repository serializes replacements of the endpoint.
		if err := s.repo.DeleteParentByEndpoint(txCtx, sub.Endpoint); err != nil {
			return fmt.Errorf("clearing previous parent push subscription bindings: %w", err)
		}
		return s.repo.RegisterSubscription(txCtx, sub)
	})
}

func (s *pushSubscriptionService) UnsubscribeParent(ctx context.Context, accountID int64, endpoint string) error {
	ctx = s.withTenantRuntime(ctx)
	return tenant.WithAdminTx(ctx, s.db, func(txCtx context.Context, _ bun.Tx) error {
		// Wait for a concurrent replacement before looking up this account's
		// row, so the delete sees the committed registration, not its old row.
		if err := s.repo.LockParentEndpoint(txCtx, endpoint); err != nil {
			return err
		}
		return s.repo.DeleteParentByAccountEndpoint(txCtx, accountID, endpoint)
	})
}
