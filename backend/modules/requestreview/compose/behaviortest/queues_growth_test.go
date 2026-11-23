package behaviortest

import (
	"context"
	"fmt"
	"testing"
	"time"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// Exercise the merged page and badge with multiple children, not merely
// multiple request types belonging to one child.
func TestRequestReviewQueryBudgetGrowth(t *testing.T) {
	t.Parallel()
	pool := testpkg.SetupTestDB(t)
	WithGrowthQuery(t, func(db *bun.DB, query GrowthQuery) {
		require.Same(t, pool, db)
		for _, n := range []int{3, 8} {
			t.Run(fmt.Sprintf("N%d", n), func(t *testing.T) {
				assertReviewGrowth(t, db, query, n)
			})
		}
	})
}

func assertReviewGrowth(t *testing.T, db *bun.DB, query GrowthQuery, n int) {
	t.Helper()
	testpkg.OwnTenant(t)
	byStudent := make(map[string]testpkg.RequestReviewSchool, n)
	var ctx context.Context
	for i := range n {
		school := testpkg.CreateTestRequestReviewSchool(t, db, fmt.Sprintf("growth-%d-%d", n, i))
		byStudent[fmt.Sprint(school.StudentID)] = school
		ctx = GrowthWriteContext(school.Context)
	}
	counter := testpkg.CaptureQueriesForContext(t, db)
	require.NoError(t, testpkg.WithTenantTx(t, counter.Context(ctx), db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
		page, err := query.ListRequests(txCtx, GrowthListQuery{Search: "ReviewRLS", Limit: GrowthMaxLimit})
		require.NoError(t, err)
		require.Len(t, page.Items, 4*n)
		require.Empty(t, page.NextCursor)
		assertReviewGrowthPage(t, page, byStudent)
		if n == 3 {
			querybudgets.AssertQueryBudget(t, "modules.requestreview.open_page.three_children", counter.Measurement(counter.Queries()))
		} else {
			querybudgets.AssertQueryBudget(t, "modules.requestreview.open_page.eight_children", counter.Measurement(counter.Queries()))
		}
		return nil
	}))
	badge := testpkg.CaptureQueriesForContext(t, db)
	require.NoError(t, testpkg.WithTenantTx(t, badge.Context(ctx), db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
		count, err := query.PendingCount(txCtx)
		require.NoError(t, err)
		require.Equal(t, 4*n, count)
		if n == 3 {
			querybudgets.AssertQueryBudget(t, "modules.requestreview.pending_count.three_children", badge.Measurement(badge.Queries()))
		} else {
			querybudgets.AssertQueryBudget(t, "modules.requestreview.pending_count.eight_children", badge.Measurement(badge.Queries()))
		}
		return nil
	}))
	assertHistoryGrowth(t, db, query, ctx, byStudent)
}

// assertHistoryGrowth reuses the open page's children: every request is
// decided and the office corrects each child's offerings directly, so the
// history lists one row of each of its five types per child.
func assertHistoryGrowth(t *testing.T, db *bun.DB, query GrowthQuery, ctx context.Context, byStudent map[string]testpkg.RequestReviewSchool) {
	t.Helper()
	n := len(byStudent)
	decidedAt := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	for _, school := range byStudent {
		for table, id := range school.Rows {
			_, err := db.NewRaw("UPDATE ? SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?",
				bun.Ident(table), school.AccountID, decidedAt, id).Exec(testpkg.Ctx(t))
			require.NoError(t, err)
		}
		testpkg.CreateTestOfferingCorrection(t, db, school.StudentID, "direct", decidedAt)
	}
	counter := testpkg.CaptureQueriesForContext(t, db)
	require.NoError(t, testpkg.WithTenantTx(t, counter.Context(ctx), db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
		page, err := query.ListRequests(txCtx, GrowthListQuery{History: true, Search: "ReviewRLS", Limit: GrowthMaxLimit})
		require.NoError(t, err)
		require.Len(t, page.Items, 5*n)
		require.Empty(t, page.NextCursor)
		assertGrowthTypesPerChild(t, page, byStudent, GrowthHistoryTypes())
		if n == 3 {
			querybudgets.AssertQueryBudget(t, "modules.requestreview.history_page.three_children", counter.Measurement(counter.Queries()))
		} else {
			querybudgets.AssertQueryBudget(t, "modules.requestreview.history_page.eight_children", counter.Measurement(counter.Queries()))
		}
		return nil
	}))
}

func assertReviewGrowthPage(t *testing.T, page GrowthPage, byStudent map[string]testpkg.RequestReviewSchool) {
	t.Helper()
	assertGrowthTypesPerChild(t, page, byStudent, GrowthRequestTypes())
	for _, item := range page.Items {
		require.Equal(t, byStudent[item.StudentID].GroupName, item.GroupName)
	}
}

func assertGrowthTypesPerChild(t *testing.T, page GrowthPage, byStudent map[string]testpkg.RequestReviewSchool, types []string) {
	t.Helper()
	counts := make(map[string]int)
	for _, item := range page.Items {
		_, ok := byStudent[item.StudentID]
		require.True(t, ok, "the page must not include another tenant's child")
		counts[item.StudentID+":"+item.RequestType]++
	}
	for id := range byStudent {
		for _, typ := range types {
			require.Equal(t, 1, counts[id+":"+typ], "%s of child %s", typ, id)
		}
	}
}
