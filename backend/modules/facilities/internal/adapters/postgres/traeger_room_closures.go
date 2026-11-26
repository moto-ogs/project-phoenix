package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NewTraegerRoomClosures counts on the caller's administrative transaction.
func NewTraegerRoomClosures(transaction func(context.Context) (any, bool), admin func(context.Context) bool) facilities.TraegerRoomClosures {
	return traegerRoomClosures{transaction: transaction, admin: admin}
}

type traegerRoomClosures struct {
	transaction func(context.Context) (any, bool)
	admin       func(context.Context) bool
}

// traegerClosedRoomsSQL counts the rooms of the given schools a closure
// closes on the day. The filter on the school set is the boundary: the
// administrative transaction has no row security.
const traegerClosedRoomsSQL = `SELECT tenant_id, COUNT(DISTINCT room_id) AS closed FROM facilities.room_closures
WHERE tenant_id = ANY(?0) AND start_date <= ?1 AND end_date >= ?1
GROUP BY tenant_id`

func (s traegerRoomClosures) ClosedRoomsByTenant(ctx context.Context, schools []int64, day calendar.Date) (map[int64]int, error) {
	result := map[int64]int{}
	if len(schools) == 0 {
		return result, nil
	}
	transaction, ok := s.transaction(ctx)
	if !ok {
		return nil, errors.New("facilities: transaction is required")
	}
	if !s.admin(ctx) {
		return nil, errors.New("facilities: the room closures of a Träger need the administrative transaction")
	}
	var db bun.IDB
	switch tx := transaction.(type) {
	case bun.Tx:
		db = tx
	case *bun.Tx:
		if tx != nil {
			db = *tx
		}
	}
	if db == nil {
		return nil, fmt.Errorf("facilities postgres: unsupported transaction %T", transaction)
	}
	var rows []struct {
		TenantID int64 `bun:"tenant_id"`
		Closed   int   `bun:"closed"`
	}
	if err := db.NewRaw(traegerClosedRoomsSQL, pgdialect.Array(schools), day).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("facilities postgres: room closures of a Träger: %w", err)
	}
	for _, row := range rows {
		if row.Closed > 0 {
			result[row.TenantID] = row.Closed
		}
	}
	return result, nil
}
