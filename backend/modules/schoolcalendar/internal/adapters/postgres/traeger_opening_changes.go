package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Opening changes of a Träger (#8202) in schedule.traeger_opening_changes.
// Like the Träger's closing days, the table carries organization_id and the
// Träger policy of ADR 0105: every statement runs in the Träger transaction
// of the Träger it names and names that Träger once more in its own filter.
// A school reads the rows naming it through OpeningChangeStore.

// traegerOpeningChangeSchoolConstraint is the name the school trigger of
// schedule.traeger_opening_changes raises for a school outside the Träger.
const traegerOpeningChangeSchoolConstraint = "chk_traeger_opening_changes_school_member"

// TraegerOpeningChangeStore persists the opening changes of a Träger.
type TraegerOpeningChangeStore struct{}

// NewTraegerOpeningChangeStore builds the store.
func NewTraegerOpeningChangeStore() *TraegerOpeningChangeStore { return &TraegerOpeningChangeStore{} }

type traegerOpeningChangeRow struct {
	bun.BaseModel `bun:"table:schedule.traeger_opening_changes"`

	ID        int64         `bun:"id"`
	StartDate calendar.Date `bun:"start_date"`
	EndDate   calendar.Date `bun:"end_date"`
	OpensAt   string        `bun:"opens_at"`
	ClosesAt  string        `bun:"closes_at"`
	Reason    string        `bun:"reason"`
	SchoolIDs []int64       `bun:"school_ids,array"`
	UpdatedAt time.Time     `bun:"updated_at"`
}

const (
	traegerOpeningChangeColumns = `id, start_date, end_date, opens_at::text AS opens_at, closes_at::text AS closes_at, reason, school_ids, updated_at`
	listTraegerOpeningChanges   = `SELECT ` + traegerOpeningChangeColumns + ` FROM schedule.traeger_opening_changes
		WHERE organization_id = ? AND start_date <= ? AND end_date >= ? ORDER BY start_date, id`
	insertTraegerOpeningChange = `INSERT INTO schedule.traeger_opening_changes (organization_id, start_date, end_date, opens_at, closes_at, reason, school_ids)
		VALUES (?, ?, ?, ?::time, ?::time, ?, ?) RETURNING ` + traegerOpeningChangeColumns
	lockTraegerOpeningChange = `SELECT ` + traegerOpeningChangeColumns + ` FROM schedule.traeger_opening_changes
		WHERE organization_id = ? AND id = ? FOR UPDATE`
	updateTraegerOpeningChange = `UPDATE schedule.traeger_opening_changes
		SET start_date = ?, end_date = ?, opens_at = ?::time, closes_at = ?::time, reason = ?, school_ids = ?
		WHERE organization_id = ? AND id = ? RETURNING ` + traegerOpeningChangeColumns
	deleteTraegerOpeningChange = `DELETE FROM schedule.traeger_opening_changes WHERE organization_id = ? AND id = ?`
)

// ListTraegerOpeningChanges lists the Träger's changes touching [from, to].
func (s *TraegerOpeningChangeStore) ListTraegerOpeningChanges(ctx context.Context, organizationID int64, from, to calendar.Date) ([]domain.TraegerOpeningChange, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []traegerOpeningChangeRow
	if err := db.NewRaw(listTraegerOpeningChanges, organizationID, to, from).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("school calendar postgres: list Träger opening changes: %w", err)
	}
	result := make([]domain.TraegerOpeningChange, 0, len(rows))
	for _, row := range rows {
		result = append(result, traegerOpeningChangeToDomain(row))
	}
	return result, nil
}

// InsertTraegerOpeningChange adds an opening change of the Träger.
func (s *TraegerOpeningChangeStore) InsertTraegerOpeningChange(ctx context.Context, organizationID int64, fields domain.TraegerOpeningChangeFields) (domain.TraegerOpeningChange, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return domain.TraegerOpeningChange{}, err
	}
	var row traegerOpeningChangeRow
	err = db.NewRaw(insertTraegerOpeningChange, organizationID, fields.StartDate, fields.EndDate, fields.OpensAt, fields.ClosesAt,
		fields.Reason, pgdialect.Array(fields.SchoolIDs)).Scan(ctx, &row)
	if err != nil {
		return domain.TraegerOpeningChange{}, traegerOpeningChangeWriteError("insert", err)
	}
	return traegerOpeningChangeToDomain(row), nil
}

// LockTraegerOpeningChange reads an opening change of the Träger and holds
// it until the Träger transaction ends.
func (s *TraegerOpeningChangeStore) LockTraegerOpeningChange(ctx context.Context, organizationID, id int64) (domain.TraegerOpeningChange, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return domain.TraegerOpeningChange{}, err
	}
	var row traegerOpeningChangeRow
	if err := db.NewRaw(lockTraegerOpeningChange, organizationID, id).Scan(ctx, &row); err != nil {
		return domain.TraegerOpeningChange{}, traegerOpeningChangeWriteError("lock", err)
	}
	return traegerOpeningChangeToDomain(row), nil
}

// UpdateTraegerOpeningChange replaces an opening change of the Träger.
func (s *TraegerOpeningChangeStore) UpdateTraegerOpeningChange(ctx context.Context, organizationID, id int64, fields domain.TraegerOpeningChangeFields) (domain.TraegerOpeningChange, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return domain.TraegerOpeningChange{}, err
	}
	var row traegerOpeningChangeRow
	err = db.NewRaw(updateTraegerOpeningChange, fields.StartDate, fields.EndDate, fields.OpensAt, fields.ClosesAt, fields.Reason,
		pgdialect.Array(fields.SchoolIDs), organizationID, id).Scan(ctx, &row)
	if err != nil {
		return domain.TraegerOpeningChange{}, traegerOpeningChangeWriteError("update", err)
	}
	return traegerOpeningChangeToDomain(row), nil
}

// DeleteTraegerOpeningChange removes an opening change of the Träger.
func (s *TraegerOpeningChangeStore) DeleteTraegerOpeningChange(ctx context.Context, organizationID, id int64) error {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return err
	}
	result, err := db.NewRaw(deleteTraegerOpeningChange, organizationID, id).Exec(ctx)
	if err != nil {
		return fmt.Errorf("school calendar postgres: delete Träger opening change: %w", err)
	}
	if rows, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("school calendar postgres: delete Träger opening change: count rows: %w", err)
	} else if rows != 1 {
		return domain.ErrTraegerOpeningChangeNotFound
	}
	return nil
}

func traegerOpeningChangeWriteError(operation string, err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrTraegerOpeningChangeNotFound
	}
	var postgresError pgdriver.Error
	if errors.As(err, &postgresError) && postgresError.IntegrityViolation() && postgresError.Field('n') == traegerOpeningChangeSchoolConstraint {
		return domain.ErrTraegerOpeningChangeSchoolOutside
	}
	return fmt.Errorf("school calendar postgres: %s Träger opening change: %w", operation, err)
}

func traegerOpeningChangeToDomain(row traegerOpeningChangeRow) domain.TraegerOpeningChange {
	schoolIDs := row.SchoolIDs
	if schoolIDs == nil {
		schoolIDs = []int64{}
	}
	return domain.TraegerOpeningChange{
		ID: row.ID, StartDate: row.StartDate, EndDate: row.EndDate, OpensAt: wallClock(row.OpensAt), ClosesAt: wallClock(row.ClosesAt),
		Reason: row.Reason, SchoolIDs: schoolIDs, UpdatedAt: row.UpdatedAt,
	}
}
