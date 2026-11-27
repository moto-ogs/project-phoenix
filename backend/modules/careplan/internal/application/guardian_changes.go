package application

import (
	"context"
	"errors"
	"slices"

	"github.com/moto-ogs/project-phoenix/tenant"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/ports"
	calendar "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// GuardianAbsences writes a guardian's full-day status in the caller's
// tenant transaction.
type GuardianAbsences struct {
	Records ports.GuardianAbsenceRecords
}

func (s *GuardianAbsences) ReportGuardianAbsence(ctx context.Context, report careplan.GuardianAbsenceReport) ([]careplan.StudentStatusDay, error) {
	var result []careplan.StudentStatusDay
	err := tenant.NewTransactionRunner().RunInTx(ctx, func(txCtx context.Context) error {
		var err error
		result, err = s.reportGuardianAbsence(txCtx, report)
		return err
	})
	return result, err
}

func (s *GuardianAbsences) reportGuardianAbsence(ctx context.Context, report careplan.GuardianAbsenceReport) ([]careplan.StudentStatusDay, error) {
	if len(report.Dates) == 0 {
		return nil, errors.New("guardian absence: at least one date is required")
	}
	sorted := slices.Clone(report.Dates)
	slices.SortFunc(sorted, compareDates)
	first, last := sorted[0], sorted[len(sorted)-1]
	if err := s.refuseManualPartialAbsence(ctx, report.StudentID, sorted); err != nil {
		return nil, err
	}
	if err := s.refuseSchoolStatus(ctx, report.StudentID, sorted); err != nil {
		return nil, err
	}
	if err := s.write(ctx, report); err != nil {
		return nil, err
	}
	rows, err := s.Records.ListStudentStatusDays(ctx, careplan.StudentStatusDayFilter{
		StudentIDs: []int64{report.StudentID}, From: first, To: last, ActiveOnly: true,
	})
	if err != nil {
		return nil, err
	}
	// The range spans min..max, so a non-contiguous report (Mon + Wed) can
	// also return an unrelated row in between, which must not be surfaced.
	return slices.DeleteFunc(rows, func(row careplan.StudentStatusDay) bool {
		return row.Status != report.Status || !slices.Contains(report.Dates, row.Date)
	}), nil
}

// refuseManualPartialAbsence serializes with staff writes on every requested
// day, in ascending date order, before anything is cleared. Automatic
// excusals (pulled-forward pickup times) coexist with a full-day status.
func (s *GuardianAbsences) refuseManualPartialAbsence(ctx context.Context, studentID int64, sorted []careplan.Date) error {
	for _, date := range sorted {
		if err := s.Records.LockStudentAndExceptionDay(ctx, studentID, date.String()); err != nil {
			return err
		}
	}
	rows, err := s.Records.ListPickupExceptions(ctx, careplan.StudentScheduleFilter{
		StudentIDs: []int64{studentID}, From: sorted[0], To: sorted[len(sorted)-1],
	})
	if err != nil {
		return err
	}
	for _, row := range rows {
		if row.HasManualPartialAbsence() && slices.Contains(sorted, row.ExceptionDate) {
			return careplan.ErrManualPartialAbsenceConflict
		}
	}
	return nil
}

// refuseSchoolStatus keeps a school-set full-day status (any source but the
// family's) on its day; the caller already holds the care-day locks.
func (s *GuardianAbsences) refuseSchoolStatus(ctx context.Context, studentID int64, sorted []careplan.Date) error {
	rows, err := s.Records.ListStudentStatusDays(ctx, careplan.StudentStatusDayFilter{
		StudentIDs: []int64{studentID}, From: sorted[0], To: sorted[len(sorted)-1], ActiveOnly: true,
	})
	if err != nil {
		return err
	}
	for _, row := range rows {
		if row.Source != careplan.StudentStatusSourceParent && slices.Contains(sorted, row.Date) {
			return careplan.ErrSchoolStatusDayConflict
		}
	}
	return nil
}

// write records the report day by day; each write replaces the status
// standing for its day (#6958).
func (s *GuardianAbsences) write(ctx context.Context, report careplan.GuardianAbsenceReport) error {
	guardianAccountID := report.GuardianAccountID
	for _, date := range report.Dates {
		if _, err := s.Records.UpsertStudentStatusDay(ctx, careplan.StudentStatusDay{
			StudentID: report.StudentID, Date: date, Status: report.Status, ReportedAt: report.ReportedAt,
			Source: careplan.StudentStatusSourceParent, GuardianAccountID: &guardianAccountID, Note: report.Note,
			ReportedByAccountID: &guardianAccountID,
		}); err != nil {
			return err
		}
	}
	return nil
}

func compareDates(a, b careplan.Date) int {
	return calendar.Date(a).Compare(calendar.Date(b))
}

// GuardianPickupExceptions withdraws a guardian's pickup exception. A nil
// Excusal skips releasing derived block excusals.
type GuardianPickupExceptions struct {
	Records ports.GuardianPickupRecords
	Excusal ports.GuardianPickupExcusal
}

// WithdrawGuardianPickupException releases the derived excusal BEFORE the
// row goes away: the foreign key's ON DELETE SET NULL would otherwise strand
// the excused blocks as absent with no provenance to restore from.
func (s *GuardianPickupExceptions) WithdrawGuardianPickupException(ctx context.Context, row careplan.PickupException) error {
	if s.Excusal != nil {
		if err := s.Excusal.ReleaseBeforeDelete(ctx, &careplan.PickupException{ID: row.ID, ExcusedAuto: row.ExcusedAuto}); err != nil {
			return err
		}
	}
	return s.Records.DeletePickupException(ctx, row.ID)
}
