package contracttest_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/careplantest"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// pickupExceptionsOn stores one ordinary pickup exception per day from the
// first day on and returns their IDs in date order.
func pickupExceptionsOn(t *testing.T, ctx context.Context, service careplan.PickupScheduleService, studentID, staffID int64, first calendar.Date, days int) []int64 {
	t.Helper()
	ids := make([]int64, 0, days)
	for day := range days {
		row, err := service.CreateOrReclaimException(ctx, studentID, first.AddDays(day), nil, testpkg.StrPtr("Ausnahme"), staffID, nil)
		require.NoError(t, err)
		ids = append(ids, row.ID)
	}
	return ids
}

// Refusing to delete a partial absence keeps the exception snapshot intact,
// including the child's ordinary exceptions on the surrounding days.
func TestDeletePickupExceptionWithPartialAbsenceKeepsSnapshot(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	service := setupPickupScheduleService(t, db)
	ctx := testpkg.Ctx(t)
	student := testpkg.CreateTestStudent(t, db, "Teil", "Abwesend", "1a")
	staffID := createPickupServiceTestStaffID(t, db)
	monday := calendar.NewDate(2099, 3, 9)
	before := pickupExceptionsOn(t, ctx, service, student.ID, staffID, monday, 1)
	from := calendar.NormalizeWallClock(time.Date(2000, 1, 1, 13, 30, 0, 0, time.UTC))
	partial := &careplan.PickupException{
		StudentID: student.ID, ExceptionDate: careplan.Date(monday.AddDays(1)), PickupTime: &from,
		ExcusedFrom: &from, ExcusedCreatedBy: &staffID, ExcusedOwnsPickupTime: true, CreatedBy: staffID,
	}
	require.NoError(t, createPickupExceptionFixture(t, ctx, db, partial))
	after := pickupExceptionsOn(t, ctx, service, student.ID, staffID, monday.AddDays(2), 1)

	rollback := errors.New("roll the deletion back")
	var deleteErr error
	var remaining []int64
	err := testpkg.TenantCommand0(t, ctx, db, func(txCtx context.Context) error {
		deleteErr = service.DeleteStudentPickupException(txCtx, partial.ID, student.ID)
		data, readErr := service.GetStudentPickupData(txCtx, student.ID)
		require.NoError(t, readErr)
		for _, row := range data.Exceptions {
			remaining = append(remaining, row.ID)
		}
		return rollback
	})
	require.ErrorIs(t, err, rollback)
	require.ErrorIs(t, deleteErr, careplan.ErrCareExceptionContainsPartialAbsence)
	assert.Equal(t, []int64{before[0], partial.ID, after[0]}, remaining, "the refused single deletion keeps the entire snapshot")
}

// A storage failure of a single deletion keeps every exception in the snapshot.
func TestDeletePickupExceptionStorageFailureKeepsSnapshot(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	service := setupPickupScheduleService(t, db)
	ctx := testpkg.Ctx(t)
	student := testpkg.CreateTestStudent(t, db, "Fehler", "Löschen", "1a")
	staffID := createPickupServiceTestStaffID(t, db)
	ids := pickupExceptionsOn(t, ctx, service, student.ID, staffID, calendar.NewDate(2099, 3, 9), 3)
	_, err := db.ExecContext(ctx, fmt.Sprintf(`
		CREATE FUNCTION schedule.fail_pickup_delete_5901() RETURNS trigger AS $$
		BEGIN
			IF OLD.id = %d THEN RAISE EXCEPTION 'injected pickup delete failure'; END IF;
			RETURN OLD;
		END $$ LANGUAGE plpgsql;
		CREATE TRIGGER fail_pickup_delete_5901 BEFORE DELETE ON schedule.student_pickup_exceptions
			FOR EACH ROW EXECUTE FUNCTION schedule.fail_pickup_delete_5901();`, ids[1]))
	require.NoError(t, err)

	err = testpkg.TenantCommand2(t, ctx, db, service.DeleteStudentPickupException, ids[1], student.ID)
	require.ErrorContains(t, err, "injected pickup delete failure")
	var scheduleErr *careplan.ScheduleError
	require.ErrorAs(t, err, &scheduleErr)
	assert.Equal(t, "delete student pickup exception", scheduleErr.Op)
	data, err := testpkg.TenantQuery1(t, ctx, db, service.GetStudentPickupData, student.ID)
	require.NoError(t, err)
	remaining := make([]int64, 0, len(data.Exceptions))
	for _, row := range data.Exceptions {
		remaining = append(remaining, row.ID)
	}
	assert.Equal(t, ids, remaining, "the failed deletion keeps every exception")
}

func TestCarePlanClearsHolidayGuestExceptions(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	owner := careplantest.NewCarePlan(t, db, testpkg.StudentDirectory{}, decisionTestClock)
	student := testpkg.CreateTestStudent(t, db, "Ferien", "Gast", "1a")
	first := calendar.NewDate(2099, time.March, 9)
	arrival := time.Date(2000, time.January, 1, 8, 0, 0, 0, time.UTC)
	pickup := arrival.Add(6 * time.Hour)
	for offset := range 3 {
		date := careplan.Date(first.AddDays(offset))
		_, err := owner.CreateArrivalException(ctx, careplan.ArrivalException{
			StudentID: student.ID, ExceptionDate: date, ExpectedArrival: &arrival, Source: careplan.ExceptionSourceHolidayBooking,
		})
		require.NoError(t, err)
		_, err = owner.CreatePickupException(ctx, careplan.PickupException{
			StudentID: student.ID, ExceptionDate: date, PickupTime: &pickup, Source: careplan.ExceptionSourceHolidayBooking,
		})
		require.NoError(t, err)
	}

	require.NoError(t, owner.DeleteArrivalExceptionsByStudent(ctx, student.ID))
	require.NoError(t, owner.DeletePickupExceptionsByStudent(ctx, student.ID))

	filter := careplan.StudentScheduleFilter{StudentIDs: []int64{student.ID}}
	arrivals, err := owner.ListArrivalExceptions(ctx, filter)
	require.NoError(t, err)
	assert.Empty(t, arrivals)
	pickups, err := owner.ListPickupExceptions(ctx, filter)
	require.NoError(t, err)
	assert.Empty(t, pickups)
}
