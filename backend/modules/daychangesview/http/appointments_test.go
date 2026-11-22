package daychangesviewhttp_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// appointmentLines renders the appointment entries as "section kind title
// @location [ort] [zeit] [HH:MM-HH:MM] ->link".
func appointmentLines(t *testing.T, body string) []string {
	t.Helper()
	var envelope struct {
		Data struct {
			Entries []struct {
				Kind        string  `json:"kind"`
				Section     string  `json:"section"`
				AllDay      bool    `json:"all_day"`
				StartsAt    *string `json:"starts_at"`
				EndsAt      *string `json:"ends_at"`
				Appointment *struct {
					Title           string  `json:"title"`
					Location        *string `json:"location"`
					LocationChanged bool    `json:"location_changed"`
					TimeChanged     bool    `json:"time_changed"`
				} `json:"appointment"`
				Link *struct {
					Target string `json:"target"`
				} `json:"link"`
			} `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &envelope))
	lines := []string{}
	for _, entry := range envelope.Data.Entries {
		if entry.Appointment == nil {
			continue
		}
		value := entry.Appointment
		line := entry.Section + " " + entry.Kind + " " + value.Title
		if value.Location != nil {
			line += " @" + *value.Location
		}
		if value.LocationChanged {
			line += " ort"
		}
		if value.TimeChanged {
			line += " zeit"
		}
		if entry.StartsAt != nil && entry.EndsAt != nil {
			// The instants are Berlin wall clock (CEST in September).
			line += " " + (*entry.StartsAt)[11:16] + "-" + (*entry.EndsAt)[11:16]
		}
		if entry.Link != nil {
			line += " ->" + entry.Link.Target
		}
		lines = append(lines, line)
	}
	return lines
}

// TestDayChangesAppointmentSource is Seam 1 for the Termine source (#7663):
// one school with an organizer, an invited colleague, an uninvolved
// colleague and a second school; the appointments are written through
// Appointments' own commands and read through the route. The statement
// count of the source does not grow with the appointments.
func TestDayChangesAppointmentSource(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	tenantID := testpkg.Tenant(t)
	writes, err := api.NewDayChangesTestCalendar(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	ctx := testpkg.Ctx(t)

	organizer, organizerAccount := testpkg.CreateTestStaffWithAccount(t, db, "Olga", "Organisiert")
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
	team := create(api.DayChangesTestAppointment{Title: "Teamsitzung", Location: "Büro", Day: week, StartHour: 8, EndHour: 9, Weekly: true, Invited: []int64{invited.ID}})
	require.NoError(t, writes.Except(ctx, team, day, api.DayChangesTestException{Cancel: true}))
	evening := create(api.DayChangesTestAppointment{Title: "Elternabend", Location: "Aula", Day: day, StartHour: 18, EndHour: 20})
	require.NoError(t, writes.Except(ctx, evening, day, api.DayChangesTestException{Whole: true}))
	club := create(api.DayChangesTestAppointment{Title: "AG-Treffen", Location: "Raum 1", Day: week, StartHour: 14, EndHour: 15, Weekly: true})
	require.NoError(t, writes.Except(ctx, club, day, api.DayChangesTestException{Location: "Raum 12", StartHour: 15, EndHour: 16}))
	training := create(api.DayChangesTestAppointment{Title: "Fortbildung", Location: "Online", Day: week, StartHour: 10, EndHour: 11, Weekly: true})
	require.NoError(t, writes.Except(ctx, training, day.AddDays(7), api.DayChangesTestException{Cancel: true}))
	series := create(api.DayChangesTestAppointment{Title: "Sprechstunde", Location: "Raum 3", Day: week, StartHour: 12, EndHour: 13, Weekly: true})
	require.NoError(t, writes.Except(ctx, series, day, api.DayChangesTestException{Whole: true}))
	same := create(api.DayChangesTestAppointment{Title: "Planung", Location: "Büro", Day: week, StartHour: 11, EndHour: 12, Weekly: true})
	require.NoError(t, writes.Except(ctx, same, day, api.DayChangesTestException{Location: "Büro"}))
	// Today's date moves to tomorrow: it does not take place today.
	moved := create(api.DayChangesTestAppointment{Title: "Elternrunde", Location: "Mensa", Day: week, StartHour: 9, EndHour: 10, Weekly: true})
	require.NoError(t, writes.Except(ctx, moved, day, api.DayChangesTestException{MoveTo: day.AddDays(1)}))

	t.Run("other school", func(t *testing.T) {
		foreignSchool := testpkg.OwnTenant(t)
		foreign, _ := testpkg.CreateTestStaffWithAccount(t, db, "Xaver", "Fremd")
		// The second school lives on the same database as the first.
		foreignCtx := writes.InSchool(ctx, foreignSchool)
		id, err := writes.Create(foreignCtx, api.DayChangesTestAppointment{Organizer: foreign.ID, Invited: []int64{organizer.ID}, Title: "Fremdtermin", Day: day, StartHour: 9, EndHour: 10})
		require.NoError(t, err)
		require.NoError(t, writes.Except(foreignCtx, id, day, api.DayChangesTestException{Whole: true}))
	})

	router := newRouter(t, db, day)
	own := []string{
		"you appointment_cancelled Elternabend @Aula 18:00-20:00 ->calendar",
		"you appointment_cancelled Sprechstunde @Raum 3 12:00-13:00 ->calendar",
		"you appointment_cancelled Teamsitzung @Büro 08:00-09:00 ->calendar",
		"you appointment_changed AG-Treffen @Raum 12 ort zeit 15:00-16:00 ->calendar",
		"you appointment_cancelled Elternrunde @Mensa 09:00-10:00 ->calendar",
	}

	t.Run("organizer sees today's exceptions of the own appointments", func(t *testing.T) {
		overview, body := read(t, router, organizerAccount.ID, tenantID, "calendar:own")
		assert.Equal(t, "loaded", sourceStatus(overview, "appointments"))
		assert.ElementsMatch(t, own, appointmentLines(t, body))
		assert.NotContains(t, body, "Fortbildung", "a date cancelled next week is not today's")
		assert.NotContains(t, body, "Planung", "an override that repeats the series changes nothing")
		assert.NotContains(t, body, "Fremdtermin", "another school stays out")
	})

	t.Run("an invited colleague sees the invitations only", func(t *testing.T) {
		_, body := read(t, router, invitedAccount.ID, tenantID, "calendar:own")
		assert.Equal(t, []string{"you appointment_cancelled Teamsitzung @Büro 08:00-09:00 ->calendar"}, appointmentLines(t, body))
	})

	t.Run("an uninvolved colleague sees none", func(t *testing.T) {
		overview, body := read(t, router, outsiderAccount.ID, tenantID, "calendar:own", "users:read")
		assert.Empty(t, appointmentLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "appointments"))
	})

	t.Run("without the calendar right nothing and no failure", func(t *testing.T) {
		overview, body := read(t, router, organizerAccount.ID, tenantID, "users:read")
		assert.Empty(t, appointmentLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "appointments"))
	})

	t.Run("the day before and next week show their own days", func(t *testing.T) {
		_, before := read(t, newRouter(t, db, day.AddDays(-1)), organizerAccount.ID, tenantID, "calendar:own")
		assert.Empty(t, appointmentLines(t, before))
		_, next := read(t, newRouter(t, db, day.AddDays(7)), organizerAccount.ID, tenantID, "calendar:own")
		assert.ElementsMatch(t, []string{
			"you appointment_cancelled Fortbildung @Online 10:00-11:00 ->calendar",
			"you appointment_cancelled Sprechstunde @Raum 3 12:00-13:00 ->calendar",
		}, appointmentLines(t, next))
	})

	t.Run("the statements do not grow with the appointments", func(t *testing.T) {
		counter := testpkg.CaptureQueries(t, db)
		read(t, router, organizerAccount.ID, tenantID, "calendar:own")
		before := len(counter.Queries())
		more := create(api.DayChangesTestAppointment{Title: "Noch ein Termin", Day: week, StartHour: 16, EndHour: 17, Weekly: true})
		require.NoError(t, writes.Except(ctx, more, day, api.DayChangesTestException{Cancel: true}))
		counter.Reset()
		_, body := read(t, router, organizerAccount.ID, tenantID, "calendar:own")
		assert.Len(t, appointmentLines(t, body), len(own)+1)
		statements := counter.Queries()
		assert.Len(t, statements, before)
		querybudgets.AssertQueryBudget(t, "api.day_changes.today_appointments", counter.Measurement(statements))
	})
}
