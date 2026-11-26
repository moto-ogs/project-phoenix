package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/modules/facilities/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/uptrace/bun"
)

type roomClosureRow struct {
	bun.BaseModel `bun:"table:facilities.room_closures,alias:closure"`
	ID            int64         `bun:"id,pk,autoincrement"`
	TenantID      int64         `bun:"tenant_id,notnull"`
	RoomID        int64         `bun:"room_id,notnull"`
	StartDate     calendar.Date `bun:"start_date,notnull,type:date"`
	EndDate       calendar.Date `bun:"end_date,notnull,type:date"`
	Reason        string        `bun:"reason,notnull"`
	CreatedAt     time.Time     `bun:"created_at,nullzero,notnull,default:current_timestamp"`
}

func (row roomClosureRow) closure() facilities.RoomClosure {
	return facilities.RoomClosure{
		ID: row.ID, RoomID: row.RoomID, StartDate: row.StartDate, EndDate: row.EndDate,
		Reason: row.Reason, CreatedAt: row.CreatedAt,
	}
}

// InsertClosure stores a closure of a room of the caller's school.
func (s *Store) InsertClosure(ctx context.Context, input facilities.CloseRoom) (facilities.RoomClosure, domain.OperationStats, error) {
	db, tenantID, err := s.database(ctx)
	if err != nil {
		return facilities.RoomClosure{}, domain.OperationStats{}, err
	}
	if tenantID <= 0 {
		return facilities.RoomClosure{}, domain.OperationStats{}, errors.New("facilities postgres: tenant is required")
	}
	row := roomClosureRow{TenantID: tenantID, RoomID: input.RoomID, StartDate: input.StartDate, EndDate: input.EndDate, Reason: input.Reason}
	stats := domain.OperationStats{Queries: 1}
	if err := db.NewInsert().Model(&row).ModelTableExpr(`facilities.room_closures AS "closure"`).Returning("*").Scan(ctx); err != nil {
		return facilities.RoomClosure{}, stats, fmt.Errorf("facilities postgres: insert room closure: %w", err)
	}
	stats.Rows = 1
	return row.closure(), stats, nil
}

// DeleteClosure deletes the closure of the room; found is false when the
// school has no such closure for the room.
func (s *Store) DeleteClosure(ctx context.Context, roomID, closureID int64) (bool, domain.OperationStats, error) {
	db, tenantID, err := s.database(ctx)
	if err != nil {
		return false, domain.OperationStats{}, err
	}
	stats := domain.OperationStats{Queries: 1}
	result, err := db.NewDelete().Model((*roomClosureRow)(nil)).
		ModelTableExpr(`facilities.room_closures AS "closure"`).
		Where(`"closure".id = ?`, closureID).
		Where(`"closure".room_id = ?`, roomID).
		Where(`"closure".tenant_id = ?`, tenantID).
		Exec(ctx)
	if err != nil {
		return false, stats, fmt.Errorf("facilities postgres: delete room closure: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, stats, fmt.Errorf("facilities postgres: delete room closure: %w", err)
	}
	stats.Rows = affected
	return affected > 0, stats, nil
}

// ListClosures reads the closures of the caller's school that overlap the
// filter's days, in one statement, ordered by room and start.
func (s *Store) ListClosures(ctx context.Context, filter facilities.RoomClosureFilter) ([]facilities.RoomClosure, domain.OperationStats, error) {
	db, tenantID, err := s.database(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	return s.listClosures(ctx, db, tenantID, filter, "")
}

// ListClosuresWithRoomLocks locks every selected room FOR UPDATE while
// reading its closures. It is deliberately one statement: materialization
// needs a batch verdict without spending one query to lock and another to
// inspect. CloseRoom's KEY SHARE conflicts with this lock, so neither write
// can pass the other with a stale closure verdict.
func (s *Store) ListClosuresWithRoomLocks(ctx context.Context, filter facilities.RoomClosureFilter) ([]facilities.RoomClosure, domain.OperationStats, error) {
	db, tenantID, err := s.database(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	if len(filter.RoomIDs) == 0 {
		return []facilities.RoomClosure{}, domain.OperationStats{}, nil
	}
	// The locked rooms must be the left side of the join. A closure-first
	// query skips its locking subquery when a room has no closure yet, leaving
	// a concurrent CloseRoom able to pass an appointment or session start.
	// This shape visits and locks every requested room before it examines its
	// optional closure rows.
	type lockedClosureRow struct {
		ID        *int64         `bun:"id"`
		RoomID    *int64         `bun:"room_id"`
		StartDate *calendar.Date `bun:"start_date"`
		EndDate   *calendar.Date `bun:"end_date"`
		Reason    *string        `bun:"reason"`
		CreatedAt *time.Time     `bun:"created_at"`
	}
	rows := []lockedClosureRow{}
	stats := domain.OperationStats{Queries: 1}
	if err := db.NewRaw(`
		SELECT "closure".id, "closure".room_id, "closure".start_date, "closure".end_date, "closure".reason, "closure".created_at
		FROM (
			SELECT "room".id
			FROM facilities.rooms AS "room"
			WHERE "room".tenant_id = ? AND "room".id IN (?)
			FOR UPDATE
		) AS "locked_room"
		LEFT JOIN facilities.room_closures AS "closure"
			ON "closure".tenant_id = ?
			AND "closure".room_id = "locked_room".id
			AND "closure".end_date >= ?
			AND "closure".start_date <= ?
		ORDER BY "locked_room".id ASC, "closure".start_date ASC NULLS LAST, "closure".id ASC NULLS LAST`,
		tenantID, bun.List(filter.RoomIDs), tenantID, filter.From, filter.Until).Scan(ctx, &rows); err != nil {
		return nil, stats, fmt.Errorf("facilities postgres: list locked room closures: %w", err)
	}
	result := make([]facilities.RoomClosure, 0, len(rows))
	for _, row := range rows {
		if row.ID == nil {
			continue
		}
		result = append(result, facilities.RoomClosure{
			ID: *row.ID, RoomID: *row.RoomID, StartDate: *row.StartDate, EndDate: *row.EndDate,
			Reason: *row.Reason, CreatedAt: *row.CreatedAt,
		})
	}
	stats.Rows = int64(len(result))
	return result, stats, nil
}

func (s *Store) listClosures(ctx context.Context, db bun.IDB, tenantID int64, filter facilities.RoomClosureFilter, extra string, args ...any) ([]facilities.RoomClosure, domain.OperationStats, error) {
	rows := []roomClosureRow{}
	stats := domain.OperationStats{Queries: 1}
	query := db.NewSelect().Model(&rows).
		ModelTableExpr(`facilities.room_closures AS "closure"`).
		Where(`"closure".tenant_id = ?`, tenantID).
		Where(`"closure".end_date >= ?`, filter.From).
		Where(`"closure".start_date <= ?`, filter.Until).
		OrderExpr(`"closure".room_id ASC, "closure".start_date ASC, "closure".id ASC`)
	if filter.RoomID != nil {
		query = query.Where(`"closure".room_id = ?`, *filter.RoomID)
	}
	if len(filter.RoomIDs) > 0 {
		query = query.Where(`"closure".room_id IN (?)`, bun.List(filter.RoomIDs))
	}
	if extra != "" {
		query = query.Where(extra, args...)
	}
	if err := query.Scan(ctx); err != nil {
		return nil, stats, fmt.Errorf("facilities postgres: list room closures: %w", err)
	}
	result := make([]facilities.RoomClosure, 0, len(rows))
	for _, row := range rows {
		result = append(result, row.closure())
	}
	stats.Rows = int64(len(result))
	return result, stats, nil
}
