package compose

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	guardianMonday    careplan.Date = "2032-05-10"
	guardianTuesday   careplan.Date = "2032-05-11"
	guardianWednesday careplan.Date = "2032-05-12"
)

type guardianFixture struct {
	ctx       context.Context
	module    careplan.Owner
	studentID int64
	staffID   int64
	accountID int64
}

func newGuardianFixture(t *testing.T) guardianFixture {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	return guardianFixture{
		ctx:       testpkg.Ctx(t),
		module:    buildModule(t, db),
		studentID: testpkg.CreateTestStudent(t, db, "Guardian", "Change", "1a").ID,
		staffID:   testpkg.CreateTestStaff(t, db, "Guardian", "Staff").ID,
		accountID: testpkg.CreateTestAccount(t, db, "guardian-change").ID,
	}
}

func wallClock(hour, minute int) *time.Time {
	clock := time.Date(0, 1, 1, hour, minute, 0, 0, time.UTC)
	return &clock
}

func (f guardianFixture) pickupRows(t *testing.T, date careplan.Date) []careplan.PickupException {
	t.Helper()
	rows, err := f.module.ListPickupExceptions(f.ctx, careplan.StudentScheduleFilter{StudentIDs: []int64{f.studentID}, Date: date})
	require.NoError(t, err)
	return rows
}

func (f guardianFixture) activeStatusDays(t *testing.T) []careplan.StudentStatusDay {
	t.Helper()
	rows, err := f.module.ListStudentStatusDays(f.ctx, careplan.StudentStatusDayFilter{
		StudentIDs: []int64{f.studentID}, From: guardianMonday, To: guardianWednesday, ActiveOnly: true,
	})
	require.NoError(t, err)
	return rows
}

func (f guardianFixture) seedStatus(t *testing.T, date careplan.Date, status string) {
	t.Helper()
	f.seedStatusFrom(t, date, status, careplan.StudentStatusSourceManual)
}

// seedStatusFrom seeds a status day of the given source; a family's own
// earlier report is source parent, everything else the school set.
func (f guardianFixture) seedStatusFrom(t *testing.T, date careplan.Date, status, source string) {
	t.Helper()
	var guardian *int64
	if source == careplan.StudentStatusSourceParent {
		guardian = &f.accountID
	}
	_, err := f.module.UpsertStudentStatusDay(f.ctx, careplan.StudentStatusDay{
		StudentID: f.studentID, Date: date, Status: status, ReportedAt: time.Now(), Source: source, GuardianAccountID: guardian,
	})
	require.NoError(t, err)
}

func (f guardianFixture) report(status string, dates ...careplan.Date) careplan.GuardianAbsenceReport {
	note := "Fieber"
	return careplan.GuardianAbsenceReport{
		StudentID: f.studentID, GuardianAccountID: f.accountID, Dates: dates, Status: status,
		Note: &note, ReportedAt: time.Now().UTC().Truncate(time.Second),
	}
}

func TestGuardianAbsenceReportReplacesOtherStatusesAndReturnsOnlySubmittedDays(t *testing.T) {
	t.Parallel()
	f := newGuardianFixture(t)
	absences, err := NewGuardianAbsences(f.module)
	require.NoError(t, err)
	// The family replaces its own earlier report; a school status is never
	// replaced by a family (#5698, see TestGuardianAbsenceReportRefusesSchoolStatus).
	f.seedStatusFrom(t, guardianMonday, careplan.StudentStatusDayExcused, careplan.StudentStatusSourceParent)
	f.seedStatus(t, guardianTuesday, careplan.StudentStatusDayExcused)

	report := f.report(careplan.StudentStatusDaySick, guardianWednesday, guardianMonday)
	rows, err := absences.ReportGuardianAbsence(f.ctx, report)
	require.NoError(t, err)

	require.Len(t, rows, 2, "Tuesday lies inside the range but was not submitted")
	for _, row := range rows {
		assert.Contains(t, []careplan.Date{guardianMonday, guardianWednesday}, row.Date)
		assert.Equal(t, careplan.StudentStatusDaySick, row.Status)
		assert.Equal(t, careplan.StudentStatusSourceParent, row.Source)
		require.NotNil(t, row.GuardianAccountID)
		assert.Equal(t, f.accountID, *row.GuardianAccountID)
		require.NotNil(t, row.Note)
		assert.Equal(t, "Fieber", *row.Note)
		assert.True(t, report.ReportedAt.Equal(row.ReportedAt))
	}
	var active []string
	for _, row := range f.activeStatusDays(t) {
		active = append(active, row.Date.String()+" "+row.Status)
	}
	assert.ElementsMatch(t, []string{
		guardianMonday.String() + " " + careplan.StudentStatusDaySick,
		guardianTuesday.String() + " " + careplan.StudentStatusDayExcused,
		guardianWednesday.String() + " " + careplan.StudentStatusDaySick,
	}, active, "the Monday excusal is cleared, the unsubmitted Tuesday stays")
}

func TestGuardianAbsenceReportRefusesSchoolStatus(t *testing.T) {
	t.Parallel()
	f := newGuardianFixture(t)
	absences, err := NewGuardianAbsences(f.module)
	require.NoError(t, err)
	f.seedStatus(t, guardianMonday, careplan.StudentStatusDayClassTrip)

	_, err = absences.ReportGuardianAbsence(f.ctx, f.report(careplan.StudentStatusDaySick, guardianMonday, guardianWednesday))
	require.ErrorIs(t, err, careplan.ErrSchoolStatusDayConflict)

	rows := f.activeStatusDays(t)
	require.Len(t, rows, 1, "the refusal happens before any status is cleared or written")
	assert.Equal(t, careplan.StudentStatusDayClassTrip, rows[0].Status)
}

func TestGuardianAbsenceReportRefusesManualPartialAbsence(t *testing.T) {
	t.Parallel()
	f := newGuardianFixture(t)
	absences, err := NewGuardianAbsences(f.module)
	require.NoError(t, err)
	f.seedStatus(t, guardianMonday, careplan.StudentStatusDayExcused)
	staffID := f.staffID
	_, err = f.module.CreatePickupException(f.ctx, careplan.PickupException{
		StudentID: f.studentID, ExceptionDate: guardianWednesday, ExcusedFrom: wallClock(14, 0),
		ExcusedCreatedBy: &staffID, Source: careplan.ExceptionSourceStaff, CreatedBy: f.staffID,
	})
	require.NoError(t, err)

	_, err = absences.ReportGuardianAbsence(f.ctx, f.report(careplan.StudentStatusDaySick, guardianMonday, guardianWednesday))
	require.ErrorIs(t, err, careplan.ErrManualPartialAbsenceConflict)

	rows := f.activeStatusDays(t)
	require.Len(t, rows, 1, "the refusal happens before any status is cleared or written")
	assert.Equal(t, careplan.StudentStatusDayExcused, rows[0].Status)
}

func TestGuardianAbsenceReportAllowsAutomaticExcusalAndUnrequestedPartialAbsence(t *testing.T) {
	t.Parallel()
	f := newGuardianFixture(t)
	absences, err := NewGuardianAbsences(f.module)
	require.NoError(t, err)
	staffID := f.staffID
	_, err = f.module.CreatePickupException(f.ctx, careplan.PickupException{
		StudentID: f.studentID, ExceptionDate: guardianMonday, PickupTime: wallClock(13, 0), ExcusedFrom: wallClock(13, 0),
		ExcusedAuto: true, Source: careplan.ExceptionSourceStaff, CreatedBy: f.staffID,
	})
	require.NoError(t, err)
	_, err = f.module.CreatePickupException(f.ctx, careplan.PickupException{
		StudentID: f.studentID, ExceptionDate: guardianTuesday, ExcusedFrom: wallClock(14, 0),
		ExcusedCreatedBy: &staffID, Source: careplan.ExceptionSourceStaff, CreatedBy: f.staffID,
	})
	require.NoError(t, err)

	rows, err := absences.ReportGuardianAbsence(f.ctx, f.report(careplan.StudentStatusDayExcused, guardianMonday, guardianWednesday))
	require.NoError(t, err)
	assert.Len(t, rows, 2)
}

func TestGuardianAbsenceReportJoinsCallerTransaction(t *testing.T) {
	t.Parallel()
	f := newGuardianFixture(t)
	absences, err := NewGuardianAbsences(f.module)
	require.NoError(t, err)
	rollback := errors.New("roll back the report")

	err = tenant.WithinCurrentTenant(f.ctx, func(txCtx context.Context) error {
		rows, reportErr := absences.ReportGuardianAbsence(txCtx, f.report(careplan.StudentStatusDaySick, guardianMonday))
		require.NoError(t, reportErr)
		require.Len(t, rows, 1)
		return rollback
	})
	require.ErrorIs(t, err, rollback)
	assert.Empty(t, f.activeStatusDays(t))
}

func TestGuardianAbsenceReportRequiresDates(t *testing.T) {
	t.Parallel()
	f := newGuardianFixture(t)
	absences, err := NewGuardianAbsences(f.module)
	require.NoError(t, err)
	_, err = absences.ReportGuardianAbsence(f.ctx, f.report(careplan.StudentStatusDaySick))
	require.Error(t, err)
	_, err = NewGuardianAbsences(nil)
	require.Error(t, err)
}

// recordingExcusal observes the pickup excusal coupling. ReleaseBeforeDelete
// records whether the row still existed, which proves the release ran first.
type recordingExcusal struct {
	careplan.PickupAutoExcusal
	module careplan.Owner
	calls  []string
}

func (r *recordingExcusal) ReleaseBeforeDelete(ctx context.Context, row *careplan.PickupException) error {
	if _, err := r.module.FindPickupException(ctx, row.ID, false); err != nil {
		r.calls = append(r.calls, "release-after-delete")
		return nil
	}
	r.calls = append(r.calls, "release")
	return nil
}

func (f guardianFixture) seedPickup(t *testing.T) careplan.PickupException {
	t.Helper()
	pickup, err := f.module.CreatePickupException(f.ctx, careplan.PickupException{
		StudentID: f.studentID, ExceptionDate: guardianMonday, PickupTime: wallClock(14, 0),
		Source: careplan.ExceptionSourceGuardian, CreatedByGuardian: &f.accountID,
	})
	require.NoError(t, err)
	return pickup
}

func TestGuardianPickupExceptionWithoutExcusalCoupling(t *testing.T) {
	t.Parallel()
	f := newGuardianFixture(t)
	pickups, err := NewGuardianPickupExceptions(f.module, nil)
	require.NoError(t, err)

	require.NoError(t, pickups.WithdrawGuardianPickupException(f.ctx, f.seedPickup(t)))
	assert.Empty(t, f.pickupRows(t, guardianMonday))
	_, err = NewGuardianPickupExceptions(nil, nil)
	require.Error(t, err)
}

func TestGuardianPickupExceptionWithdrawReleasesBeforeDelete(t *testing.T) {
	t.Parallel()
	f := newGuardianFixture(t)
	excusal := &recordingExcusal{module: f.module}
	pickups, err := NewGuardianPickupExceptions(f.module, excusal)
	require.NoError(t, err)

	require.NoError(t, pickups.WithdrawGuardianPickupException(f.ctx, f.seedPickup(t)))
	assert.Empty(t, f.pickupRows(t, guardianMonday))
	assert.Equal(t, []string{"release"}, excusal.calls)
}

func TestGuardianPickupExceptionWithdrawJoinsCallerTransaction(t *testing.T) {
	t.Parallel()
	f := newGuardianFixture(t)
	pickups, err := NewGuardianPickupExceptions(f.module, &recordingExcusal{module: f.module})
	require.NoError(t, err)
	seeded := f.seedPickup(t)
	rollback := errors.New("roll back the pickup withdrawal")

	err = tenant.WithinCurrentTenant(f.ctx, func(txCtx context.Context) error {
		require.NoError(t, pickups.WithdrawGuardianPickupException(txCtx, seeded))
		rows, listErr := f.module.ListPickupExceptions(txCtx, careplan.StudentScheduleFilter{StudentIDs: []int64{f.studentID}, Date: guardianMonday})
		require.NoError(t, listErr)
		require.Empty(t, rows)
		return rollback
	})
	require.ErrorIs(t, err, rollback)
	rows := f.pickupRows(t, guardianMonday)
	require.Len(t, rows, 1)
	assert.Equal(t, seeded.ID, rows[0].ID)
}
