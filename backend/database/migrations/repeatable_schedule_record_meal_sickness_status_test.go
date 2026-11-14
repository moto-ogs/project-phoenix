package migrations

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The history trigger records the clearing and removal of a status day while
// the child exists, also under the tenant role and its RLS, records nothing
// in a retention purge, and records nothing when the child itself is deleted
// (#5840): that cascade used to insert a history row for the removed child
// and fail on the history's foreign key.
func TestRecordMealSicknessStatusSkipsTheDeletedChild(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	deleted := testpkg.CreateTestStudent(t, db, "History", "Deleted", "4a")
	kept := testpkg.CreateTestStudent(t, db, "History", "Kept", "4a")
	day := func(d int) calendar.Date { return calendar.NewDate(2026, time.September, d) }
	history := func(studentID int64) []string {
		t.Helper()
		var rows []string
		require.NoError(t, db.NewRaw(`
			SELECT date::text || CASE WHEN cleared_at IS NULL THEN ':open' ELSE ':cleared' END
			FROM schedule.meal_sickness_status_history
			WHERE tenant_id = ? AND student_id = ?
			ORDER BY id
		`, tenantID, studentID).Scan(ctx, &rows))
		return rows
	}
	asTenant := func(fn func(context.Context, bun.Tx) error) error {
		return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.ExecContext(ctx, `SELECT set_config('role', 'phoenix_tenant', true), set_config('app.current_tenant_id', ?, true)`,
				fmt.Sprint(tenantID)); err != nil {
				return err
			}
			return fn(ctx, tx)
		})
	}

	// Clearing and removing a status day of an existing child stay events,
	// also when the tenant role reads the child under RLS.
	cleared := testpkg.CreateTestStudentStatusDay(t, db, kept.ID, day(7), "sick")
	_, err := db.ExecContext(ctx, `UPDATE active.student_status_days SET cleared_at = reported_at + INTERVAL '1 hour', cleared_source = 'manual' WHERE id = ?`,
		cleared.ID)
	require.NoError(t, err)
	removed := testpkg.CreateTestStudentStatusDay(t, db, kept.ID, day(8), "sick")
	require.NoError(t, asTenant(func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, `DELETE FROM active.student_status_days WHERE id = ?`, removed.ID)
		return err
	}))
	assert.Equal(t, []string{"2026-09-07:open", "2026-09-07:cleared", "2026-09-08:open", "2026-09-08:cleared"}, history(kept.ID))

	// The retention purge records nothing.
	purged := testpkg.CreateTestStudentStatusDay(t, db, kept.ID, day(9), "sick")
	require.NoError(t, db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, `SELECT set_config('app.retention_purge', 'on', true)`); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM active.student_status_days WHERE id = ?`, purged.ID)
		return err
	}))
	keptHistory := []string{"2026-09-07:open", "2026-09-07:cleared", "2026-09-08:open", "2026-09-08:cleared", "2026-09-09:open"}
	assert.Equal(t, keptHistory, history(kept.ID))

	testpkg.CreateTestStudentStatusDay(t, db, deleted.ID, day(10), "sick")
	testpkg.CreateTestStudentStatusDay(t, db, deleted.ID, day(11), "excused")
	require.Equal(t, []string{"2026-09-10:open", "2026-09-11:open"}, history(deleted.ID))

	// A rolled-back child deletion leaves status days and history in place.
	rollback := errors.New("roll back the child deletion")
	err = asTenant(func(ctx context.Context, tx bun.Tx) error {
		if err := deleteStudentProfile(ctx, tx, tenantID, deleted.ID); err != nil {
			return err
		}
		return rollback
	})
	require.ErrorIs(t, err, rollback)
	assert.Equal(t, []string{"2026-09-10:open", "2026-09-11:open"}, history(deleted.ID))

	// The committed child deletion cascades without a new history row.
	require.NoError(t, asTenant(func(ctx context.Context, tx bun.Tx) error {
		return deleteStudentProfile(ctx, tx, tenantID, deleted.ID)
	}))
	assert.Empty(t, history(deleted.ID), "the cascade removes the child's history and records none")
	var statusDays int
	require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM active.student_status_days WHERE student_id = ?`, deleted.ID).
		Scan(ctx, &statusDays))
	assert.Zero(t, statusDays)
	assert.Equal(t, keptHistory, history(kept.ID), "another child's history stays")
}

func deleteStudentProfile(ctx context.Context, tx bun.Tx, tenantID, studentID int64) error {
	_, err := tx.ExecContext(ctx, `DELETE FROM users.student_profiles WHERE tenant_id = ? AND id = ?`, tenantID, studentID)
	return err
}
