package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// Opening changes of a school (#7654) in schedule.opening_changes. Every
// statement runs in the school's tenant transaction and names the school
// once more in its own filter, beside the row security of the table. The
// store serves schoolcalendar.OpeningChanges: it checks each change against
// the domain rules before it writes, and an update against the version the
// school read under a row lock (ADR 0311).

// OpeningChangeStore persists the opening changes of a school.
type OpeningChangeStore struct {
	database Database
}

var _ schoolcalendar.OpeningChanges = (*OpeningChangeStore)(nil)

// NewOpeningChangeStore builds the store over the ambient tenant transaction.
func NewOpeningChangeStore(database Database) *OpeningChangeStore {
	if database == nil {
		panic("school calendar postgres: the database is required")
	}
	return &OpeningChangeStore{database: database}
}

type openingChangeRow struct {
	bun.BaseModel `bun:"table:schedule.opening_changes"`

	ID        int64         `bun:"id"`
	StartDate calendar.Date `bun:"start_date"`
	EndDate   calendar.Date `bun:"end_date"`
	OpensAt   string        `bun:"opens_at"`
	ClosesAt  string        `bun:"closes_at"`
	Reason    string        `bun:"reason"`
	UpdatedAt time.Time     `bun:"updated_at"`
	Traeger   bool          `bun:"traeger"`
}

const (
	openingChangeColumns = `id, start_date, end_date, opens_at::text AS opens_at, closes_at::text AS closes_at, reason, updated_at`
	// traegerOpeningChangesOfSchool are the opening changes a Träger planned
	// for school ?0 touching [?2, ?1] (#8202). The filter names the school;
	// the row security of schedule.traeger_opening_changes admits a row only
	// while the school belongs to the row's Träger (ADR 0194), and every
	// school transaction runs under the request role.
	traegerOpeningChangesOfSchool = `FROM schedule.traeger_opening_changes
		WHERE ?0 = ANY (school_ids) AND start_date <= ?1 AND end_date >= ?2`
	// listOpeningChangesQuery lists the school's own changes and those of its
	// Träger; traeger marks the latter, which the school cannot change.
	listOpeningChangesQuery = `SELECT ` + openingChangeColumns + `, false AS traeger FROM schedule.opening_changes
		WHERE tenant_id = ?0 AND start_date <= ?1 AND end_date >= ?2
		UNION ALL
		SELECT ` + openingChangeColumns + `, true ` + traegerOpeningChangesOfSchool + `
		ORDER BY start_date, traeger, id`
	closingTimeOnQuery = `SELECT min(closes_at)::text FROM (
		SELECT closes_at FROM schedule.opening_changes WHERE tenant_id = ?0 AND start_date <= ?1 AND end_date >= ?2
		UNION ALL
		SELECT closes_at ` + traegerOpeningChangesOfSchool + `) AS change`
	insertOpeningChangeQuery = `INSERT INTO schedule.opening_changes (tenant_id, start_date, end_date, opens_at, closes_at, reason)
		VALUES (?, ?, ?, ?::time, ?::time, ?) RETURNING ` + openingChangeColumns
	lockOpeningChangeQuery = `SELECT ` + openingChangeColumns + ` FROM schedule.opening_changes
		WHERE tenant_id = ? AND id = ? FOR UPDATE`
	updateOpeningChangeQuery = `UPDATE schedule.opening_changes
		SET start_date = ?, end_date = ?, opens_at = ?::time, closes_at = ?::time, reason = ?
		WHERE tenant_id = ? AND id = ? RETURNING ` + openingChangeColumns
	deleteOpeningChangeQuery = `DELETE FROM schedule.opening_changes WHERE tenant_id = ? AND id = ?`
	// lockTraegerOpeningChangeIDCollision locks a visible Träger change with
	// the same independent table ID. A school must not use that ID to write an
	// own change; FOR SHARE keeps a concurrent Träger edit or deletion behind
	// the school write until the tenant transaction ends.
	lockTraegerOpeningChangeIDCollision = `SELECT id FROM schedule.traeger_opening_changes
		WHERE id = ? AND ? = ANY (school_ids) FOR SHARE`
)

// ListOpeningChanges lists the changes touching [from, to]: the school's
// own and those its current Träger planned for it (#8202).
func (s *OpeningChangeStore) ListOpeningChanges(ctx context.Context, from, to calendar.Date) ([]schoolcalendar.OpeningChange, error) {
	if problem := domain.OpeningChangeRange(from, to, domain.OpeningChangeWindowMaxDays, "to"); problem != nil {
		return nil, invalidOpeningChange(problem)
	}
	db, schoolID, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	var rows []openingChangeRow
	if err := db.NewRaw(listOpeningChangesQuery, schoolID, to, from).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("school calendar postgres: list opening changes: %w", err)
	}
	result := make([]schoolcalendar.OpeningChange, 0, len(rows))
	for _, row := range rows {
		result = append(result, openingChangeToDomain(row))
	}
	return result, nil
}

// ClosingTimeOn answers the earliest closing time of the changes on day,
// the school's own and its current Träger's (#8202). Overlapping changes
// are allowed; the earliest wins, so no session runs past a closing the
// school or its Träger entered.
func (s *OpeningChangeStore) ClosingTimeOn(ctx context.Context, day calendar.Date) (string, bool, error) {
	if day == "" {
		return "", false, invalidOpeningChange(&domain.OpeningChangeProblem{Field: "date", Reason: "date is required"})
	}
	db, schoolID, err := s.database(ctx)
	if err != nil {
		return "", false, err
	}
	var closesAt sql.NullString
	if err := db.NewRaw(closingTimeOnQuery, schoolID, day, day).Scan(ctx, &closesAt); err != nil {
		return "", false, fmt.Errorf("school calendar postgres: closing time of the day: %w", err)
	}
	if !closesAt.Valid {
		return "", false, nil
	}
	return wallClock(closesAt.String), true, nil
}

// CreateOpeningChange stores a new change.
func (s *OpeningChangeStore) CreateOpeningChange(ctx context.Context, change schoolcalendar.OpeningChangeInput) (schoolcalendar.OpeningChange, error) {
	input, err := normalizeOpeningChange(change)
	if err != nil {
		return schoolcalendar.OpeningChange{}, err
	}
	db, schoolID, err := s.database(ctx)
	if err != nil {
		return schoolcalendar.OpeningChange{}, err
	}
	var row openingChangeRow
	if err := db.NewRaw(insertOpeningChangeQuery, schoolID, input.StartDate, input.EndDate, input.OpensAt, input.ClosesAt, input.Reason).Scan(ctx, &row); err != nil {
		return schoolcalendar.OpeningChange{}, fmt.Errorf("school calendar postgres: create opening change: %w", err)
	}
	return openingChangeToDomain(row), nil
}

// UpdateOpeningChange replaces a change the school read in the version it
// names; the row stays locked until the transaction ends.
func (s *OpeningChangeStore) UpdateOpeningChange(ctx context.Context, id int64, change schoolcalendar.OpeningChangeInput) (schoolcalendar.OpeningChange, error) {
	input, err := normalizeOpeningChange(change)
	if err != nil {
		return schoolcalendar.OpeningChange{}, err
	}
	db, schoolID, err := s.database(ctx)
	if err != nil {
		return schoolcalendar.OpeningChange{}, err
	}
	if err := rejectTraegerOpeningChangeIDCollision(ctx, db, schoolID, id); err != nil {
		return schoolcalendar.OpeningChange{}, err
	}
	var row openingChangeRow
	if err := db.NewRaw(lockOpeningChangeQuery, schoolID, id).Scan(ctx, &row); err != nil {
		return schoolcalendar.OpeningChange{}, openingChangeError("lock", err)
	}
	if err := readstate.Check(change.ExpectedVersion, openingChangeToDomain(row).Version()); err != nil {
		return schoolcalendar.OpeningChange{}, err
	}
	if err := db.NewRaw(updateOpeningChangeQuery, input.StartDate, input.EndDate, input.OpensAt, input.ClosesAt, input.Reason, schoolID, id).Scan(ctx, &row); err != nil {
		return schoolcalendar.OpeningChange{}, openingChangeError("update", err)
	}
	return openingChangeToDomain(row), nil
}

// LockOpeningChange reads a change of the school and holds it until the
// transaction ends: the version a write replaces (#8178).
func (s *OpeningChangeStore) LockOpeningChange(ctx context.Context, id int64) (schoolcalendar.OpeningChange, error) {
	db, schoolID, err := s.database(ctx)
	if err != nil {
		return schoolcalendar.OpeningChange{}, err
	}
	if err := rejectTraegerOpeningChangeIDCollision(ctx, db, schoolID, id); err != nil {
		return schoolcalendar.OpeningChange{}, err
	}
	var row openingChangeRow
	if err := db.NewRaw(lockOpeningChangeQuery, schoolID, id).Scan(ctx, &row); err != nil {
		return schoolcalendar.OpeningChange{}, openingChangeError("lock", err)
	}
	return openingChangeToDomain(row), nil
}

// DeleteOpeningChange removes a change.
func (s *OpeningChangeStore) DeleteOpeningChange(ctx context.Context, id int64) error {
	db, schoolID, err := s.database(ctx)
	if err != nil {
		return err
	}
	if err := rejectTraegerOpeningChangeIDCollision(ctx, db, schoolID, id); err != nil {
		return err
	}
	result, err := db.NewRaw(deleteOpeningChangeQuery, schoolID, id).Exec(ctx)
	if err != nil {
		return fmt.Errorf("school calendar postgres: delete opening change: %w", err)
	}
	if affected, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("school calendar postgres: delete opening change: %w", err)
	} else if affected == 0 {
		return schoolcalendar.ErrOpeningChangeNotFound
	}
	return nil
}

// rejectTraegerOpeningChangeIDCollision preserves the school route's 404 for
// a Träger-owned change when its independent ID happens to match a school row.
func rejectTraegerOpeningChangeIDCollision(ctx context.Context, db bun.IDB, schoolID, id int64) error {
	var traegerID int64
	err := db.NewRaw(lockTraegerOpeningChangeIDCollision, id, schoolID).Scan(ctx, &traegerID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("school calendar postgres: lock Träger opening change ID collision: %w", err)
	}
	return schoolcalendar.ErrOpeningChangeNotFound
}

// normalizeOpeningChange checks a change against the domain rules.
func normalizeOpeningChange(change schoolcalendar.OpeningChangeInput) (schoolcalendar.OpeningChangeInput, error) {
	fields, problem := domain.NormalizeOpeningChange(domain.OpeningChangeFields{
		StartDate: change.StartDate, EndDate: change.EndDate, OpensAt: change.OpensAt, ClosesAt: change.ClosesAt, Reason: change.Reason,
	}, schoolcalendar.OpeningChangeReasonMaxLength)
	if problem != nil {
		return change, invalidOpeningChange(problem)
	}
	change.StartDate, change.EndDate, change.OpensAt, change.ClosesAt, change.Reason = fields.StartDate, fields.EndDate, fields.OpensAt, fields.ClosesAt, fields.Reason
	return change, nil
}

func invalidOpeningChange(problem *domain.OpeningChangeProblem) error {
	return &schoolcalendar.InvalidOpeningChangeError{Field: problem.Field, Reason: problem.Reason}
}

func openingChangeError(operation string, err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return schoolcalendar.ErrOpeningChangeNotFound
	}
	return fmt.Errorf("school calendar postgres: %s opening change: %w", operation, err)
}

// openingChangeToDomain writes the TIME columns as "HH:MM".
func openingChangeToDomain(row openingChangeRow) schoolcalendar.OpeningChange {
	return schoolcalendar.OpeningChange{
		ID: row.ID, StartDate: row.StartDate, EndDate: row.EndDate,
		OpensAt: wallClock(row.OpensAt), ClosesAt: wallClock(row.ClosesAt),
		Reason: row.Reason, UpdatedAt: row.UpdatedAt, Traeger: row.Traeger,
	}
}

func wallClock(value string) string {
	if len(value) >= 5 && strings.Count(value, ":") >= 1 {
		return value[:5]
	}
	return value
}
