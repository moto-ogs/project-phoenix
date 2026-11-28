package careplanhttp_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	careplanCompose "github.com/moto-ogs/project-phoenix/modules/careplan/compose"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// changedPermission is what a permission change reported: whether the
// permission was there, and the days it removed.
type changedPermission struct {
	Found       bool
	RemovedDays []careplan.RemovedPickupDay
}

// pickupDayWire is a day of the child's pickup data with its validity.
type pickupDayWire struct {
	ExceptionDate       string `json:"exception_date"`
	Name                string `json:"name"`
	RequestedByGuardian bool   `json:"requested_by_guardian"`
	PermissionWithdrawn bool   `json:"permission_withdrawn"`
}

func relationshipOf(t *testing.T, db *bun.DB, studentID, guardianProfileID int64) int64 {
	t.Helper()
	var id int64
	require.NoError(t, db.NewRaw(`SELECT id FROM users.student_guardian_relationships WHERE tenant_id = ? AND student_id = ? AND guardian_profile_id = ?`,
		testpkg.Tenant(t), studentID, guardianProfileID).Scan(testpkg.Ctx(t), &id))
	return id
}

// familyPickupDay writes the day value an approved one-day request of a
// family leaves (#8162): the contact, its relationship and the requesting
// guardian account.
func familyPickupDay(t *testing.T, db *bun.DB, studentID, guardianProfileID, relationshipID, accountID int64, day calendar.Date, name string) {
	t.Helper()
	_, err := db.ExecContext(testpkg.Ctx(t), `INSERT INTO schedule.student_pickup_persons
		(tenant_id, student_id, exception_date, person_name, guardian_profile_id, relationship_id, requested_by_guardian)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, testpkg.Tenant(t), studentID, day, name, guardianProfileID, relationshipID, accountID)
	require.NoError(t, err)
}

// Withdrawing a contact's pickup permission reaches the days it was named
// for (#8206, Kopie oder Verbindung): the source is Care Plan's pickup
// permission, the target the pickup persons of today and later. Narrowing the
// weekdays removes the days of the withdrawn weekdays, a full withdrawal the
// rest, the staff-set days and those a family's one-day request named alike;
// the command names every removed day. Another contact's day stays, and a
// command of one school never reaches the days of another.
func TestWithdrawnPickupPermissionRemovesTheFutureDays(t *testing.T) {
	t.Parallel()
	tc := setupStudentsRoute(t, fixedCalendarClock)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Entzug", "Teacher")
	admin := testutil.AdminTestClaims(int(account.ID))
	student := testpkg.CreateTestStudent(t, tc.db, "Entzug", "Kind", "EZ1")
	grandma := testpkg.CreateTestGuardianProfileNamed(t, tc.db, "Oma", "Berta", "entzug-oma")
	testpkg.CreateTestStudentGuardianLink(t, tc.db, student.ID, grandma.ID, "pickup_only")
	grandpa := testpkg.CreateTestGuardianProfileNamed(t, tc.db, "Opa", "Kurt", "entzug-opa")
	testpkg.CreateTestStudentGuardianLink(t, tc.db, student.ID, grandpa.ID, "pickup_only")
	parent := testpkg.CreateTestAccount(t, tc.db, "entzug-parent")
	relationship := relationshipOf(t, tc.db, student.ID, grandma.ID)

	// studentsTestToday is a Monday.
	tuesday, wednesday, thursday, friday, saturday, nextMonday := studentsTestToday.AddDays(1), studentsTestToday.AddDays(2),
		studentsTestToday.AddDays(3), studentsTestToday.AddDays(4), studentsTestToday.AddDays(5), studentsTestToday.AddDays(7)
	for _, day := range []calendar.Date{tuesday, wednesday, nextMonday} {
		code, body := putPickupPerson(t, tc, admin, student.ID, day, map[string]any{"guardian_profile_id": fmt.Sprint(grandma.ID)})
		require.Equal(t, http.StatusOK, code, body)
	}
	familyPickupDay(t, tc.db, student.ID, grandma.ID, relationship, parent.ID, thursday, "Oma Berta")
	// A legacy weekend row is not part of Friday's plan at the default setting.
	// It remains visible as withdrawn, but withdrawing Friday must not delete it.
	familyPickupDay(t, tc.db, student.ID, grandma.ID, relationship, parent.ID, saturday, "Oma Berta")
	code, body := putPickupPerson(t, tc, admin, student.ID, friday, map[string]any{"guardian_profile_id": fmt.Sprint(grandpa.ID)})
	require.Equal(t, http.StatusOK, code, body)

	permissions, err := careplanCompose.NewGuardianPickupPermissions(tc.db, func(careplanCompose.Observation) {})
	require.NoError(t, err)
	change := func(commandCtx context.Context, tenant int64, change careplan.GuardianPickupPermissionChange) changedPermission {
		t.Helper()
		var changed changedPermission
		change.Removed = func(days []careplan.RemovedPickupDay) { changed.RemovedDays = days }
		require.NoError(t, testpkg.WithTenantTx(t, commandCtx, tc.db, tenant, func(ctx context.Context, _ testpkg.Tx) error {
			var err error
			changed.Found, err = permissions.ChangeGuardianPickupPermission(ctx, change)
			return err
		}))
		return changed
	}
	days := func() []string {
		t.Helper()
		var out []string
		for _, person := range listedPickupDays(t, tc, admin, student.ID, studentsTestToday) {
			out = append(out, person.ExceptionDate+" "+person.Name)
		}
		return out
	}
	removedDays := func(changed changedPermission) []string {
		var out []string
		for _, day := range changed.RemovedDays {
			out = append(out, day.Date.String()+" "+day.Name)
		}
		return out
	}

	t.Run("another school's command reaches nothing", func(t *testing.T) {
		otherTenant := testpkg.UniqueTestTenantID(t)
		testpkg.EnsureTestTenant(t, tc.db, otherTenant)
		otherCtx := tenant.WithTenantID(testpkg.WithPackageTenantRuntime(context.Background()), otherTenant)
		canPickup := false
		var changed changedPermission
		removed := func(days []careplan.RemovedPickupDay) { changed.RemovedDays = days }
		require.NoError(t, testpkg.WithTenantTx(t, otherCtx, tc.db, otherTenant, func(ctx context.Context, _ testpkg.Tx) error {
			_, err := permissions.ChangeGuardianPickupPermission(ctx, careplan.GuardianPickupPermissionChange{
				TenantID: tenantID, RelationshipID: relationship, CanPickup: &canPickup, Removed: removed,
			})
			require.ErrorIs(t, err, careplan.ErrGuardianPickupTenantMismatch, "a command naming another school is refused")
			changed.Found, err = permissions.ChangeGuardianPickupPermission(ctx, careplan.GuardianPickupPermissionChange{
				TenantID: otherTenant, RelationshipID: relationship, CanPickup: &canPickup, Removed: removed,
			})
			return err
		}))
		assert.False(t, changed.Found)
		assert.Empty(t, changed.RemovedDays)
		assert.Len(t, days(), 6)
	})

	t.Run("narrowing the weekdays removes the withdrawn weekday", func(t *testing.T) {
		canPickup := true
		changed := change(ctx, tenantID, careplan.GuardianPickupPermissionChange{
			TenantID: tenantID, RelationshipID: relationship, CanPickup: &canPickup, SetWeekdays: true, Weekdays: []int{1, 2, 4, 5},
		})
		require.True(t, changed.Found)
		assert.Equal(t, []string{wednesday.String() + " Oma Berta"}, removedDays(changed))
		assert.Equal(t, []string{
			tuesday.String() + " Oma Berta", thursday.String() + " Oma Berta", friday.String() + " Opa Kurt", saturday.String() + " Oma Berta", nextMonday.String() + " Oma Berta",
		}, days())
	})

	t.Run("a full withdrawal removes the rest and names the family's day", func(t *testing.T) {
		canPickup := false
		changed := change(ctx, tenantID, careplan.GuardianPickupPermissionChange{TenantID: tenantID, RelationshipID: relationship, CanPickup: &canPickup})
		require.True(t, changed.Found)
		assert.Equal(t, []string{tuesday.String() + " Oma Berta", thursday.String() + " Oma Berta", nextMonday.String() + " Oma Berta"}, removedDays(changed))
		require.NotNil(t, changed.RemovedDays[1].RequestedByGuardian, "the family that named the day")
		assert.Equal(t, parent.ID, *changed.RemovedDays[1].RequestedByGuardian)
		assert.Nil(t, changed.RemovedDays[0].RequestedByGuardian)
		assert.Equal(t, []string{friday.String() + " Opa Kurt", saturday.String() + " Oma Berta"}, days(), "the other contact and a closed-weekend day stay")
	})

	t.Run("granting again removes nothing", func(t *testing.T) {
		canPickup := true
		changed := change(ctx, tenantID, careplan.GuardianPickupPermissionChange{TenantID: tenantID, RelationshipID: relationship, CanPickup: &canPickup})
		require.True(t, changed.Found)
		assert.Empty(t, changed.RemovedDays)
	})

	t.Run("a Friday-plan weekend follows the withdrawal", func(t *testing.T) {
		canPickup := false
		weekendCtx := calendar.WithWeekendPlan(ctx, func(context.Context) (bool, error) { return true, nil })
		changed := change(weekendCtx, tenantID, careplan.GuardianPickupPermissionChange{TenantID: tenantID, RelationshipID: relationship, CanPickup: &canPickup})
		require.True(t, changed.Found)
		assert.Equal(t, []string{saturday.String() + " Oma Berta"}, removedDays(changed))
		assert.Equal(t, []string{friday.String() + " Opa Kurt"}, days())
	})
}

// A day value whose contact has no pickup permission on that day reads as
// withdrawn (#8206), however it got there: written directly here, past the
// check at saving. A day a family's signed one-day request named rests on the
// request and stays valid; a one-time person has no permission to lose.
func TestPickupDayWithoutPermissionReadsAsWithdrawn(t *testing.T) {
	t.Parallel()
	tc := setupStudentsRoute(t, fixedCalendarClock)
	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Lesen", "Teacher")
	admin := testutil.AdminTestClaims(int(account.ID))
	student := testpkg.CreateTestStudent(t, tc.db, "Lesen", "Kind", "LP1")
	allowed := testpkg.CreateTestGuardianProfileNamed(t, tc.db, "Oma", "Erlaubt", "lesen-oma")
	testpkg.CreateTestStudentGuardianLink(t, tc.db, student.ID, allowed.ID, "pickup_only")
	mondays := testpkg.CreateTestGuardianProfileNamed(t, tc.db, "Opa", "Montags", "lesen-opa")
	testpkg.CreateTestStudentGuardianLink(t, tc.db, student.ID, mondays.ID, "pickup_only")
	_, err := tc.db.ExecContext(testpkg.Ctx(t), `UPDATE users.student_guardian_pickup_permissions SET pickup_weekdays = '{1}'
		WHERE tenant_id = ? AND relationship_id = ?`, testpkg.Tenant(t), relationshipOf(t, tc.db, student.ID, mondays.ID))
	require.NoError(t, err)
	neighbour := testpkg.CreateTestGuardianProfileNamed(t, tc.db, "Nachbar", "Ohne", "lesen-nachbar")
	unauthorized := &testpkg.StudentGuardian{StudentID: student.ID, GuardianProfileID: neighbour.ID, RelationshipType: "other", EmergencyPriority: 2}
	unauthorized.TenantID = testpkg.Tenant(t)
	require.NoError(t, testpkg.InsertTestStudentGuardian(testpkg.Ctx(t), tc.db, unauthorized))

	tuesday := studentsTestToday.AddDays(1)
	testpkg.CreateTestPickupPerson(t, tc.db, student.ID, studentsTestToday, 0, "Opa Montags", mondays.ID)
	testpkg.CreateTestPickupPerson(t, tc.db, student.ID, tuesday, 0, "Opa Montags", mondays.ID)
	testpkg.CreateTestPickupPerson(t, tc.db, student.ID, studentsTestToday.AddDays(2), 0, "Nachbar Ohne", neighbour.ID)
	testpkg.CreateTestPickupPerson(t, tc.db, student.ID, studentsTestToday.AddDays(3), 0, "Oma Erlaubt", allowed.ID)
	family := testpkg.CreateTestAccount(t, tc.db, "lesen-parent")
	familyPickupDay(t, tc.db, student.ID, neighbour.ID, relationshipOf(t, tc.db, student.ID, neighbour.ID), family.ID, studentsTestToday.AddDays(4), "Nachbar Ohne")
	saturday := studentsTestToday.AddDays(5)
	testpkg.CreateTestPickupPerson(t, tc.db, student.ID, saturday, 0, "Oma Erlaubt", allowed.ID)
	testpkg.CreateTestPickupPerson(t, tc.db, student.ID, studentsTestToday.AddDays(7), 0, "Tante Frieda", 0)

	expected := []pickupDayWire{
		{ExceptionDate: studentsTestToday.String(), Name: "Opa Montags"},
		{ExceptionDate: tuesday.String(), Name: "Opa Montags", PermissionWithdrawn: true},
		{ExceptionDate: studentsTestToday.AddDays(2).String(), Name: "Nachbar Ohne", PermissionWithdrawn: true},
		{ExceptionDate: studentsTestToday.AddDays(3).String(), Name: "Oma Erlaubt"},
		{ExceptionDate: studentsTestToday.AddDays(4).String(), Name: "Nachbar Ohne", RequestedByGuardian: true},
		{ExceptionDate: saturday.String(), Name: "Oma Erlaubt", PermissionWithdrawn: true},
		{ExceptionDate: studentsTestToday.AddDays(7).String(), Name: "Tante Frieda"},
	}
	assert.Equal(t, expected, listedPickupDays(t, tc, admin, student.ID, studentsTestToday))

	// The same Saturday is valid when this tenant runs it on Friday's plan.
	expected[5].PermissionWithdrawn = false
	assert.Equal(t, expected, listedPickupDaysWithWeekendPlan(t, tc, admin, student.ID, studentsTestToday, true))
}

func putPickupPerson(t *testing.T, tc *testContext, claims sessiontoken.AppClaims, studentID int64, date calendar.Date, body map[string]any) (int, string) {
	t.Helper()
	req := testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/%d/pickup-persons/%s", studentID, date), body)
	rr := authExec(t, tc, req, claims, []string{"admin:*"})
	return rr.Code, rr.Body.String()
}

// listedPickupDays reads the pickup persons of two weeks from from in the
// child's pickup data.
func listedPickupDays(t *testing.T, tc *testContext, claims sessiontoken.AppClaims, studentID int64, from calendar.Date) []pickupDayWire {
	t.Helper()
	req := testutil.NewRequest(http.MethodGet, fmt.Sprintf("/%d/pickup-schedules?from=%s&to=%s", studentID, from, from.AddDays(13)), nil)
	rr := authExec(t, tc, req, claims, []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var response struct {
		Data struct {
			PickupPersons []pickupDayWire `json:"pickup_persons"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &response))
	return response.Data.PickupPersons
}

func listedPickupDaysWithWeekendPlan(t *testing.T, tc *testContext, claims sessiontoken.AppClaims, studentID int64, from calendar.Date, followsFriday bool) []pickupDayWire {
	t.Helper()
	req := testutil.NewRequest(http.MethodGet, fmt.Sprintf("/%d/pickup-schedules?from=%s&to=%s", studentID, from, from.AddDays(13)), nil)
	req = req.WithContext(calendar.WithWeekendPlan(req.Context(), func(context.Context) (bool, error) { return followsFriday, nil }))
	rr := authExec(t, tc, req, claims, []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var response struct {
		Data struct {
			PickupPersons []pickupDayWire `json:"pickup_persons"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &response))
	return response.Data.PickupPersons
}
