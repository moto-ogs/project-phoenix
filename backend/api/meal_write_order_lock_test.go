package api

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A meal registration write holds the child's student row while it waits
// for the school's order lock. The holder of that lock (the worker fixing
// due orders, or the write of another child recording its pending changes)
// inserts order lines and changes of the child, whose foreign key takes a
// key share on the same student row. The write's row lock must not refuse
// that key share, or the two wait for each other (40P01).
func TestMealWritesLetTheOrderLockHolderReferenceTheChild(t *testing.T) {
	t.Parallel()
	rig := newMealWriteRig(t)
	writes := map[string]func(t *testing.T, f mealWriteFamily) error{
		"school day": func(t *testing.T, f mealWriteFamily) error {
			return testpkg.WithinTenantContext(t, testpkg.Ctx(t), rig.db, f.TenantID, func(ctx context.Context) error {
				return rig.meals().SetParticipationBySchool(ctx, mealplan.SchoolChange{StudentID: f.StudentID, StaffAccountID: f.staffAccountID, Date: mealplan.Date(mealWriteWednesday.String()), Participating: false})
			})
		},
		"parent day": func(t *testing.T, f mealWriteFamily) error {
			call := mealDay(f.StudentID, mealWriteWednesday, false)
			req := testutil.NewAuthenticatedRequest(t, call.method, call.path, call.body, testutil.WithJWTBearer(f.token))
			if rec := testutil.ExecuteRequest(rig.router, req); rec.Code != http.StatusOK && rec.Code != http.StatusNoContent {
				return fmt.Errorf("parent day: %d %s", rec.Code, rec.Body.String())
			}
			return nil
		},
	}
	day := calendar.NewDate(2026, 10, 5)
	for name, write := range writes {
		// One after the other: the families share the school's order lock.
		t.Run(name, func(t *testing.T) {
			lockOrderScenario(t, rig, day, write)
		})
		day = day.AddDays(7)
	}
}

// lockOrderScenario holds the order lock with an order of day, lets the
// write wait for it and then adds the write's child to that order.
func lockOrderScenario(t *testing.T, rig mealWriteRig, day calendar.Date, write func(*testing.T, mealWriteFamily) error) {
	{
		name := t.Name()
		f := rig.mealFamily(t)
		ctx := context.Background()
		holder, err := rig.super.BeginTx(ctx, nil)
		require.NoError(t, err, name)
		_, err = holder.ExecContext(ctx, `SET LOCAL lock_timeout = '15s'`)
		require.NoError(t, err, name)
		_, err = holder.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended(?, 0))`, fmt.Sprintf("meal-orders:%d", f.TenantID))
		require.NoError(t, err, name)
		var orderID int64
		require.NoError(t, holder.NewRaw(`INSERT INTO schedule.meal_orders (tenant_id, period_start, period_end, deadline_at) VALUES (?, ?, ?, NOW()) RETURNING id`, f.TenantID, day, day).Scan(ctx, &orderID), name)
		_, err = holder.ExecContext(ctx, `INSERT INTO schedule.meal_order_days (tenant_id, order_id, date) VALUES (?, ?, ?)`, f.TenantID, orderID, day)
		require.NoError(t, err, name)

		done := make(chan error, 1)
		go func() { done <- write(t, f) }()
		// The write holds the child's row and waits for the order lock.
		require.Eventually(t, func() bool {
			var waiting int
			err := rig.super.NewRaw(`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND wait_event = 'advisory' AND query LIKE ?`, fmt.Sprintf("%%meal-orders:%d'%%", f.TenantID)).Scan(ctx, &waiting)
			return err == nil && waiting == 1
		}, 10*time.Second, 20*time.Millisecond, "%s: the write waits for the order lock", name)

		_, err = holder.ExecContext(ctx, `INSERT INTO schedule.meal_order_lines (tenant_id, order_id, date, student_id) VALUES (?, ?, ?, ?)`, f.TenantID, orderID, day, f.StudentID)
		if err != nil {
			_ = holder.Rollback()
			<-done
			t.Fatalf("%s: the order line of the locked child: %v", name, err)
		}
		require.NoError(t, holder.Commit(), name)
		select {
		case err := <-done:
			require.NoError(t, err, name)
		case <-time.After(20 * time.Second):
			t.Fatalf("%s: the write did not finish", name)
		}
	}
}
