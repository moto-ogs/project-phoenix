package contracttest_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/securityruntime"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
	"github.com/moto-ogs/project-phoenix/modules/careplan/compose"
	calendar "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

var errApprovalProbe = errors.New("approval dependency unavailable")

type pickupApprovalFixture struct {
	input       carerequests.PickupApproval
	staffID     int64
	exceptionID int64
	guardianID  int64
	calls       []string
	fail        string
	completed   bool
	open        bool
	existing    *careplan.PickupException
	written     *careplan.PickupException
	// The day Abholart (#3945).
	departureID       int64
	existingDeparture *careplan.DepartureException
	writtenDeparture  *careplan.DepartureException
	// The day's pickup person (#8162).
	existingPerson *careplan.PickupPerson
	weeklyModes    map[string][]string
}

func (f *pickupApprovalFixture) step(name string) error {
	f.calls = append(f.calls, name)
	if f.fail == name {
		return errApprovalProbe
	}
	return nil
}
func (f *pickupApprovalFixture) EnrolledUntil(context.Context, int64) (*calendar.Date, error) {
	return nil, f.step("enrollment")
}
func (f *pickupApprovalFixture) CurrentStaffID(context.Context) (int64, bool, error) {
	return f.staffID, true, f.step("staff")
}
func (f *pickupApprovalFixture) ValidatePickupPerson(context.Context, int64, int64) error {
	return f.step("pickup-person")
}
func (*pickupApprovalFixture) PickupTime(context.Context, int64, calendar.Date) (*time.Time, error) {
	return nil, nil
}
func (f *pickupApprovalFixture) DayDepartureMode(ctx context.Context, studentID int64, date calendar.Date) (string, bool, error) {
	departure, err := f.FindDepartureForDate(ctx, studentID, date)
	if err != nil || departure == nil {
		return "", false, err
	}
	return departure.DepartureMode, true, nil
}
func (f *pickupApprovalFixture) WeeklyDepartureModes(context.Context, int64) (map[string][]string, error) {
	return f.weeklyModes, nil
}
func (f *pickupApprovalFixture) LockStudentAndExceptionDay(context.Context, int64, string) error {
	return f.step("student-day-lock")
}
func (f *pickupApprovalFixture) LockStudentAttendance(context.Context, int64) error {
	return f.step("attendance-lock")
}
func (f *pickupApprovalFixture) AttendanceCompletion(context.Context, int64, calendar.Date) (bool, bool, error) {
	return f.open, f.completed, f.step("attendance")
}
func (f *pickupApprovalFixture) Preview(context.Context, int64, calendar.Date, time.Time) ([]carerequests.Block, error) {
	return nil, f.step("preview")
}
func (f *pickupApprovalFixture) Sync(context.Context, int64) error { return f.step("sync") }

// FindForDate serves the day's row; after a write it is the approval's read
// back of the row it wrote, for the decision ledger's version.
func (f *pickupApprovalFixture) FindForDate(context.Context, int64, calendar.Date) (*careplan.PickupException, error) {
	if f.written != nil {
		row := *f.written
		if row.ID == 0 {
			row.ID = f.exceptionID
		}
		return &row, f.step("exception-read-back")
	}
	return f.existing, f.step("exception")
}
func (f *pickupApprovalFixture) Create(_ context.Context, row careplan.PickupException) (int64, error) {
	f.written = &row
	return f.exceptionID, f.step("create")
}
func (f *pickupApprovalFixture) Update(_ context.Context, row careplan.PickupException) error {
	f.written = &row
	return f.step("update")
}
func (*pickupApprovalFixture) IsUniqueViolation(error) bool { return false }
func (f *pickupApprovalFixture) FindDepartureForDate(context.Context, int64, calendar.Date) (*careplan.DepartureException, error) {
	if f.writtenDeparture != nil {
		row := *f.writtenDeparture
		row.ID = f.departureID
		return &row, f.step("departure-read-back")
	}
	return f.existingDeparture, f.step("departure")
}
func (f *pickupApprovalFixture) SaveDeparture(_ context.Context, row careplan.DepartureException) (int64, error) {
	f.writtenDeparture = &row
	return f.departureID, f.step("save-departure")
}

func (f *pickupApprovalFixture) ListDayPickups(_ context.Context, day, _ calendar.Date, ids []int64) ([]careplan.DayPickup, error) {
	if f.existingPerson == nil {
		return nil, f.step("pickup-person")
	}
	return []careplan.DayPickup{{StudentID: ids[0], Date: careplan.Date(day), Person: f.existingPerson}}, f.step("pickup-person")
}

func (f *pickupApprovalFixture) SaveApprovedPickupPerson(_ context.Context, row careplan.PickupPerson) (careplan.PickupPerson, error) {
	row.ID = 1
	f.existingPerson = &row
	return row, f.step("save-pickup-person")
}

func newPickupApprovalFixture(t *testing.T) *pickupApprovalFixture {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	student := testpkg.CreateTestStudent(t, db, "Pickup", "Approval", "1a")
	staff := testpkg.CreateTestStaff(t, db, "Pickup", "Reviewer")
	guardian := testpkg.CreateTestAccount(t, db, "parent")
	exception := testpkg.CreateTestPickupException(t, db, student.ID, calendar.Date("2026-09-21"), staff.ID, "14:30", "Termin")
	token := securityruntime.Fingerprint(carerequests.PickupImpactContent(nil))
	return &pickupApprovalFixture{staffID: staff.ID, exceptionID: exception.ID, guardianID: guardian.ID,
		weeklyModes: map[string][]string{"mon": {careplan.DepartureModePickup}},
		input: carerequests.PickupApproval{
			TenantID: testpkg.Tenant(t), StudentID: student.ID, Payload: json.RawMessage(`{"date":"2026-09-21","pickup_time":"14:30","reason":"Termin"}`),
			ExpectedImpactToken: &token, RequireImpactToken: true,
		}}
}
func approvalService(t *testing.T, fixture *pickupApprovalFixture) carerequests.PickupApprovals {
	t.Helper()
	service, err := compose.NewPickupApprovals(compose.PickupApprovalDependencies{
		Fingerprint: securityruntime.Fingerprint,
		People:      fixture, Departure: fixture, Presence: fixture, Exceptions: fixture, Excusal: fixture, Locker: fixture, Persons: fixture,
		Today: func() calendar.Date { return "2026-09-21" },
	})
	require.NoError(t, err)
	return service
}

func TestNativePickupApprovalLocksBeforeWritingAndSyncing(t *testing.T) {
	t.Parallel()
	f := newPickupApprovalFixture(t)
	applied, err := approvalService(t, f).ApplyPickupApproval(context.Background(), f.input)
	require.NoError(t, err)
	require.Equal(t, f.exceptionID, applied.PickupExceptionID)
	require.Zero(t, applied.DepartureExceptionID)
	require.Equal(t, []string{"enrollment", "student-day-lock", "preview", "attendance-lock", "attendance", "staff", "exception", "create", "sync", "exception-read-back"}, f.calls)
	require.Equal(t, f.input.TenantID, f.written.TenantID)
	require.Equal(t, f.input.StudentID, f.written.StudentID)
	require.Equal(t, f.staffID, f.written.CreatedBy)
	require.Equal(t, careplan.ExceptionSourceStaff, f.written.Source)
	require.Equal(t, careplan.Date("2026-09-21"), f.written.ExceptionDate)
	require.Equal(t, "14:30", f.written.PickupTime.Format("15:04"))
}

func TestNativePickupApprovalRequiresImpactFingerprint(t *testing.T) {
	t.Parallel()
	fixture := &pickupApprovalFixture{}
	service, err := compose.NewPickupApprovals(compose.PickupApprovalDependencies{
		People: fixture, Departure: fixture, Presence: fixture, Exceptions: fixture, Excusal: fixture, Locker: fixture, Persons: fixture,
		Today: func() calendar.Date { return "2026-09-21" },
	})
	require.ErrorContains(t, err, "impact fingerprint")
	require.Nil(t, service)
}

func TestNativePickupApprovalRejectsMalformedStoredPayloadBeforeEffects(t *testing.T) {
	t.Parallel()
	for _, raw := range []string{
		"{", "null", "[]",
		`{"date":"2026-09-21","pickup_time":1430,"reason":"Termin"}`,
		`{"date":"2026-09-21","pickup_time":"14:30","reason":null}`,
		`{"date":"2026-09-21","pickup_person":{"name":"Tante Frieda","guardian_profile_id":"12"},"reason":"Termin"}`,
		`{"date":"2026-09-21","pickup_person":{"name":"Tante Frieda","guardian_profile_id":0},"reason":"Termin"}`,
		`{"date":"2026-09-21","pickup_person":{"name":"Tante Frieda","guardian_profile_id":1.5},"reason":"Termin"}`,
		`{"date":"2026-09-21","departure_mode":"alone","pickup_person":{"name":"Tante Frieda"},"reason":"Termin"}`,
		`{"date":"2026-09-21","departure_mode":"bus","pickup_person":{"name":"Tante Frieda"},"reason":"Termin"}`,
	} {
		t.Run(raw, func(t *testing.T) {
			t.Parallel()
			f := &pickupApprovalFixture{input: carerequests.PickupApproval{Payload: json.RawMessage(raw)}}
			_, err := approvalService(t, f).ApplyPickupApproval(t.Context(), f.input)
			require.ErrorIs(t, err, carerequests.ErrInvalidPayload)
			require.Empty(t, f.calls)
			require.Nil(t, f.written)
		})
	}
}

func TestNativePickupApprovalFailsClosedBeforeMutation(t *testing.T) {
	t.Parallel()
	for _, stage := range []string{"enrollment", "student-day-lock", "preview", "attendance-lock", "attendance", "staff", "exception"} {
		t.Run(stage, func(t *testing.T) {
			t.Parallel()
			f := newPickupApprovalFixture(t)
			f.fail = stage
			_, err := approvalService(t, f).ApplyPickupApproval(context.Background(), f.input)
			require.ErrorIs(t, err, errApprovalProbe)
			require.Nil(t, f.written)
			require.NotContains(t, f.calls, "sync")
			require.Equal(t, stage, f.calls[len(f.calls)-1])
		})
	}
}

func TestNativePickupApprovalPreservesCheckoutAndManualExceptionGuards(t *testing.T) {
	t.Parallel()
	clock := time.Date(0, 1, 1, 13, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name    string
		fixture pickupApprovalFixture
		want    error
	}{
		{"completed", pickupApprovalFixture{completed: true}, carerequests.ErrPickupChangeAlreadyCompleted},
		{"staff exception", pickupApprovalFixture{existing: &careplan.PickupException{Source: careplan.ExceptionSourceStaff}}, carerequests.ErrPickupChangeConflict},
		{"manual partial absence", pickupApprovalFixture{existing: &careplan.PickupException{ExcusedFrom: &clock}}, carerequests.ErrPickupChangeConflict},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newPickupApprovalFixture(t)
			f.completed, f.existing = tc.fixture.completed, tc.fixture.existing
			_, err := approvalService(t, f).ApplyPickupApproval(context.Background(), f.input)
			require.ErrorIs(t, err, tc.want)
			require.Nil(t, f.written)
			require.NotContains(t, f.calls, "sync")
		})
	}
}

func TestNativePickupApprovalReclaimsGuardianExceptionWithoutLosingAutoExcusal(t *testing.T) {
	t.Parallel()
	f := newPickupApprovalFixture(t)
	guardian := f.guardianID
	clock := time.Date(0, 1, 1, 13, 0, 0, 0, time.UTC)
	f.open, f.completed = true, true
	f.existing = &careplan.PickupException{
		ID: f.exceptionID, TenantID: f.input.TenantID, StudentID: f.input.StudentID, ExceptionDate: "2026-09-21", Source: careplan.ExceptionSourceGuardian,
		CreatedByGuardian: &guardian, ExcusedAuto: true, ExcusedFrom: &clock,
	}
	applied, err := approvalService(t, f).ApplyPickupApproval(context.Background(), f.input)
	require.NoError(t, err)
	require.Equal(t, f.exceptionID, applied.PickupExceptionID)
	require.Equal(t, f.staffID, f.written.CreatedBy)
	require.Nil(t, f.written.CreatedByGuardian)
	require.True(t, f.written.ExcusedAuto)
	require.Equal(t, calendar.NormalizeWallClock(clock), *f.written.ExcusedFrom)
	require.Contains(t, f.calls, "update")
	require.NotContains(t, f.calls, "create")
	require.Equal(t, []string{"sync", "exception-read-back"}, f.calls[len(f.calls)-2:], "sync stays the last write")
}

// #3945: a request that changes only the Abholart writes the day value under
// the same lock and never touches the pickup exception, its impact or the
// auto excusal.
func TestNativePickupApprovalWritesOnlyTheDayDeparture(t *testing.T) {
	t.Parallel()
	f := newPickupApprovalFixture(t)
	f.departureID = 91
	f.input.Payload = json.RawMessage(`{"date":"2026-09-21","departure_mode":"bus","reason":"Ausflug"}`)
	applied, err := approvalService(t, f).ApplyPickupApproval(context.Background(), f.input)
	require.NoError(t, err)
	require.NotEmpty(t, applied.DepartureExceptionVersion, "the ledger keeps the written row's version")
	applied.DepartureExceptionVersion = ""
	require.Equal(t, carerequests.PickupApplied{DepartureExceptionID: 91}, applied)
	require.Equal(t, []string{"enrollment", "student-day-lock", "attendance-lock", "attendance", "staff", "departure", "save-departure", "departure-read-back"}, f.calls)
	require.Nil(t, f.written)
	require.Equal(t, "bus", f.writtenDeparture.DepartureMode)
	require.Equal(t, careplan.Date("2026-09-21"), f.writtenDeparture.ExceptionDate)
	require.Equal(t, f.staffID, *f.writtenDeparture.CreatedBy)
	require.Equal(t, "Ausflug", *f.writtenDeparture.Reason)
}

func TestNativePickupApprovalRefusesDayDepartureOnNonCareWeekend(t *testing.T) {
	t.Parallel()
	f := newPickupApprovalFixture(t)
	f.input.Payload = json.RawMessage(`{"date":"2026-09-26","departure_mode":"bus","reason":"Ausflug"}`)

	_, err := approvalService(t, f).ApplyPickupApproval(context.Background(), f.input)
	require.ErrorIs(t, err, careplan.ErrDepartureExceptionNotCareDay)
	require.Empty(t, f.calls)
	require.Nil(t, f.writtenDeparture)
}

func TestNativePickupApprovalRefusesPickupPersonOnNonCareWeekend(t *testing.T) {
	t.Parallel()
	f := newPickupApprovalFixture(t)
	f.input.Payload = json.RawMessage(`{"date":"2026-09-26","pickup_person":{"name":"Tante Frieda"},"reason":"Ausflug"}`)

	_, err := approvalService(t, f).ApplyPickupApproval(context.Background(), f.input)

	require.ErrorIs(t, err, careplan.ErrDepartureExceptionNotCareDay)
	require.Empty(t, f.calls)
	require.Nil(t, f.existingPerson)
}

// Both legs: the time first (with its impact and excusal), then the mode.
func TestNativePickupApprovalWritesTimeAndDayDeparture(t *testing.T) {
	t.Parallel()
	f := newPickupApprovalFixture(t)
	f.departureID = 92
	f.input.Payload = json.RawMessage(`{"date":"2026-09-21","pickup_time":"14:30","departure_mode":"pickup","reason":"Termin"}`)
	applied, err := approvalService(t, f).ApplyPickupApproval(context.Background(), f.input)
	require.NoError(t, err)
	require.NotEmpty(t, applied.PickupExceptionVersion, "the ledger keeps the written row's version")
	require.NotEmpty(t, applied.DepartureExceptionVersion, "the ledger keeps the written row's version")
	applied.PickupExceptionVersion, applied.DepartureExceptionVersion = "", ""
	require.Equal(t, carerequests.PickupApplied{PickupExceptionID: f.exceptionID, DepartureExceptionID: 92}, applied)
	require.Equal(t, []string{"enrollment", "student-day-lock", "preview", "attendance-lock", "attendance", "staff", "exception", "create", "sync", "exception-read-back", "departure", "save-departure", "departure-read-back"}, f.calls)
}

// A day Abholart the OGS already set wins over the parent's request, like a
// staff pickup exception.
func TestNativePickupApprovalRefusesOverAnOGSDayDeparture(t *testing.T) {
	t.Parallel()
	f := newPickupApprovalFixture(t)
	f.existingDeparture = &careplan.DepartureException{ID: 5, DepartureMode: "alone"}
	f.input.Payload = json.RawMessage(`{"date":"2026-09-21","departure_mode":"bus","reason":"Ausflug"}`)
	_, err := approvalService(t, f).ApplyPickupApproval(context.Background(), f.input)
	require.ErrorIs(t, err, carerequests.ErrPickupChangeConflict)
	require.Nil(t, f.writtenDeparture)
}

func TestNativePickupApprovalRefusesPickupPersonIncompatibleWithDayDeparture(t *testing.T) {
	t.Parallel()
	for _, mode := range []string{careplan.DepartureModeAlone, careplan.DepartureModeBus} {
		t.Run(mode, func(t *testing.T) {
			f := newPickupApprovalFixture(t)
			f.existingDeparture = &careplan.DepartureException{ID: 5, DepartureMode: mode}
			f.input.Payload = json.RawMessage(`{"date":"2026-09-21","pickup_person":{"name":"Tante Frieda"},"reason":"Ausflug"}`)

			_, err := approvalService(t, f).ApplyPickupApproval(context.Background(), f.input)

			require.ErrorIs(t, err, carerequests.ErrPickupChangeConflict)
			require.Nil(t, f.existingPerson)
		})
	}
}

func TestNativePickupApprovalRefusesPickupPersonIncompatibleWithWeeklyDeparture(t *testing.T) {
	t.Parallel()
	for _, mode := range []string{careplan.DepartureModeAlone, careplan.DepartureModeBus} {
		t.Run(mode, func(t *testing.T) {
			f := &pickupApprovalFixture{
				staffID:     1,
				weeklyModes: map[string][]string{"mon": {mode}},
				input: carerequests.PickupApproval{
					StudentID: 1,
					Payload:   json.RawMessage(`{"date":"2026-09-21","pickup_person":{"name":"Tante Frieda"},"reason":"Ausflug"}`),
				},
			}

			_, err := approvalService(t, f).ApplyPickupApproval(t.Context(), f.input)

			require.ErrorIs(t, err, carerequests.ErrPickupChangeConflict)
			require.Nil(t, f.existingPerson)
		})
	}
}
