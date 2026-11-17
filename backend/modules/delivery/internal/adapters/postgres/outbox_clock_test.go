package postgres_test

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	postgresadapter "github.com/moto-ogs/project-phoenix/modules/delivery/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/domain"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The outbox stamps a new intent with its clock: the worker counts the
// throttle window and the backlog's age from created_at on the same clock.
func TestStoreStampsNewIntentsWithItsClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.WithTenantRuntime(t, context.Background(), db)
	pinned := time.Date(2021, time.March, 10, 9, 30, 0, 0, time.UTC)
	store := postgresadapter.New(func(ctx context.Context, _ int64) (bun.IDB, error) {
		raw, ok := tenant.TransactionFromContext(ctx)
		if !ok {
			return nil, fmt.Errorf("transaction is required")
		}
		return raw.(bun.Tx), nil
	}, postgresadapter.RequireAdminDatabase, func() time.Time { return pinned })
	school := testpkg.Tenant(t)
	for _, transport := range []domain.Transport{domain.TransportEmail, domain.TransportPush} {
		key := fmt.Sprintf("stamped-%s-%d", transport, time.Now().UnixNano())
		var stamps struct {
			CreatedAt time.Time `bun:"created_at"`
			UpdatedAt time.Time `bun:"updated_at"`
		}
		require.NoError(t, tenant.WithTenantTx(ctx, db, school, func(txCtx context.Context, tx bun.Tx) error {
			enqueued, err := store.Enqueue(txCtx, domain.Intent{
				TenantID: school, Transport: transport, Template: "welcome", IdempotencyKey: &key,
				Recipient: json.RawMessage(`{"address":"guardian@example.com"}`), Payload: json.RawMessage(`{}`),
				Status: "pending", NextRetryAt: pinned,
			})
			if err != nil {
				return err
			}
			return tx.NewRaw(`SELECT created_at, updated_at FROM platform.`+string(transport)+`_outbox WHERE id = ?`, enqueued.ID).Scan(txCtx, &stamps)
		}), transport)
		assert.True(t, pinned.Equal(stamps.CreatedAt), "%s created_at %s", transport, stamps.CreatedAt)
		assert.True(t, pinned.Equal(stamps.UpdatedAt), "%s updated_at %s", transport, stamps.UpdatedAt)
	}
}
