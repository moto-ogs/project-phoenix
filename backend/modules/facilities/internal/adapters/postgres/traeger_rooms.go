package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/facilities"
)

// NewTraegerRooms reads on the caller's administrative transaction.
func NewTraegerRooms(transaction func(context.Context) (any, bool), admin func(context.Context) bool) facilities.TraegerRooms {
	return traegerRooms{transaction: transaction, admin: admin}
}

type traegerRooms struct {
	transaction func(context.Context) (any, bool)
	admin       func(context.Context) bool
}

const traegerRoomsSQL = `SELECT tenant_id, id, name, capacity FROM facilities.rooms
WHERE tenant_id = ANY(?0)
ORDER BY tenant_id, name, id`

func (s traegerRooms) RoomsByTenant(ctx context.Context, schools []int64) (map[int64][]facilities.TraegerRoom, error) {
	result := make(map[int64][]facilities.TraegerRoom, len(schools))
	if len(schools) == 0 {
		return result, nil
	}
	db, err := s.adminDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		TenantID int64  `bun:"tenant_id"`
		ID       int64  `bun:"id"`
		Name     string `bun:"name"`
		Capacity *int   `bun:"capacity"`
	}
	if err := db.NewRaw(traegerRoomsSQL, pgdialect.Array(schools)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("facilities postgres: rooms of a Träger: %w", err)
	}
	for _, row := range rows {
		result[row.TenantID] = append(result[row.TenantID], facilities.TraegerRoom{ID: row.ID, Name: row.Name, Capacity: row.Capacity})
	}
	return result, nil
}

// adminDB returns the caller's administrative transaction; the Träger reads
// run in no other.
func (s traegerRooms) adminDB(ctx context.Context) (bun.IDB, error) {
	transaction, ok := s.transaction(ctx)
	if !ok {
		return nil, errors.New("facilities: transaction is required")
	}
	if !s.admin(ctx) {
		return nil, errors.New("facilities: the reads of a Träger need the administrative transaction")
	}
	switch tx := transaction.(type) {
	case bun.Tx:
		return tx, nil
	case *bun.Tx:
		if tx != nil {
			return *tx, nil
		}
	}
	return nil, fmt.Errorf("facilities postgres: unsupported transaction %T", transaction)
}
