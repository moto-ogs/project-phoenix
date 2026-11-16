package postgres_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	postgresadapter "github.com/moto-ogs/project-phoenix/modules/delivery/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/domain"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// A guardian welcome cleared by the retention keeps its key: enqueuing the
// welcome again is refused as a reuse, so nobody is welcomed twice (#3534,
// #3955).
func TestRetentionKeepsTheWelcomeKeyWithoutItsContent(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	store, ctx := testStore(t, db)
	key := "guardian_welcome:42"
	relatedType := "guardian_profile"
	relatedID := int64(42)
	welcome := func() domain.Intent {
		return domain.Intent{
			TenantID: testpkg.Tenant(t), Transport: domain.TransportEmail, Template: "guardian_welcome", IdempotencyKey: &key,
			RelatedEntityType: &relatedType, RelatedEntityID: &relatedID,
			Recipient: json.RawMessage(`{"address":"guardian@example.com"}`), Payload: json.RawMessage(`{"name":"Ada"}`),
			Status: "pending", NextRetryAt: time.Now().Add(-time.Minute),
		}
	}
	var first domain.Enqueued
	require.NoError(t, tenant.WithTenantTx(ctx, db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
		var err error
		first, err = store.Enqueue(txCtx, welcome())
		return err
	}))
	_, err := db.ExecContext(context.Background(), `UPDATE platform.email_outbox
		SET status = 'sent', sent_at = CURRENT_TIMESTAMP - INTERVAL '31 days' WHERE id = ?`, first.ID)
	require.NoError(t, err)

	var deleted, cleared int
	before := time.Now().Add(-domain.RetentionWindow)
	require.NoError(t, tenant.WithTenantTx(ctx, db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
		if deleted, err = store.DeleteExpiredEmailIntents(txCtx, testpkg.Tenant(t), before, domain.KeyOnlyTemplates); err != nil {
			return err
		}
		cleared, err = store.ClearExpiredKeyOnlyEmailIntents(txCtx, testpkg.Tenant(t), before, domain.KeyOnlyTemplates)
		return err
	}))
	assert.Zero(t, deleted, "the welcome is not deleted")
	assert.Equal(t, 1, cleared)

	err = tenant.WithTenantTx(ctx, db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
		_, err := store.Enqueue(txCtx, welcome())
		return err
	})
	require.ErrorIs(t, err, domain.ErrIdempotencyConflict, "the cleared row still claims the key")
	var rows int
	require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM platform.email_outbox WHERE tenant_id = ? AND idempotency_key = ?`,
		testpkg.Tenant(t), key).Scan(context.Background(), &rows))
	assert.Equal(t, 1, rows)

	var retainedType *string
	var retainedID *int64
	var recipient, payload string
	require.NoError(t, db.NewRaw(`SELECT related_entity_type, related_entity_id, recipient::text, payload::text
		FROM platform.email_outbox WHERE tenant_id = ? AND idempotency_key = ?`, testpkg.Tenant(t), key).
		Scan(context.Background(), &retainedType, &retainedID, &recipient, &payload))
	assert.Nil(t, retainedType, "the retained key keeps no guardian profile type")
	assert.Nil(t, retainedID, "the retained key keeps no guardian profile ID")
	assert.Equal(t, "{}", recipient)
	assert.Equal(t, "{}", payload)
}

// In-app notifications stored for other API processes outlive their short
// lifetime only until the nightly retention (#5504).
func TestRetentionDeletesExpiredRealtimeNotifications(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	store, ctx := testStore(t, db)
	school := testpkg.Tenant(t)
	save := func() int64 {
		var id int64
		require.NoError(t, tenant.WithTenantTx(ctx, db, school, func(txCtx context.Context, _ bun.Tx) error {
			var err error
			id, err = store.SaveRealtimeNotification(txCtx, domain.RealtimeNotification{
				TenantID: school, Scope: domain.RealtimeScopeTenant, Content: json.RawMessage(`{"title":"Hinweis"}`),
			})
			return err
		}))
		return id
	}
	expired, fresh := save(), save()
	// The store stamps created_at with its clock, which the retention cutoff
	// is computed from too.
	_, err := db.ExecContext(context.Background(), `UPDATE platform.realtime_notifications
		SET created_at = ? WHERE id = ?`, time.Now().Add(-10*time.Minute), expired)
	require.NoError(t, err)

	var deleted int
	require.NoError(t, tenant.WithTenantTx(ctx, db, school, func(txCtx context.Context, _ bun.Tx) error {
		deleted, err = store.DeleteExpiredRealtimeNotifications(txCtx, school, time.Now().Add(-domain.RealtimeNotificationLifetime))
		return err
	}))
	assert.Equal(t, 1, deleted)
	var remaining []int64
	require.NoError(t, db.NewRaw(`SELECT id FROM platform.realtime_notifications WHERE tenant_id = ?`, school).Scan(context.Background(), &remaining))
	assert.Equal(t, []int64{fresh}, remaining)
}

// The nightly retention dates a relayed notification's lifetime on the
// module's clock, which stamped it: a clock far from the real day keeps a
// fresh notification and removes an expired one.
func TestRetentionDatesRealtimeNotificationsOnTheModuleClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.WithTenantRuntime(t, context.Background(), db)
	school := testpkg.Tenant(t)
	now := time.Date(2021, time.March, 10, 9, 30, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	store := postgresadapter.New(postgresadapter.RequireTenantDatabase, postgresadapter.RequireAdminDatabase, clock)
	retention := deliveryCompose.NewRetention(clock)
	var id int64
	require.NoError(t, tenant.WithTenantTx(ctx, db, school, func(txCtx context.Context, _ bun.Tx) error {
		var err error
		id, err = store.SaveRealtimeNotification(txCtx, domain.RealtimeNotification{
			TenantID: school, Scope: domain.RealtimeScopeTenant, Content: json.RawMessage(`{"title":"Hinweis"}`),
		})
		return err
	}))
	remaining := func() int {
		var count int
		require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM platform.realtime_notifications WHERE id = ?`, id).Scan(context.Background(), &count))
		return count
	}
	runRetention := func() {
		require.NoError(t, tenant.WithTenantTx(ctx, db, school, func(txCtx context.Context, _ bun.Tx) error {
			_, _, err := retention.DeleteExpiredDeliveries(txCtx)
			return err
		}))
	}

	runRetention()
	assert.Equal(t, 1, remaining(), "a notification inside its lifetime stays")
	now = now.Add(domain.RealtimeNotificationLifetime + time.Minute)
	runRetention()
	assert.Zero(t, remaining(), "a notification past its lifetime goes")
}

// The nightly retention dates a delivery log without a mail on the module's
// clock, which stamped it (#7295): with that clock on another day than the
// database's, a fresh log stays and one past the window goes.
func TestRetentionDatesEmailDeliveryLogsOnTheModuleClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.WithTenantRuntime(t, context.Background(), db)
	school := testpkg.Tenant(t)
	now := time.Date(2099, time.March, 10, 9, 30, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	store := postgresadapter.New(postgresadapter.RequireTenantDatabase, postgresadapter.RequireAdminDatabase, clock)
	retention := deliveryCompose.NewRetention(clock)
	relatedType := "announcement"
	require.NoError(t, tenant.WithTenantTx(ctx, db, school, func(txCtx context.Context, _ bun.Tx) error {
		return store.ReplaceEmailDeliveries(txCtx, school, relatedType, school, []domain.EmailDelivery{{Reachability: "no_email"}})
	}))
	var stamps struct {
		CreatedAt time.Time `bun:"created_at"`
		UpdatedAt time.Time `bun:"updated_at"`
	}
	remaining := func() int {
		var count int
		require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM platform.delivery_email_deliveries
			WHERE tenant_id = ? AND related_entity_type = ? AND related_entity_id = ?`, school, relatedType, school).
			Scan(context.Background(), &count))
		return count
	}
	runRetention := func() {
		require.NoError(t, tenant.WithTenantTx(ctx, db, school, func(txCtx context.Context, _ bun.Tx) error {
			_, _, err := retention.DeleteExpiredDeliveries(txCtx)
			return err
		}))
	}
	require.NoError(t, db.NewRaw(`SELECT created_at, updated_at FROM platform.delivery_email_deliveries
		WHERE tenant_id = ? AND related_entity_type = ? AND related_entity_id = ?`, school, relatedType, school).
		Scan(context.Background(), &stamps))
	assert.True(t, now.Equal(stamps.CreatedAt), "created_at %s, want the module clock %s", stamps.CreatedAt, now)
	assert.True(t, now.Equal(stamps.UpdatedAt), "updated_at %s, want the module clock %s", stamps.UpdatedAt, now)

	runRetention()
	assert.Equal(t, 1, remaining(), "a log inside the window stays")
	now = now.Add(domain.RetentionWindow + time.Minute)
	runRetention()
	assert.Zero(t, remaining(), "a log past the window goes")
}
