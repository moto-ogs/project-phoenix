package notifications

import (
	"context"

	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	deliveryModels "github.com/moto-ogs/project-phoenix/modules/delivery/subscriptions"
	"github.com/moto-ogs/project-phoenix/tenant"
)

func NewPushAuthorizationChecker(execute func(context.Context, int64, func(context.Context) error) error, subscriptions PushSubscriptionAuthorizer, contains func([]*deliveryModels.PushSubscription, deliveryContract.PushRecipient) bool) func(context.Context, deliveryContract.ClaimedIntent) (bool, error) {
	return func(ctx context.Context, intent deliveryContract.ClaimedIntent) (bool, error) {
		var eligible []*deliveryModels.PushSubscription
		err := execute(ctx, intent.TenantID, func(txCtx context.Context) error {
			var lookupErr error
			eligible, lookupErr = EligiblePushSubscriptions(txCtx, subscriptions, intent.PushRecipient)
			return lookupErr
		})
		if err != nil {
			return false, err
		}
		return contains(eligible, intent.PushRecipient), nil
	}
}

type expiredPushSubscriptions interface {
	DeleteExpiredIfUnchanged(context.Context, *deliveryModels.PushSubscription) (bool, error)
}

func NewExpiredPushSubscriptionCleaner(execute func(context.Context, int64, func(context.Context) error) error, subscriptions expiredPushSubscriptions) func(context.Context, deliveryContract.ClaimedIntent) error {
	return func(ctx context.Context, intent deliveryContract.ClaimedIntent) error {
		subscription := &deliveryModels.PushSubscription{
			ID: intent.PushRecipient.SubscriptionID, TenantID: intent.TenantID,
			AccountID: intent.PushRecipient.AccountID, Portal: intent.PushRecipient.Portal,
			Endpoint: intent.PushRecipient.Endpoint, P256dh: intent.PushRecipient.P256DH,
			Auth: intent.PushRecipient.Auth, UpdatedAt: intent.PushRecipient.UpdatedAt,
		}
		if subscription.Portal == deliveryModels.PushPortalParent {
			_, err := deleteExpiredParentDevice(ctx, subscriptions, subscription)
			return err
		}
		return execute(ctx, intent.TenantID, func(txCtx context.Context) error {
			_, err := subscriptions.DeleteExpiredIfUnchanged(txCtx, subscription)
			return err
		})
	}
}

// The delivery school does not own a parent's browser endpoint. Both
// delivery paths retire only the exact device snapshot the provider rejected.
func deleteExpiredParentDevice(ctx context.Context, subscriptions expiredPushSubscriptions, sub *deliveryModels.PushSubscription) (bool, error) {
	var deleted bool
	err := tenant.WithinAdmin(ctx, func(txCtx context.Context) error {
		var err error
		deleted, err = subscriptions.DeleteExpiredIfUnchanged(txCtx, sub)
		return err
	})
	return deleted, err
}
