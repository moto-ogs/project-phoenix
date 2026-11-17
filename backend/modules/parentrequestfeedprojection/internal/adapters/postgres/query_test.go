package parentrequestfeedprojection

import (
	"context"
	"strings"
	"testing"
	"time"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestListNewParentRequestsReturnsOnlyRequestsAwaitingReview(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	chain := testpkg.CreateTestParentGuardianChain(t, db)
	phase := testpkg.CreateTestEnrollmentPhase(t, db)

	type expectedEntry struct {
		Kind string `bun:"kind"`
		ID   int64  `bun:"id"`
	}
	// Each owner stamps created_at on its own clock (ADR 0281), so the rows
	// carry the instant the feed's window is opened from, not a column default.
	createdAt := time.Date(2026, time.November, 18, 9, 0, 0, 0, time.UTC)
	expected := []expectedEntry{}
	require.NoError(t, db.NewRaw(`
		WITH stamp AS (
			SELECT ?::timestamptz AS at
		), enrollment_request AS (
			INSERT INTO enrollment.requests
				(tenant_id, phase_id, guardian_first_name, guardian_last_name, guardian_email, status_token)
			VALUES (?, ?, 'Feed', 'Guardian', ?, ?)
			RETURNING id
		), request_child AS (
			INSERT INTO enrollment.request_children
				(tenant_id, request_id, first_name, last_name, date_of_birth, status, created_student_id)
			SELECT ?, id, 'Feed', 'Child', CURRENT_DATE - 2500, 'approved', ?
			FROM enrollment_request
			RETURNING id, request_id
		), master_data AS (
			INSERT INTO users.student_data_change_requests
				(tenant_id, student_id, submitted_by, target, field_key, new_value, status, created_at)
			SELECT tenant_id, student_id, submitted_by, target, field_key, new_value::jsonb, status, stamp.at
			FROM (VALUES
				(?::bigint, ?::bigint, ?::bigint, 'student', 'school_class', '"2a"', 'pending'),
				(?, ?, ?, 'student', 'school_class', '"2b"', 'approved')
			) AS rows(tenant_id, student_id, submitted_by, target, field_key, new_value, status)
			CROSS JOIN stamp
			RETURNING id, status
		), care_schedule AS (
			INSERT INTO schedule.care_schedule_change_requests
				(tenant_id, student_id, submitted_by, payload, status, created_at)
			SELECT tenant_id, student_id, submitted_by, '{}'::jsonb, status, stamp.at
			FROM (VALUES
				(?::bigint, ?::bigint, ?::bigint, 'pending'),
				(?, ?, ?, 'rejected')
			) AS rows(tenant_id, student_id, submitted_by, status)
			CROSS JOIN stamp
			RETURNING id, status
		), offering AS (
			INSERT INTO enrollment.offering_change_requests
				(tenant_id, student_id, request_child_id, submitted_by, payload, effective_from, status, created_at)
			SELECT ?, ?, id, ?, '{"offerings":[]}'::jsonb, CURRENT_DATE, status, stamp.at
			FROM request_child
			CROSS JOIN stamp
			CROSS JOIN (VALUES ('pending'), ('withdrawn')) AS statuses(status)
			RETURNING id, status
		), excused_absence AS (
			INSERT INTO active.excused_absence_requests
				(tenant_id, student_id, submitted_by, dates, note, status, absence_status, created_at)
			SELECT tenant_id, student_id, submitted_by, to_jsonb(ARRAY[CURRENT_DATE::TEXT]), 'Feed test', status, 'excused', stamp.at
			FROM (VALUES
				(?::bigint, ?::bigint, ?::bigint, 'pending'),
				(?, ?, ?, 'done')
			) AS rows(tenant_id, student_id, submitted_by, status)
			CROSS JOIN stamp
			RETURNING id, status
		), enrollment_change AS (
			INSERT INTO enrollment.change_requests
				(tenant_id, request_id, request_child_id, origin, status, base_snapshot, proposed_snapshot, diff_json, created_at)
			SELECT ?, request_id, id, 'parent', status, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, stamp.at
			FROM request_child
			CROSS JOIN stamp
			CROSS JOIN (VALUES ('pending_review'), ('approved')) AS statuses(status)
			RETURNING id, status
		)
		SELECT 'master_data'::text AS kind, id FROM master_data WHERE status = 'pending'
		UNION ALL SELECT 'care_schedule', id FROM care_schedule WHERE status = 'pending'
		UNION ALL SELECT 'offering', id FROM offering WHERE status = 'pending'
		UNION ALL SELECT 'excused_absence', id FROM excused_absence WHERE status = 'pending'
		UNION ALL SELECT 'enrollment', id FROM enrollment_change WHERE status = 'pending_review'
	`,
		createdAt,
		chain.TenantID, phase.ID, chain.Email, "feed-"+chain.Email,
		chain.TenantID, chain.StudentID,
		chain.TenantID, chain.StudentID, chain.AccountID,
		chain.TenantID, chain.StudentID, chain.AccountID,
		chain.TenantID, chain.StudentID, chain.AccountID,
		chain.TenantID, chain.StudentID, chain.AccountID,
		chain.TenantID, chain.StudentID, chain.AccountID,
		chain.TenantID, chain.StudentID, chain.AccountID,
		chain.TenantID, chain.StudentID, chain.AccountID,
		chain.TenantID,
	).Scan(testpkg.Ctx(t), &expected))

	var entries []Entry
	err := testpkg.WithTenantTx(t, testpkg.Ctx(t), db, chain.TenantID, func(ctx context.Context, tx bun.Tx) error {
		var listErr error
		entries, listErr = ListNewParentRequests(ctx, tx, chain.TenantID, createdAt.Add(-time.Hour), true, true)
		return listErr
	})
	require.NoError(t, err)

	actual := make([]expectedEntry, 0, len(entries))
	for _, entry := range entries {
		actual = append(actual, expectedEntry{Kind: entry.Kind, ID: entry.ID})
	}
	require.ElementsMatch(t, expected, actual)
}

func TestResolveAccessRequiresSchoolWideRightsAndActiveMembership(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	account := testpkg.CreateTestAccount(t, db, "request-feed-access@example.test")
	tenantID := testpkg.Tenant(t)

	var access Access
	var found bool
	err := testpkg.WithTenantTx(t, testpkg.Ctx(t), db, tenantID, func(ctx context.Context, tx bun.Tx) error {
		var resolveErr error
		access, found, resolveErr = ResolveAccess(ctx, tx, tenantID, account.ID)
		return resolveErr
	})
	require.NoError(t, err)
	require.True(t, found)
	require.False(t, access.GeneralRequests, "a plain account must not get a school-wide feed")
	require.False(t, access.EnrollmentRequests)

	testpkg.GrantTestPermission(t, db, tenantID, account.ID, "config:manage")
	err = testpkg.WithTenantTx(t, testpkg.Ctx(t), db, tenantID, func(ctx context.Context, tx bun.Tx) error {
		var resolveErr error
		access, found, resolveErr = ResolveAccess(ctx, tx, tenantID, account.ID)
		return resolveErr
	})
	require.NoError(t, err)
	require.True(t, found)
	require.False(t, access.GeneralRequests)
	require.True(t, access.EnrollmentRequests, "enrollment managers receive only enrollment requests")

	adminRole := testpkg.GetOrCreateTestRole(t, db, "admin")
	_, err = db.ExecContext(testpkg.Ctx(t), `
		INSERT INTO auth.account_roles (tenant_id, account_id, role_id)
		VALUES (?, ?, ?)
	`, tenantID, account.ID, adminRole.ID)
	require.NoError(t, err)

	err = testpkg.WithTenantTx(t, testpkg.Ctx(t), db, tenantID, func(ctx context.Context, tx bun.Tx) error {
		var resolveErr error
		access, found, resolveErr = ResolveAccess(ctx, tx, tenantID, account.ID)
		return resolveErr
	})
	require.NoError(t, err)
	require.True(t, found)
	require.True(t, access.GeneralRequests)
	require.NotEmpty(t, access.SchoolName)
	require.NotEmpty(t, access.Subdomain)

	_, err = db.ExecContext(testpkg.Ctx(t), `
		UPDATE auth.account_tenants
		SET status = 'inactive', deactivated_at = NOW()
		WHERE tenant_id = ? AND account_id = ?
	`, tenantID, account.ID)
	require.NoError(t, err)

	err = testpkg.WithTenantTx(t, testpkg.Ctx(t), db, tenantID, func(ctx context.Context, tx bun.Tx) error {
		_, found, err = ResolveAccess(ctx, tx, tenantID, account.ID)
		return err
	})
	require.NoError(t, err)
	require.False(t, found)
}

func TestMain(m *testing.M) {
	testpkg.PerTestTenants()
	testpkg.Run(m)
}

// feedSince lies before every row these tests insert: PostgreSQL stamps
// created_at at the insert, so the feed lists them on every day.
var feedSince = time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)

// The feed lists the five queues in one statement, inside the caller's
// transaction (#2940).
func TestListNewParentRequestsQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	counter := testpkg.CaptureQueriesForContext(t, db)
	counter.Reset()

	// Simulate the same read from another request while capture is active.
	// A package pool is shared even when the callers have different tenants.
	read := func(ctx context.Context) error {
		return testpkg.WithTenantTx(t, ctx, db, testpkg.Tenant(t), func(ctx context.Context, tx bun.Tx) error {
			_, listErr := NewReader(func(context.Context) (bun.IDB, error) { return tx, nil }).ListNewParentRequests(ctx, testpkg.Tenant(t), feedSince, true, true)
			return listErr
		})
	}
	require.NoError(t, read(testpkg.Ctx(t)))
	require.NoError(t, read(counter.Context(testpkg.Ctx(t))))
	querybudgets.AssertQueryBudget(t, "modules.careplan.request_feed.list", counter.Measurement(counter.Matching(func(sqlLower string) bool {
		return strings.Contains(sqlLower, "select kind, id, created_at")
	})))
}
