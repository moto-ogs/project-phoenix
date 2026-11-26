package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// traegerCancelledInstancesSQL counts the day's cancelled instances of the
// given schools. The filter on the school set is the boundary: the
// administrative transaction has no row security.
const traegerCancelledInstancesSQL = `SELECT tenant_id, COUNT(*) AS cancelled FROM schedule.activity_instances
WHERE tenant_id = ANY(?0) AND date = ?1 AND status = 'cancelled'
GROUP BY tenant_id`

// CountCancelledInstancesByTenant counts the cancelled instances of the day
// per school (#7672). It runs only in the administrative transaction of the
// Träger projection, never in a school transaction.
func (s *Store) CountCancelledInstancesByTenant(ctx context.Context, schools []int64, day calendar.Date) (map[int64]int, domain.OperationStats, error) {
	db, err := administrativeDB(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	var rows []struct {
		TenantID  int64 `bun:"tenant_id"`
		Cancelled int   `bun:"cancelled"`
	}
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	err = db.NewRaw(traegerCancelledInstancesSQL, pgdialect.Array(schools), day).Scan(ctx, &rows)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return nil, stats, fmt.Errorf("timetable postgres: cancelled instances of a Träger: %w", err)
	}
	stats.Rows = int64(len(rows))
	counts := make(map[int64]int, len(rows))
	for _, row := range rows {
		counts[row.TenantID] = row.Cancelled
	}
	return counts, stats, nil
}

// administrativeDB returns the caller's administrative transaction.
func administrativeDB(ctx context.Context) (bun.IDB, error) {
	if !tenant.IsAdminTx(ctx) {
		return nil, errors.New("timetable postgres: the cancelled blocks of a Träger need the administrative transaction")
	}
	transaction, ok := tenant.TransactionFromContext(ctx)
	if !ok {
		return nil, errors.New("timetable postgres: transaction is required")
	}
	switch tx := transaction.(type) {
	case bun.Tx:
		return tx, nil
	case *bun.Tx:
		if tx != nil {
			return *tx, nil
		}
	}
	return nil, fmt.Errorf("timetable postgres: unsupported transaction %T", transaction)
}
