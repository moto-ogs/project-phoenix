package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/ports"
	"github.com/uptrace/bun"
)

var _ ports.RoomHistoryStopStore = (*Store)(nil)

func (s *Store) ListRoomHistoryStops(ctx context.Context, studentIDs []int64) (map[int64]time.Time, ports.Stats, error) {
	result := map[int64]time.Time{}
	if len(studentIDs) == 0 {
		return result, ports.Stats{}, nil
	}
	db, tenantID, err := s.database(ctx)
	if err != nil {
		return nil, ports.Stats{}, err
	}
	var rows []struct {
		StudentID int64     `bun:"student_id"`
		StoppedAt time.Time `bun:"stopped_at"`
	}
	started := time.Now()
	err = db.NewRaw(`SELECT student_id, stopped_at FROM active.room_history_stops WHERE tenant_id = ? AND student_id IN (?)`,
		tenantID, bun.List(studentIDs)).Scan(ctx, &rows)
	stats := ports.Stats{Queries: 1, Rows: int64(len(rows)), StatementDuration: time.Since(started)}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, stats, fmt.Errorf("list room history stops: %w", err)
	}
	for _, row := range rows {
		result[row.StudentID] = row.StoppedAt
	}
	return result, stats, nil
}

// insertRoomHistoryStopSQL inserts the stop or, when the child is already
// stopped, returns the existing start without changing it.
const insertRoomHistoryStopSQL = `WITH inserted AS (
	INSERT INTO active.room_history_stops (tenant_id, student_id, stopped_at) VALUES (?, ?, ?)
	ON CONFLICT (tenant_id, student_id) DO NOTHING
	RETURNING stopped_at
)
SELECT TRUE AS inserted, stopped_at FROM inserted
UNION ALL
SELECT FALSE, stopped_at FROM active.room_history_stops
WHERE tenant_id = ? AND student_id = ? AND NOT EXISTS (SELECT 1 FROM inserted)`

func (s *Store) InsertRoomHistoryStop(ctx context.Context, studentID int64, at time.Time) (bool, time.Time, ports.Stats, error) {
	db, tenantID, err := s.database(ctx)
	if err != nil {
		return false, time.Time{}, ports.Stats{}, err
	}
	var row struct {
		Inserted  bool      `bun:"inserted"`
		StoppedAt time.Time `bun:"stopped_at"`
	}
	started := time.Now()
	err = db.NewRaw(insertRoomHistoryStopSQL, tenantID, studentID, at, tenantID, studentID).Scan(ctx, &row)
	stats := ports.Stats{Queries: 1, Rows: 1, StatementDuration: time.Since(started)}
	if err != nil {
		return false, time.Time{}, stats, fmt.Errorf("insert room history stop: %w", err)
	}
	return row.Inserted, row.StoppedAt, stats, nil
}

func (s *Store) DeleteRoomHistoryStop(ctx context.Context, studentID int64) (bool, ports.Stats, error) {
	db, tenantID, err := s.database(ctx)
	if err != nil {
		return false, ports.Stats{}, err
	}
	started := time.Now()
	result, err := db.NewRaw(`DELETE FROM active.room_history_stops WHERE tenant_id = ? AND student_id = ?`, tenantID, studentID).Exec(ctx)
	stats := ports.Stats{Queries: 1, StatementDuration: time.Since(started)}
	if err != nil {
		return false, stats, fmt.Errorf("delete room history stop: %w", err)
	}
	stats.Rows, err = result.RowsAffected()
	if err != nil {
		return false, stats, fmt.Errorf("delete room history stop: %w", err)
	}
	return stats.Rows > 0, stats, nil
}

// DeleteCompletedVisits takes the visit row locks in ID order, the order
// every visit write takes them, before the delete reads a fresh snapshot.
func (s *Store) DeleteCompletedVisits(ctx context.Context, studentID int64) (int64, ports.Stats, error) {
	db, tenantID, err := s.database(ctx)
	if err != nil {
		return 0, ports.Stats{}, err
	}
	started := time.Now()
	var locked []int64
	err = db.NewRaw(`SELECT id FROM active.visits WHERE tenant_id = ? AND student_id = ? ORDER BY id FOR UPDATE`, tenantID, studentID).Scan(ctx, &locked)
	stats := ports.Stats{Queries: 1}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		stats.StatementDuration = time.Since(started)
		return 0, stats, fmt.Errorf("lock visits of a stopped child: %w", err)
	}
	result, err := db.NewRaw(`DELETE FROM active.visits WHERE tenant_id = ? AND student_id = ? AND exit_time IS NOT NULL`, tenantID, studentID).Exec(ctx)
	stats.Queries++
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return 0, stats, fmt.Errorf("delete completed visits of a stopped child: %w", err)
	}
	stats.Rows, err = result.RowsAffected()
	if err != nil {
		return 0, stats, fmt.Errorf("delete completed visits of a stopped child: %w", err)
	}
	return stats.Rows, stats, nil
}
