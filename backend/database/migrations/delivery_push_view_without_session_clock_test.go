package migrations

import (
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestDeliveryPushViewWithoutSessionClockRoundTrip(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()
	assertView := func(wantLiveness bool) {
		t.Helper()
		var secure, selectable, liveness bool
		require.NoError(t, db.NewRaw(`SELECT reloptions @> ARRAY['security_invoker=true', 'security_barrier=true'], has_table_privilege('phoenix_tenant', oid, 'SELECT'),
			EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = oid AND attname = 'has_live_token' AND NOT attisdropped)
			FROM pg_class WHERE oid = 'platform.delivery_push_subscriptions'::regclass`).Scan(ctx, &secure, &selectable, &liveness))
		require.True(t, secure)
		require.True(t, selectable)
		require.Equal(t, wantLiveness, liveness)
	}
	assertView(false)
	require.NoError(t, deliveryPushViewWithoutSessionClockDown(ctx, db))
	assertView(true)
	require.NoError(t, deliveryPushViewWithoutSessionClockUp(ctx, db))
	assertView(false)
}
