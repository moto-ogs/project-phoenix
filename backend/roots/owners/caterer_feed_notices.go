package owners

import (
	"context"
	"errors"
	"fmt"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
)

// catererFeedLink is where an entry of the caterer bell leads (#7147): the
// overview of the orders, where the kitchen plans the quantities of every
// school it supplies. The bell names the school beside the entry.
const catererFeedLink = "/caterer"

// catererFeedNotifier is the side of Delivery's caterer bell a producer
// binding needs (deliveryContract.CatererFeedNotifier).
type catererFeedNotifier interface {
	CatererAudience(ctx context.Context, tenantID int64) ([]int64, error)
	NotifyCaterer(ctx context.Context, event deliveryContract.CatererFeedEvent) error
}

// catererFeedNotice is one notice to the caterer of a school (#7147), in the
// caller's tenant transaction of the school.
type catererFeedNotice struct {
	Type        string
	TenantID    int64
	ActorID     int64
	Title       string
	Body        string
	RelatedType string
	RelatedID   int64
}

// notifyCaterer writes the notice into the bell of the caterer portal of
// every active account of the caterer that currently supplies the school,
// without the person who made the change. A school without a running supply
// tells nobody, and so does a school that switched the notice off. nil
// leaves the caterer out.
func notifyCaterer(ctx context.Context, notices catererFeedNotifier, notice catererFeedNotice) error {
	if notices == nil {
		return nil
	}
	accounts, err := notices.CatererAudience(ctx, notice.TenantID)
	if err != nil {
		return fmt.Errorf("caterer notice: list the caterer's accounts: %w", err)
	}
	accounts = withoutAccount(accounts, notice.ActorID)
	if len(accounts) == 0 {
		return nil
	}
	err = notices.NotifyCaterer(ctx, deliveryContract.CatererFeedEvent{
		Type: notice.Type, TenantID: notice.TenantID, AccountIDs: accounts,
		Title: notice.Title, Body: notice.Body, DeepLink: catererFeedLink,
		RelatedType: notice.RelatedType, RelatedID: notice.RelatedID,
	})
	if errors.Is(err, deliveryCompose.ErrNotificationsDisabled) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("caterer notice: %w", err)
	}
	return nil
}
