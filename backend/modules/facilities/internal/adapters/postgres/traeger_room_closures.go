package postgres

import (
	"context"
	"fmt"

	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var _ facilities.TraegerRoomClosures = traegerRooms{}

// traegerClosedRoomsSQL counts the rooms of the given schools a closure
// closes on the day. The filter on the school set is the boundary: the
// administrative transaction has no row security.
const traegerClosedRoomsSQL = `SELECT tenant_id, COUNT(DISTINCT room_id) AS closed FROM facilities.room_closures
WHERE tenant_id = ANY(?0) AND start_date <= ?1 AND end_date >= ?1
GROUP BY tenant_id`

// ClosedRoomsByTenant counts the closed rooms of the schools on the day
// (#8146) on the caller's administrative transaction.
func (s traegerRooms) ClosedRoomsByTenant(ctx context.Context, schools []int64, day calendar.Date) (map[int64]int, error) {
	result := map[int64]int{}
	if len(schools) == 0 {
		return result, nil
	}
	db, err := s.adminDB(ctx)
	if err != nil {
		return nil, err
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
