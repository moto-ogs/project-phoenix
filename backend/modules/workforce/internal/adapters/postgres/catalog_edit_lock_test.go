package postgres

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// An edit of a catalogue row changes no key column, so its lock lets a row
// that references it through: the FK check of a new shift, series, binding
// or qualification takes FOR KEY SHARE. Only the removal of a shift type
// holds them, as its reference count must stay true until it commits.
func TestCatalogEditLocksLetReferencesThrough(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	school := testpkg.Tenant(t)
	ctx := testpkg.Ctx(t)
	insert := func(query string) int64 {
		var id int64
		require.NoError(t, db.NewRaw(query, school).Scan(ctx, &id))
		return id
	}
	shiftType := insert(`INSERT INTO schedule.shift_types (tenant_id, name, color) VALUES (?, 'Frühdienst', '#123456') RETURNING id`)
	model := insert(`INSERT INTO config.work_time_models (tenant_id, name, rotation_length, rotation_anchor_date) VALUES (?, 'Vollzeit', 1, '2026-10-12') RETURNING id`)
	kind := insert(`INSERT INTO users.staff_qualification_types (tenant_id, name) VALUES (?, 'Erste Hilfe') RETURNING id`)
	store := New(DatabaseRuntime(db)).WithClock(func() time.Time { return calendar.NewDate(2026, time.October, 12).BerlinMidnight() })

	for _, tc := range []struct {
		name    string
		table   string
		id      int64
		lock    func(context.Context) (bool, domain.OperationStats, error)
		blocked bool
	}{
		{"shift type edit", tableShiftTypes, shiftType, func(ctx context.Context) (bool, domain.OperationStats, error) {
			return store.LockShiftTypeForEdit(ctx, shiftType)
		}, false},
		{"shift type removal", tableShiftTypes, shiftType, func(ctx context.Context) (bool, domain.OperationStats, error) {
			return store.LockShiftType(ctx, shiftType)
		}, true},
		{"work-time model edit", tableWorkTimeModels, model, func(ctx context.Context) (bool, domain.OperationStats, error) {
			return store.LockWorkTimeModel(ctx, model)
		}, false},
		{"qualification type edit", tableStaffQualificationTypes, kind, func(ctx context.Context) (bool, domain.OperationStats, error) {
			return store.LockQualificationType(ctx, kind)
		}, false},
	} {
		require.NoError(t, testpkg.WithinTenantContext(t, ctx, db, school, func(ctx context.Context) error {
			locked, _, err := tc.lock(ctx)
			require.NoError(t, err, tc.name)
			require.True(t, locked, tc.name)
			err = keyShare(ctx, db, tc.table, tc.id)
			if tc.blocked {
				require.Error(t, err, "%s holds a reference", tc.name)
			} else {
				require.NoError(t, err, "%s lets a reference through", tc.name)
			}
			return nil
		}))
	}
}

// keyShare is the lock a foreign key check takes on the referenced row,
// from a transaction of its own that gives up after a short wait.
func keyShare(ctx context.Context, db *bun.DB, table string, id int64) error {
	reference, err := db.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = reference.Rollback() }()
	if _, err := reference.ExecContext(ctx, `SET LOCAL lock_timeout = '300ms'`); err != nil {
		return err
	}
	var found int
	return reference.NewRaw(`SELECT 1 FROM `+table+` WHERE id = ? FOR KEY SHARE`, id).Scan(ctx, &found)
}
