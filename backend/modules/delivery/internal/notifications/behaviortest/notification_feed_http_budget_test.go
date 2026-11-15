//go:build testhooks

package notifications_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/require"
)

// N is the number of feed entries of the account (#7148). The page, the
// unread count and the role check of the reader are a fixed number of
// statements, whatever the feed holds; another account's entries stay out.
// The staff portal and moto schule (#7139) read the same entries.
func TestNotificationFeedHTTPQueryBudget(t *testing.T) {
	t.Parallel()
	t.Run("staff", func(t *testing.T) {
		assertNotificationFeedQueryBudget(t, "", "/api/notifications/feed/", func(t *testing.T, measurement querybudgets.Measurement) {
			t.Helper()
			querybudgets.AssertQueryBudget(t, "api.notifications.feed", measurement)
		})
	})
	t.Run("school", func(t *testing.T) {
		assertNotificationFeedQueryBudget(t, "school", "/school/notifications/feed/", func(t *testing.T, measurement querybudgets.Measurement) {
			t.Helper()
			querybudgets.AssertQueryBudget(t, "school.notifications.feed", measurement)
		})
	})
}

func assertNotificationFeedQueryBudget(t *testing.T, scope, path string, assertBudget func(*testing.T, querybudgets.Measurement)) {
	t.Helper()
	db := testpkg.SetupIsolatedTestDB(t)
	module, err := api.NewDeliveryTestModule(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	router := module.NotificationPreferenceRouterForTests()
	_, account := testpkg.CreateTestStaffWithAccount(t, db, "Budget", "Feed")
	testpkg.MapAccountToTenant(t, db, account.ID, testpkg.Tenant(t))
	testpkg.AssignLehrkraftSystemRole(t, db, account.ID, testpkg.Tenant(t))
	other := testpkg.CreateTestAccount(t, db, "other-feed")
	insert := func(accountID int64, objectID int) {
		t.Helper()
		_, err := db.ExecContext(context.Background(), `INSERT INTO platform.notification_feed_entries
			(tenant_id, account_id, type, title, body, deep_link, related_type, related_id)
			VALUES (?, ?, 'instance_cancelled', 'Termin abgesagt', 'Ein Termin fällt aus.', '/mein-dienstplan?d=2030-06-11', 'activity_instance', ?)`,
			testpkg.Tenant(t), accountID, objectID)
		require.NoError(t, err)
	}
	insert(other.ID, 1)
	claims := testutil.TeacherTestClaims(int(account.ID))
	claims.TenantID = testpkg.Tenant(t)
	claims.Scope = scope
	token := testutil.MintTestJWT(t, claims)
	counter := testpkg.CaptureQueries(t, db)
	previous, statements := 0, 0
	for _, n := range []int{0, 3, 8} {
		for i := previous; i < n; i++ {
			insert(account.ID, 100+i)
		}
		counter.Reset()
		request := testutil.NewAuthenticatedRequest(t, http.MethodGet, path, nil, testutil.WithJWTBearer(token))
		response := testutil.ExecuteRequestForTest(t, router, request)
		counter.Stop()
		measurement := counter.Measurement(counter.Queries())
		assertBudget(t, measurement)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var page struct {
			Data struct {
				Entries     []json.RawMessage `json:"entries"`
				UnreadCount int               `json:"unread_count"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &page))
		require.Len(t, page.Data.Entries, n)
		require.Equal(t, n, page.Data.UnreadCount)
		if statements > 0 {
			require.Len(t, counter.Queries(), statements, "feed entries must not add round trips")
		}
		statements = len(counter.Queries())
		previous = n
		counter.Start()
	}
	counter.Stop()
}
