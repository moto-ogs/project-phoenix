package delivery_test

import (
	"context"
	"fmt"
	"testing"

	deliveryRepo "github.com/moto-ogs/project-phoenix/modules/delivery/internal/adapters/deliverypostgres"
	deliveryModels "github.com/moto-ogs/project-phoenix/modules/delivery/subscriptions"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The orphan cleanup lists every subscription with its session facts and
// deletes only the links named: a row left out stays, and a row a
// re-subscribe rebound to another family after the listing stays too.
func TestDeleteSessionLinksDeletesOnlyNamedUnchangedLinks(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	repo := &deliveryRepo.PushSubscriptionRepository{DB: db}
	tenantID := testpkg.Tenant(t)
	account := testpkg.CreateTestAccount(t, db, fmt.Sprintf("push-orphan-%d@test.local", tenantID))
	endpoint := func(name string) string {
		return fmt.Sprintf("https://fcm.googleapis.com/fcm/send/orphan-%s-%d", name, tenantID)
	}
	names := []string{"named", "unnamed", "rebound"}
	for _, name := range names {
		require.NoError(t, testpkg.WithTenantTx(t, testpkg.Ctx(t), db, tenantID, func(ctx context.Context, _ bun.Tx) error {
			return repo.RegisterSubscription(ctx, &deliveryModels.PushSubscription{
				AccountID: account.ID, Portal: deliveryModels.PushPortalStaff, Endpoint: endpoint(name),
				P256dh: "key", Auth: "auth", TokenFamilyID: "family-" + name,
			})
		}))
	}

	var remaining []string
	require.NoError(t, testpkg.WithAdminTx(t, testpkg.Ctx(t), db, func(ctx context.Context, tx bun.Tx) error {
		links, err := repo.ListSessionLinks(ctx)
		if err != nil {
			return err
		}
		ids := map[string]int64{}
		var named []deliveryModels.SessionLink
		for _, link := range links {
			if link.AccountID != account.ID {
				continue
			}
			require.Equal(t, tenantID, link.TenantID)
			require.Equal(t, deliveryModels.PushPortalStaff, link.Portal)
			ids[link.TokenFamilyID] = link.SubscriptionID
			if link.TokenFamilyID != "family-unnamed" {
				named = append(named, link)
			}
		}
		require.Len(t, ids, 3, "the listing names every subscription with its family")
		if _, err = tx.NewUpdate().TableExpr("iot.push_subscriptions").Set("token_family_id = ?", "family-new").
			Where("id = ?", ids["family-rebound"]).Exec(ctx); err != nil {
			return err
		}
		if err = repo.DeleteSessionLinks(ctx, named); err != nil {
			return err
		}
		return tx.NewSelect().TableExpr("iot.push_subscriptions").ColumnExpr("endpoint").
			Where("account_id = ?", account.ID).OrderExpr("endpoint").Scan(ctx, &remaining)
	}))
	require.Equal(t, []string{endpoint("rebound"), endpoint("unnamed")}, remaining)
}
