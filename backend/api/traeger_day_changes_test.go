package api

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// traegerTestTimetable is the Timetable owner whose cancelled blocks "Heute
// anders" of the Träger-Portal counts (#7672), composed as the serving root
// composes it.
func traegerTestTimetable(t *testing.T, database testpkg.Database, membership schoolmembership.Capability, now func() time.Time) timetable.Owner {
	t.Helper()
	rooms, err := owners.BuildServeRooms(database)
	require.NoError(t, err)
	owner, err := owners.BuildServeTimetable(database, owners.MustNewPeopleDirectory(database), rooms, membership, now)
	require.NoError(t, err)
	return owner
}

// dayChangesDay is the fixed Berlin day the tests read "Heute anders" on, a
// Wednesday.
var dayChangesDay = calendar.NewDate(2030, time.July, 10)

// insertSchoolClosingDay enters a closing day of the school itself.
func insertSchoolClosingDay(t *testing.T, db *bun.DB, school int64, from, to calendar.Date, reason string) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO schedule.closing_days (tenant_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)`,
		school, from, to, reason)
	require.NoError(t, err)
}

// insertDayBlock plans a block of school on day in the given status.
func insertDayBlock(t *testing.T, db *bun.DB, school int64, day calendar.Date, status, title string) {
	t.Helper()
	room := testpkg.CreateTestRoomForTenant(t, db, school, fmt.Sprintf("Raum %d", testpkg.UniqueTestTenantID(t)))
	testpkg.CreateTestActivityInstanceForTenant(t, db, school, day, room.ID, testpkg.ActivityInstanceOpts{Title: title, Status: status})
}

// insertOpeningChange changes the opening hours of school on from..to.
func insertOpeningChange(t *testing.T, db *bun.DB, school int64, from, to calendar.Date, opens, closes, reason string) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO schedule.opening_changes (tenant_id, start_date, end_date, opens_at, closes_at, reason) VALUES (?, ?, ?, ?::time, ?::time, ?)`,
		school, from, to, opens, closes, reason)
	require.NoError(t, err)
}

// insertMealCancellation cancels lunch of school on day.
func insertMealCancellation(t *testing.T, db *bun.DB, school int64, day calendar.Date, reason string) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO schedule.meal_cancellations (tenant_id, date, reason) VALUES (?, ?, ?)`, school, day, reason)
	require.NoError(t, err)
}

// insertRoomClosure closes a new room of school from..to.
func insertRoomClosure(t *testing.T, db *bun.DB, school int64, from, to calendar.Date, room, reason string) {
	t.Helper()
	created := testpkg.CreateTestRoomForTenant(t, db, school, room)
	_, err := db.ExecContext(context.Background(), `INSERT INTO facilities.room_closures (tenant_id, room_id, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)`,
		school, created.ID, from, to, reason)
	require.NoError(t, err)
}

func traegerDayChangesOf(t *testing.T, got traegerview.SchoolsDayChanges, school int64) traegerview.SchoolDayChanges {
	t.Helper()
	for _, row := range got.Schools {
		if row.ID == ident.ID(school) {
			return row
		}
	}
	t.Fatalf("school %d is missing from Heute anders", school)
	return traegerview.SchoolDayChanges{}
}

// "Heute anders" of the Träger-Portal (#7672) in one setup: each kind of
// change, the schools without a change missing, a school of another Träger
// never shown, no person and no reason in the answer, the right "Übersicht
// sehen" required, and a flat statement count.
func TestTraegerDayChangesShowTheChangesOfTodayOfTheTraegerSchools(t *testing.T) {
	t.Parallel()
	now := dayChangesDay.BerlinMidnight().Add(10 * time.Hour)
	db, router, _, _ := newTraegerPortalAt(t, func() calendar.Date { return dayChangesDay }, func() time.Time { return now })
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Heute anders", true)
	closed := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Am Bach")
	traegerClosed := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Lindenweg")
	cancelled := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Mühlenteich")
	quiet := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Ruhig")
	foreignOrganization := traegerOrganization(t, db, "Träger Fremd Heute anders", true)
	foreign := testpkg.CreateTestSchoolInOrganization(t, db, foreignOrganization, "OGS Fremd Heute anders")

	insertSchoolClosingDay(t, db, closed, dayChangesDay, dayChangesDay, "Studientag")
	insertDayBlock(t, db, cancelled, dayChangesDay, testpkg.ScheduleInstanceStatusCancelled, "AG Fußball bei Frau Muster")
	insertDayBlock(t, db, cancelled, dayChangesDay, testpkg.ScheduleInstanceStatusCancelled, "Hausaufgaben")
	insertDayBlock(t, db, cancelled, dayChangesDay, testpkg.ScheduleInstanceStatusPlanned, "Basteln")
	// Yesterday's changes and a planned block are no change today.
	insertSchoolClosingDay(t, db, quiet, dayChangesDay.AddDays(-1), dayChangesDay.AddDays(-1), "Gestern zu")
	insertDayBlock(t, db, quiet, dayChangesDay.AddDays(-1), testpkg.ScheduleInstanceStatusCancelled, "Gestern abgesagt")
	insertDayBlock(t, db, quiet, dayChangesDay, testpkg.ScheduleInstanceStatusPlanned, "Lesen")
	// A school of another Träger with changes of its own.
	insertSchoolClosingDay(t, db, foreign, dayChangesDay, dayChangesDay, "Fremder Schließtag")
	insertDayBlock(t, db, foreign, dayChangesDay, testpkg.ScheduleInstanceStatusCancelled, "Fremde AG")

	office := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, office.ID, identityaccess.TraegerRoleAdministration)
	code, answer := traegerSignIn(t, router, office.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	// The Träger closes Lindenweg for three days through its own route.
	saved := traegerJSON(t, router, answer.AccessToken, http.MethodPost, "/traeger/closing-days/", traegerClosingDaySaveBody{
		StartDate: dayChangesDay.AddDays(-1).String(), EndDate: dayChangesDay.AddDays(1).String(), Reason: "Betriebsausflug", SchoolIDs: []wireID{wireID(traegerClosed)},
	})
	require.Equal(t, http.StatusCreated, saved.Code, saved.Body.String())
	foreignOffice := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, foreignOrganization, foreignOffice.ID, identityaccess.TraegerRoleAdministration)
	_, foreignAnswer := traegerSignIn(t, router, foreignOffice.Email, password, 0)
	saved = traegerJSON(t, router, foreignAnswer.AccessToken, http.MethodPost, "/traeger/closing-days/", traegerClosingDaySaveBody{
		StartDate: dayChangesDay.String(), EndDate: dayChangesDay.String(), Reason: "Fremder Ausflug", SchoolIDs: []wireID{wireID(foreign)},
	})
	require.Equal(t, http.StatusCreated, saved.Code, saved.Body.String())

	read := func(token string, counter *testpkg.QueryCounter) (int, string, traegerview.SchoolsDayChanges) {
		rec := traegerOccupancyRequest(t, router, "/traeger/schools/day-changes", token, counter)
		if rec.Code != http.StatusOK {
			return rec.Code, rec.Body.String(), traegerview.SchoolsDayChanges{}
		}
		return rec.Code, rec.Body.String(), decodeSchoolPortalData[traegerview.SchoolsDayChanges](t, rec.Body.Bytes())
	}
	status, body, got := read(answer.AccessToken, nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, dayChangesDay, got.Day, "the Berlin day of the read")
	require.Len(t, got.Schools, 3, "only schools with a change: "+body)
	assert.Equal(t, []string{"OGS Am Bach", "OGS Lindenweg", "OGS Mühlenteich"}, []string{got.Schools[0].Name, got.Schools[1].Name, got.Schools[2].Name}, "ordered by name")
	for _, absent := range []string{"OGS Ruhig", "Gestern", "Fremd", "Muster", "Fußball", "Hausaufgaben"} {
		assert.NotContains(t, body, absent, "no quiet school, no other day, no other Träger and no block, person or reason")
	}

	bach := traegerDayChangesOf(t, got, closed)
	assert.Equal(t, []traegerview.SchoolDayClosing{{Name: "Studientag"}}, bach.ClosingDays, "the school's own closing day, without seit and bis")
	assert.Zero(t, bach.CancelledBlocks)
	linden := traegerDayChangesOf(t, got, traegerClosed)
	since, until := dayChangesDay.AddDays(-1), dayChangesDay.AddDays(1)
	assert.Equal(t, []traegerview.SchoolDayClosing{{Name: "Betriebsausflug", Traeger: true, Since: &since, Until: &until}}, linden.ClosingDays,
		"the Träger's closing day with its span; the foreign Träger's day names another school")
	assert.Equal(t, 2, traegerDayChangesOf(t, got, cancelled).CancelledBlocks, "the two cancelled blocks, not the planned one")

	// Without "Übersicht sehen" nothing is read.
	withoutRole := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, withoutRole.ID)
	_, bare := traegerSignIn(t, router, withoutRole.Email, password, 0)
	status, body, _ = read(bare.AccessToken, nil)
	assert.Equal(t, http.StatusForbidden, status, body)
	assert.NotContains(t, body, "OGS Am Bach")

	// The other Träger sees its own school only.
	status, body, got = read(foreignAnswer.AccessToken, nil)
	require.Equal(t, http.StatusOK, status, body)
	require.Len(t, got.Schools, 1)
	foreignRow := traegerDayChangesOf(t, got, foreign)
	assert.Len(t, foreignRow.ClosingDays, 2, "its school day and its Träger day")
	assert.Equal(t, 1, foreignRow.CancelledBlocks)
	assert.NotContains(t, body, "OGS Am Bach")

	// The statements do not grow with the schools.
	measure := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		status, body, _ := read(answer.AccessToken, counter)
		require.Equal(t, http.StatusOK, status, body)
		return counter.Measurement(counter.Selects(""))
	}
	three := measure()
	for _, name := range []string{"OGS Vier", "OGS Fünf"} {
		school := testpkg.CreateTestSchoolInOrganization(t, db, organization, name)
		insertSchoolClosingDay(t, db, school, dayChangesDay, dayChangesDay, "Studientag")
		insertDayBlock(t, db, school, dayChangesDay, testpkg.ScheduleInstanceStatusCancelled, "AG")
	}
	assert.Len(t, measure().Statements, len(three.Statements), "Heute anders reads the same statements for any number of schools")
	querybudgets.AssertQueryBudget(t, "api.traeger.schools_day_changes", three)
}
