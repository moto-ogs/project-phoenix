package migrations

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The history trigger records the removal of a status day while the child
// exists, records nothing in a retention purge, and records nothing when the
// child itself is deleted (#5840): that cascade used to insert a history row
// for the removed child and fail on the history's foreign key.
func TestRecordMealSicknessStatusSkipsTheDeletedChild(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	deleted := testpkg.CreateTestStudent(t, db, "History", "Deleted", "4a")
	kept := testpkg.CreateTestStudent(t, db, "History", "Kept", "4a")

	statusDay := func(studentID int64, date string) int64 {
		t.Helper()
		var id int64
		require.NoError(t, db.NewRaw(`
			INSERT INTO active.student_status_days (tenant_id, student_id, date, status, reported_at, source)
			VALUES (?, ?, ?, 'sick', '2026-09-07 07:30:00+02', 'manual') RETURNING id
		`, tenantID, studentID, date).Scan(ctx, &id))
		return id
	}
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

	// Removing a status day of an existing child stays a clearing.
	removed := statusDay(kept.ID, "2026-09-07")
	_, err := db.ExecContext(ctx, `DELETE FROM active.student_status_days WHERE id = ?`, removed)
	require.NoError(t, err)
	assert.Equal(t, []string{"2026-09-07:open", "2026-09-07:cleared"}, history(kept.ID))

	// The retention purge records nothing.
	purged := statusDay(kept.ID, "2026-09-08")
	require.NoError(t, db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, `SELECT set_config('app.retention_purge', 'on', true)`); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM active.student_status_days WHERE id = ?`, purged)
		return err
	}))
	assert.Equal(t, []string{"2026-09-07:open", "2026-09-07:cleared", "2026-09-08:open"}, history(kept.ID))

	statusDay(deleted.ID, "2026-09-09")
	statusDay(deleted.ID, "2026-09-10")
	require.Len(t, history(deleted.ID), 2)

	// A rolled-back child deletion leaves status days and history in place.
	rollback := errors.New("roll back the child deletion")
	err = db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if err := deleteStudentProfile(ctx, tx, tenantID, deleted.ID); err != nil {
			return err
		}
		return rollback
	})
	require.ErrorIs(t, err, rollback)
	assert.Equal(t, []string{"2026-09-09:open", "2026-09-10:open"}, history(deleted.ID))

	// The committed child deletion cascades without a new history row.
	require.NoError(t, db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		return deleteStudentProfile(ctx, tx, tenantID, deleted.ID)
	}))
	assert.Empty(t, history(deleted.ID), "the cascade removes the child's history and records none")
	var statusDays int
	require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM active.student_status_days WHERE student_id = ?`, deleted.ID).
		Scan(ctx, &statusDays))
	assert.Zero(t, statusDays)
	assert.Equal(t, []string{"2026-09-07:open", "2026-09-07:cleared", "2026-09-08:open"}, history(kept.ID),
		"another child's history stays")
}

func deleteStudentProfile(ctx context.Context, tx bun.Tx, tenantID, studentID int64) error {
	_, err := tx.ExecContext(ctx, `DELETE FROM users.student_profiles WHERE tenant_id = ? AND id = ?`, tenantID, studentID)
	return err
}
