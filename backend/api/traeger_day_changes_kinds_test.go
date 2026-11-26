package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// "Heute anders" of the Träger-Portal shows the changed opening hours, the
// cancelled lunch and the closed rooms of each school (#8146): each kind on
// its own field, without the school's reason and without a room name, a
// school without a change missing, a school of another Träger never shown,
// the right "Übersicht sehen" required, and the same five statements for any
// number of schools.
func TestTraegerDayChangesShowOpeningHoursLunchAndClosedRooms(t *testing.T) {
	t.Parallel()
	now := dayChangesDay.BerlinMidnight().Add(10 * time.Hour)
	db, router, _, _ := newTraegerPortalAt(t, func() calendar.Date { return dayChangesDay }, func() time.Time { return now })
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Arten Heute anders", true)
	shorter := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Kurzer Tag")
	noLunch := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Ohne Essen")
	rooms := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Räume zu")
	quiet := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Ruhig Arten")
	foreignOrganization := traegerOrganization(t, db, "Träger Fremd Arten", true)
	foreign := testpkg.CreateTestSchoolInOrganization(t, db, foreignOrganization, "OGS Fremd Arten")

	yesterday, tomorrow := dayChangesDay.AddDays(-1), dayChangesDay.AddDays(1)
	insertOpeningChange(t, db, shorter, yesterday, tomorrow, "08:00", "12:30", "Frau Muster ist krank")
	insertMealCancellation(t, db, noLunch, dayChangesDay, "Caterer Muster liefert nicht")
	insertRoomClosure(t, db, rooms, dayChangesDay, dayChangesDay, "Turnhalle Muster", "Wasserschaden bei Herrn Muster")
	insertRoomClosure(t, db, rooms, yesterday, tomorrow, "Werkraum Muster", "Umbau")
	// Yesterday's and tomorrow's changes are no change today.
	insertOpeningChange(t, db, quiet, yesterday, yesterday, "09:00", "12:00", "Gestern kurz")
	insertMealCancellation(t, db, quiet, tomorrow, "Morgen kein Essen")
	insertRoomClosure(t, db, quiet, tomorrow, tomorrow, "Morgen zu", "Morgen")
	// A school of another Träger with each kind of its own.
	insertOpeningChange(t, db, foreign, dayChangesDay, dayChangesDay, "10:00", "14:00", "Fremd kurz")
	insertMealCancellation(t, db, foreign, dayChangesDay, "Fremd kein Essen")
	insertRoomClosure(t, db, foreign, dayChangesDay, dayChangesDay, "Fremder Raum", "Fremd zu")

	office := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, office.ID, identityaccess.TraegerRoleAdministration)
	code, answer := traegerSignIn(t, router, office.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	foreignOffice := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, foreignOrganization, foreignOffice.ID, identityaccess.TraegerRoleAdministration)
	code, foreignAnswer := traegerSignIn(t, router, foreignOffice.Email, password, 0)
	require.Equal(t, http.StatusOK, code)

	read := func(token string, counter *testpkg.QueryCounter) (int, string, traegerview.SchoolsDayChanges) {
		rec := traegerOccupancyRequest(t, router, "/traeger/schools/day-changes", token, counter)
		if rec.Code != http.StatusOK {
			return rec.Code, rec.Body.String(), traegerview.SchoolsDayChanges{}
		}
		return rec.Code, rec.Body.String(), decodeSchoolPortalData[traegerview.SchoolsDayChanges](t, rec.Body.Bytes())
	}
	status, body, got := read(answer.AccessToken, nil)
	require.Equal(t, http.StatusOK, status, body)
	require.Len(t, got.Schools, 3, "only schools with a change: "+body)
	assert.Equal(t, []string{"OGS Kurzer Tag", "OGS Ohne Essen", "OGS Räume zu"}, []string{got.Schools[0].Name, got.Schools[1].Name, got.Schools[2].Name}, "ordered by name")
	for _, absent := range []string{"Ruhig", "Gestern", "Morgen", "Fremd", "Muster", "Caterer", "Wasserschaden", "Umbau", "Turnhalle", "Werkraum"} {
		assert.NotContains(t, body, absent, "no quiet school, no other day, no other Träger, no reason and no room name")
	}

	short := traegerDayChangesOf(t, got, shorter)
	assert.Equal(t, []traegerview.SchoolDayOpening{{OpensAt: "08:00", ClosesAt: "12:30", Since: &yesterday, Until: &tomorrow}}, short.OpeningChanges,
		"the changed hours with their span")
	assert.False(t, short.MealCancelled)
	assert.Zero(t, short.ClosedRooms)
	assert.Empty(t, short.ClosingDays)
	lunch := traegerDayChangesOf(t, got, noLunch)
	assert.True(t, lunch.MealCancelled)
	assert.Empty(t, lunch.OpeningChanges)
	assert.Equal(t, 2, traegerDayChangesOf(t, got, rooms).ClosedRooms, "the room closed today and the one closed for three days")

	// Without "Übersicht sehen" nothing is read.
	withoutRole := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, withoutRole.ID)
	_, bare := traegerSignIn(t, router, withoutRole.Email, password, 0)
	status, body, _ = read(bare.AccessToken, nil)
	assert.Equal(t, http.StatusForbidden, status, body)
	assert.NotContains(t, body, "OGS Kurzer Tag")

	// The other Träger sees its own school only, with each kind.
	status, body, got = read(foreignAnswer.AccessToken, nil)
	require.Equal(t, http.StatusOK, status, body)
	require.Len(t, got.Schools, 1)
	foreignRow := traegerDayChangesOf(t, got, foreign)
	assert.Equal(t, []traegerview.SchoolDayOpening{{OpensAt: "10:00", ClosesAt: "14:00"}}, foreignRow.OpeningChanges)
	assert.True(t, foreignRow.MealCancelled)
	assert.Equal(t, 1, foreignRow.ClosedRooms)
	for _, absent := range []string{"OGS Kurzer Tag", "OGS Ohne Essen", "OGS Räume zu", "Fremd kurz", "Fremder Raum"} {
		assert.NotContains(t, body, absent)
	}

	// The statements do not grow with the schools.
	measure := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		status, body, _ := read(answer.AccessToken, counter)
		require.Equal(t, http.StatusOK, status, body)
		return counter.Measurement(counter.Selects(""))
	}
	three := measure()
	for _, name := range []string{"OGS Arten Vier", "OGS Arten Fünf"} {
		school := testpkg.CreateTestSchoolInOrganization(t, db, organization, name)
		insertOpeningChange(t, db, school, dayChangesDay, dayChangesDay, "08:00", "12:00", "Kurz")
		insertMealCancellation(t, db, school, dayChangesDay, "Kein Essen")
		insertRoomClosure(t, db, school, dayChangesDay, dayChangesDay, name+" Raum", "Zu")
	}
	assert.Len(t, measure().Statements, len(three.Statements), "Heute anders reads the same statements for any number of schools")
	querybudgets.AssertQueryBudget(t, "api.traeger.schools_day_changes", three)
}
