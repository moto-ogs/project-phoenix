package daychangesviewhttp_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestSchoolDayChangesAppointmentSource is Seam 1 of the Termine source of
// moto schule (#8155): the rule of the school calendar, calendar:school
// and a staff record, not calendar:own. One school with an organizing
// Lehrkraft, an invited one, an uninvolved one and a second school; the
// appointments are written through Appointments' own commands and read
// through the route of moto schule.
func TestSchoolDayChangesAppointmentSource(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	writes, err := api.NewDayChangesTestCalendar(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	ctx := testpkg.Ctx(t)
	organizer, organizerAccount := testpkg.CreateTestStaffWithAccount(t, db, "Olga", "Lehrkraft")
	invited, invitedAccount := testpkg.CreateTestStaffWithAccount(t, db, "Anna", "Eingeladen")
	_, outsiderAccount := testpkg.CreateTestStaffWithAccount(t, db, "Ben", "Unbeteiligt")

	create := func(value api.DayChangesTestAppointment) int64 {
		t.Helper()
		value.Organizer = organizer.ID
		id, err := writes.Create(ctx, value)
		require.NoError(t, err)
		return id
	}
	week := day.AddDays(-7)
	conference := create(api.DayChangesTestAppointment{Title: "Konferenz", Location: "Lehrerzimmer", Day: week, StartHour: 8, EndHour: 9, Weekly: true, Invited: []int64{invited.ID}})
	require.NoError(t, writes.Except(ctx, conference, day, api.DayChangesTestException{Cancel: true}))
	evening := create(api.DayChangesTestAppointment{Title: "Elternabend 3a", Location: "Aula", Day: week, StartHour: 18, EndHour: 19, Weekly: true})
	require.NoError(t, writes.Except(ctx, evening, day, api.DayChangesTestException{Location: "Raum 12"}))
	tomorrow := create(api.DayChangesTestAppointment{Title: "Ausflugsplanung", Location: "Büro", Day: week, StartHour: 10, EndHour: 11, Weekly: true})
	require.NoError(t, writes.Except(ctx, tomorrow, day.AddDays(1), api.DayChangesTestException{Cancel: true}))

	t.Run("other school", func(t *testing.T) {
		foreignSchool := testpkg.OwnTenant(t)
		foreign, _ := testpkg.CreateTestStaffWithAccount(t, db, "Xaver", "Fremd")
		foreignCtx := writes.InSchool(ctx, foreignSchool)
		id, err := writes.Create(foreignCtx, api.DayChangesTestAppointment{Organizer: foreign.ID, Invited: []int64{organizer.ID}, Title: "Fremdtermin", Day: day, StartHour: 9, EndHour: 10})
		require.NoError(t, err)
		require.NoError(t, writes.Except(foreignCtx, id, day, api.DayChangesTestException{Whole: true}))
	})

	router := newSchoolRouter(t, db, day)

	t.Run("the organizer sees today's exceptions under Betrifft dich", func(t *testing.T) {
		overview, body := readSchool(t, router, organizerAccount.ID, tenantID, "class_day:read", "calendar:school")
		assert.Equal(t, "loaded", sourceStatus(overview, "appointments"))
		assert.ElementsMatch(t, []string{
			"you appointment_cancelled Konferenz @Lehrerzimmer 08:00-09:00 ->school_calendar",
			"you appointment_changed Elternabend 3a @Raum 12 ort 18:00-19:00 ->school_calendar",
		}, appointmentLines(t, body))
		assert.NotContains(t, body, "Ausflugsplanung", "a date cancelled tomorrow is not today's")
		assert.NotContains(t, body, "Fremdtermin", "another school stays out")
		assert.NotContains(t, body, "Olga", "no person's name")
	})

	t.Run("an invited Lehrkraft sees her invitation only", func(t *testing.T) {
		_, body := readSchool(t, router, invitedAccount.ID, tenantID, "class_day:read", "calendar:school")
		assert.Equal(t, []string{"you appointment_cancelled Konferenz @Lehrerzimmer 08:00-09:00 ->school_calendar"}, appointmentLines(t, body))
	})

	t.Run("an uninvolved Lehrkraft sees none", func(t *testing.T) {
		overview, body := readSchool(t, router, outsiderAccount.ID, tenantID, "class_day:read", "calendar:school")
		assert.Empty(t, appointmentLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "appointments"))
	})

	t.Run("calendar:own is not the rule of moto schule: nothing and no failure", func(t *testing.T) {
		overview, body := readSchool(t, router, organizerAccount.ID, tenantID, "class_day:read", "calendar:own")
		assert.Empty(t, appointmentLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "appointments"))
	})

	t.Run("the next day shows its own exceptions", func(t *testing.T) {
		_, body := readSchool(t, newSchoolRouter(t, db, day.AddDays(1)), organizerAccount.ID, tenantID, "class_day:read", "calendar:school")
		assert.Equal(t, []string{"you appointment_cancelled Ausflugsplanung @Büro 10:00-11:00 ->school_calendar"}, appointmentLines(t, body))
	})

	t.Run("without class_day:read the route refuses", func(t *testing.T) {
		rec := getSchool(t, router, testutil.MintTestJWT(t, testpkg.SchoolTestClaims(int(organizerAccount.ID), tenantID, "calendar:school")))
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		assert.NotContains(t, rec.Body.String(), "Konferenz")
	})
}
