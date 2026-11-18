package notifications

import (
	"context"
	"errors"
	"fmt"
	"testing"

	deliveryPorts "github.com/moto-ogs/project-phoenix/modules/delivery/internal/ports"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	deliveryModels "github.com/moto-ogs/project-phoenix/modules/delivery/subscriptions"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

var errPushRepository = errors.New("push repository failed")

type recordingPushRepository struct {
	deliveryPorts.PushSubscriptionRepository
	upserted        []*deliveryModels.PushSubscription
	deletedAccount  int64
	deletedEndpoint string
	deletedTenants  []int64
	reboundEndpoint string
	operations      []string
	err             error
	deleteParentErr error
	deleteSchoolErr error
}

func (r *recordingPushRepository) RegisterSubscription(_ context.Context, sub *deliveryModels.PushSubscription) error {
	r.upserted = append(r.upserted, sub)
	r.operations = append(r.operations, fmt.Sprintf("upsert:%d", sub.TenantID))
	return r.err
}

func (r *recordingPushRepository) DeleteByEndpoint(ctx context.Context, accountID int64, endpoint string) error {
	r.deletedAccount = accountID
	r.deletedEndpoint = endpoint
	r.deletedTenants = append(r.deletedTenants, tenant.FromContext(ctx))
	return r.err
}

func (r *recordingPushRepository) DeleteSchoolByEndpoint(ctx context.Context, accountID int64, endpoint string) error {
	r.deletedAccount = accountID
	r.deletedEndpoint = endpoint
	r.deletedTenants = append(r.deletedTenants, tenant.FromContext(ctx))
	return r.err
}

func (r *recordingPushRepository) LockParentEndpoint(context.Context, string) error {
	r.operations = append(r.operations, "lock")
	return nil
}

func (r *recordingPushRepository) DeleteParentByAccountEndpoint(ctx context.Context, accountID int64, endpoint string) error {
	r.operations = append(r.operations, "remove")
	r.deletedAccount = accountID
	r.deletedEndpoint = endpoint
	r.deletedTenants = append(r.deletedTenants, tenant.FromContext(ctx))
	return r.err
}

func (r *recordingPushRepository) DeleteParentByEndpoint(_ context.Context, endpoint string) error {
	r.reboundEndpoint = endpoint
	r.operations = append(r.operations, "clear")
	return r.deleteParentErr
}

func (r *recordingPushRepository) DeleteSchoolByEndpointAcrossTenants(_ context.Context, endpoint string) error {
	r.reboundEndpoint = endpoint
	r.operations = append(r.operations, "clear-school")
	return r.deleteSchoolErr
}

func validPushInput() PushSubscriptionInput {
	return PushSubscriptionInput{
		Endpoint:  "https://fcm.googleapis.com/fcm/send/device",
		P256dh:    "p256dh-key",
		Auth:      "auth-key",
		UserAgent: "test-agent",
	}
}

func TestPushSubscriptionServiceStaffLifecycle(t *testing.T) {
	t.Parallel()
	t.Run("reports configuration state", func(t *testing.T) {
		unconfigured := newMockPushSubscriptionService(t, nil, nil, VAPIDConfig{}, nil)
		_, err := unconfigured.PublicKey()
		require.ErrorIs(t, err, ErrWebPushNotConfigured)

		configured := newMockPushSubscriptionService(t, nil, nil, testVAPID(), nil)
		key, err := configured.PublicKey()
		require.NoError(t, err)
		assert.Equal(t, "pub", key)
	})

	t.Run("rejects subscribe without VAPID keys", func(t *testing.T) {
		service := newMockPushSubscriptionService(t, nil, nil, VAPIDConfig{}, nil)
		err := service.Subscribe(context.Background(), 42, validPushInput())
		require.ErrorIs(t, err, ErrWebPushNotConfigured)
	})

	t.Run("validates and stores staff subscription", func(t *testing.T) {
		repo := &recordingPushRepository{}
		service := newMockPushSubscriptionService(t, nil, repo, testVAPID(), nil)
		ctx := tenant.WithTenantID(context.Background(), 42)

		input := validPushInput()
		input.TokenFamilyID = "family-1"
		require.NoError(t, service.Subscribe(ctx, 42, input))
		require.Len(t, repo.upserted, 1)
		assert.Equal(t, int64(42), repo.upserted[0].AccountID)
		assert.Equal(t, deliveryModels.PushPortalStaff, repo.upserted[0].Portal)
		assert.Equal(t, "test-agent", repo.upserted[0].UserAgent)
		assert.Equal(t, "family-1", repo.upserted[0].TokenFamilyID)

		invalid := validPushInput()
		invalid.Endpoint = "http://fcm.googleapis.com/fcm/send/device"
		err := service.Subscribe(context.Background(), 42, invalid)
		require.ErrorIs(t, err, ErrInvalidPushSubscription)
		assert.ErrorContains(t, err, "endpoint must be an https URL")
	})

	t.Run("forwards repository errors and unsubscribe", func(t *testing.T) {
		repo := &recordingPushRepository{err: errPushRepository}
		service := newMockPushSubscriptionService(t, nil, repo, testVAPID(), nil)
		ctx := tenant.WithTenantID(context.Background(), 42)

		require.ErrorIs(t, service.Subscribe(ctx, 42, validPushInput()), errPushRepository)
		require.ErrorIs(t, service.Unsubscribe(ctx, 42, "https://fcm.googleapis.com/fcm/send/device"), errPushRepository)
		require.ErrorIs(t, service.UnsubscribeSchool(ctx, 42, "https://fcm.googleapis.com/fcm/send/device"), errPushRepository)
		assert.Equal(t, int64(42), repo.deletedAccount)
		assert.Equal(t, "https://fcm.googleapis.com/fcm/send/device", repo.deletedEndpoint)
	})
}

func TestPushSubscriptionServiceParentLifecycle(t *testing.T) {
	t.Parallel()
	t.Run("rejects subscribe without VAPID keys", func(t *testing.T) {
		service := newMockPushSubscriptionService(t, nil, nil, VAPIDConfig{}, nil)
		err := service.SubscribeParent(context.Background(), 42, validPushInput())
		require.ErrorIs(t, err, ErrWebPushNotConfigured)
	})

	t.Run("stores and removes one parent device without a school", func(t *testing.T) {
		repo := &recordingPushRepository{}
		service := newMockPushSubscriptionService(t, nil, repo, testVAPID(), nil)

		input := validPushInput()
		input.TokenFamilyID = "parent-family"
		require.NoError(t, service.SubscribeParent(context.Background(), 42, input))
		require.Len(t, repo.upserted, 1)
		assert.Zero(t, repo.upserted[0].TenantID)
		assert.Equal(t, deliveryModels.PushPortalParent, repo.upserted[0].Portal)
		assert.Equal(t, input.TokenFamilyID, repo.upserted[0].TokenFamilyID)
		assert.Equal(t, input.Endpoint, repo.reboundEndpoint)
		assert.Equal(t, []string{"clear", "upsert:0"}, repo.operations)

		require.NoError(t, service.UnsubscribeParent(context.Background(), 42, input.Endpoint))
		assert.Equal(t, int64(42), repo.deletedAccount)
		assert.Equal(t, input.Endpoint, repo.deletedEndpoint)
		assert.Equal(t, []int64{0}, repo.deletedTenants)
		assert.Equal(t, []string{"clear", "upsert:0", "lock", "remove"}, repo.operations)
	})

	t.Run("reports validation and repository errors", func(t *testing.T) {
		repo := &recordingPushRepository{err: errPushRepository}
		service := newMockPushSubscriptionService(t, nil, repo, testVAPID(), nil)
		invalid := validPushInput()
		invalid.Endpoint = "invalid"
		err := service.SubscribeParent(context.Background(), 42, invalid)
		require.ErrorIs(t, err, ErrInvalidPushSubscription)
		assert.ErrorContains(t, err, "endpoint must be an https URL")

		require.ErrorIs(t, service.SubscribeParent(context.Background(), 42, validPushInput()), errPushRepository)
		require.ErrorIs(t, service.UnsubscribeParent(context.Background(), 42, validPushInput().Endpoint), errPushRepository)
	})

	t.Run("reports previous binding cleanup errors", func(t *testing.T) {
		repo := &recordingPushRepository{deleteParentErr: errPushRepository}
		service := newMockPushSubscriptionService(t, nil, repo, testVAPID(), nil)

		err := service.SubscribeParent(context.Background(), 42, validPushInput())
		require.ErrorIs(t, err, errPushRepository)
		assert.ErrorContains(t, err, "clearing previous parent push subscription bindings")
		assert.Empty(t, repo.upserted)
	})
}

func TestPushSubscriptionServiceParentSubscribeIsAtomic(t *testing.T) {
	t.Parallel()
	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})

	mock.ExpectBegin()
	mock.ExpectExec("SET LOCAL ROLE phoenix_admin").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	repo := &recordingPushRepository{err: errPushRepository}
	service := newMockPushSubscriptionService(t, db, repo, testVAPID(), nil)

	err = service.SubscribeParent(context.Background(), 77, validPushInput())

	require.ErrorIs(t, err, errPushRepository)
	assert.Equal(t, []string{"clear", "upsert:0"}, repo.operations)
	require.NoError(t, mock.ExpectationsWereMet(), "insertion failure must roll back the previous binding’s removal")
}
