package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

const staffDocumentRetentionClock = `clock_timestamp()`

// DatabaseTime reads the clock that guards the cutoffs of the staff
// document retentions: users.delete_expired_staff_sick_notes (1.15.453) and
// users.delete_finished_staff_document_file_cleanups (1.15.449) refuse a
// cutoff outside their window on clock_timestamp(), and the column default
// stamps created_at of a staff document on the same clock (ADR 0281 point 3).
func (s *Store) DatabaseTime(ctx context.Context) (time.Time, error) {
	db, _, err := s.database(ctx)
	if err != nil {
		return time.Time{}, err
	}
	var now time.Time
	if err := db.NewRaw(`SELECT `+staffDocumentRetentionClock).Scan(ctx, &now); err != nil {
		return time.Time{}, fmt.Errorf("workforce postgres: read the database time: %w", err)
	}
	return now, nil
}

// DeleteFinishedStaffDocumentFileCleanups goes through the database function
// of 1.15.449: the direct DELETE on the intents stays revoked from the
// tenant role, and the function deletes only finished intents of the
// transaction's school.
func (s *Store) DeleteFinishedStaffDocumentFileCleanups(ctx context.Context, window time.Duration) (int, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return 0, err
	}
	now, err := s.DatabaseTime(ctx)
	if err != nil {
		return 0, err
	}
	var deleted int64
	cutoff := domain.FinishedFileCleanupCutoff(now, window)
	if err := db.NewRaw(`SELECT users.delete_finished_staff_document_file_cleanups(?, ?)`, scope.TenantID, cutoff).Scan(ctx, &deleted); err != nil {
		return 0, fmt.Errorf("workforce postgres: delete finished staff document file cleanups: %w", err)
	}
	return int(deleted), nil
}

// DeleteCompletedOffboardingCleanups deletes the jobs completed before the
// window, counted in Berlin calendar days on the store's clock, which stamps
// completed_at (#7295, ADR 0281).
func (s *Store) DeleteCompletedOffboardingCleanups(ctx context.Context, window time.Duration) (int, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return 0, err
	}
	result, err := db.NewRaw(`DELETE FROM users.staff_offboarding_cleanup
		WHERE tenant_id = ? AND completed_at IS NOT NULL AND completed_at < ?`, scope.TenantID,
		s.stamp().In(calendar.Berlin).AddDate(0, 0, -int(window.Hours()/24))).Exec(ctx)
	if err != nil {
		return 0, fmt.Errorf("workforce postgres: delete completed offboarding cleanups: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("workforce postgres: delete completed offboarding cleanups: %w", err)
	}
	return int(rows), nil
}

// DeleteStaffSickNotesUploadedBefore goes through the database function of
// 1.15.453: the tenant role has no DELETE on staff documents, and the
// function deletes only sick notes of the transaction's school and queues
// their files in the staff document file cleanup.
func (s *Store) DeleteStaffSickNotesUploadedBefore(ctx context.Context, before time.Time) (int, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return 0, err
	}
	var deleted int64
	if err := db.NewRaw(`SELECT users.delete_expired_staff_sick_notes(?, ?)`, scope.TenantID, before).Scan(ctx, &deleted); err != nil {
		return 0, fmt.Errorf("workforce postgres: delete expired staff sick notes: %w", err)
	}
	return int(deleted), nil
}
