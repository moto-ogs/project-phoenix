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
)

// The preview on tomorrow of "Heute anders" in the Träger-Portal (#8236):
// today is the day before dayChangesDay, and ?date= reads dayChangesDay as
// tomorrow with the same rules as today. Only the Träger's own schools, no
// school of another Träger, no person and no reason; without "Übersicht
// sehen" nothing; a day other than today and tomorrow is refused.
func TestTraegerDayChangesTomorrowShowsOnlyTheTraegerSchools(t *testing.T) {
	t.Parallel()
	today := dayChangesDay.AddDays(-1)
	now := today.BerlinMidnight().Add(10 * time.Hour)
	db, router, _, _ := newTraegerPortalAt(t, func() calendar.Date { return today }, func() time.Time { return now })
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Vorschau morgen", true)
	tomorrowClosed := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Morgen zu")
	todayClosed := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Heute zu")
	foreignOrganization := traegerOrganization(t, db, "Träger Fremd Vorschau", true)
	foreign := testpkg.CreateTestSchoolInOrganization(t, db, foreignOrganization, "OGS Fremd morgen")

	insertSchoolClosingDay(t, db, tomorrowClosed, dayChangesDay, dayChangesDay, "Studientag")
	insertDayBlock(t, db, tomorrowClosed, dayChangesDay, testpkg.ScheduleInstanceStatusCancelled, "AG Schach bei Herrn Muster")
	insertMealCancellation(t, db, tomorrowClosed, dayChangesDay, "Küche krank")
	insertSchoolClosingDay(t, db, todayClosed, today, today, "Heute zu")
	insertSchoolClosingDay(t, db, foreign, dayChangesDay, dayChangesDay, "Fremder Schließtag")

	office := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, office.ID, identityaccess.TraegerRoleAdministration)
	code, answer := traegerSignIn(t, router, office.Email, password, 0)
	require.Equal(t, http.StatusOK, code)

	read := func(token, query string) (int, string, traegerview.SchoolsDayChanges) {
		rec := traegerOccupancyRequest(t, router, "/traeger/schools/day-changes"+query, token, nil)
		if rec.Code != http.StatusOK {
			return rec.Code, rec.Body.String(), traegerview.SchoolsDayChanges{}
		}
		return rec.Code, rec.Body.String(), decodeSchoolPortalData[traegerview.SchoolsDayChanges](t, rec.Body.Bytes())
	}

	status, body, got := read(answer.AccessToken, "?date="+dayChangesDay.String())
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, dayChangesDay, got.Day, "the preview reads tomorrow")
	require.Len(t, got.Schools, 1, "only the own school with a change tomorrow: "+body)
	row := traegerDayChangesOf(t, got, tomorrowClosed)
	assert.Equal(t, []traegerview.SchoolDayClosing{{Name: "Studientag"}}, row.ClosingDays)
	assert.Equal(t, 1, row.CancelledBlocks)
	assert.True(t, row.MealCancelled)
	for _, absent := range []string{"OGS Heute zu", "Fremd", "Muster", "Schach", "Küche"} {
		assert.NotContains(t, body, absent, "no school of today only, no other Träger, no block, person or reason")
	}

	// Without date and with today's date the card stays on today.
	for _, query := range []string{"", "?date=" + today.String()} {
		status, body, got = read(answer.AccessToken, query)
		require.Equal(t, http.StatusOK, status, body)
		assert.Equal(t, today, got.Day, query)
		require.Len(t, got.Schools, 1, query+": "+body)
		assert.Equal(t, "OGS Heute zu", got.Schools[0].Name, query)
	}

	// Another day than today and tomorrow, or a malformed date, is refused.
	for _, date := range []string{today.AddDays(-1).String(), dayChangesDay.AddDays(1).String(), "morgen"} {
		status, body, _ = read(answer.AccessToken, "?date="+date)
		assert.Equal(t, http.StatusBadRequest, status, date+": "+body)
		assert.Contains(t, body, "general.input", date)
		assert.NotContains(t, body, "OGS Morgen zu", date)
	}

	// Without "Übersicht sehen" nothing is read for tomorrow either.
	withoutRole := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, withoutRole.ID)
	_, bare := traegerSignIn(t, router, withoutRole.Email, password, 0)
	status, body, _ = read(bare.AccessToken, "?date="+dayChangesDay.String())
	assert.Equal(t, http.StatusForbidden, status, body)
	assert.NotContains(t, body, "OGS Morgen zu")

	// The other Träger sees its own school only, tomorrow too.
	foreignOffice := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, foreignOrganization, foreignOffice.ID, identityaccess.TraegerRoleAdministration)
	_, foreignAnswer := traegerSignIn(t, router, foreignOffice.Email, password, 0)
	status, body, got = read(foreignAnswer.AccessToken, "?date="+dayChangesDay.String())
	require.Equal(t, http.StatusOK, status, body)
	require.Len(t, got.Schools, 1, body)
	assert.Equal(t, "OGS Fremd morgen", got.Schools[0].Name)
	assert.NotContains(t, body, "OGS Morgen zu")
}
