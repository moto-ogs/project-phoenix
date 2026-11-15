package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// Fixed Berlin days of the daily attendance tests (#4717): a Friday, the
// Saturday after it and the Monday after that, long before any test runs.
var (
	dailyFriday   = calendar.NewDate(2026, time.September, 11)
	dailySaturday = calendar.NewDate(2026, time.September, 12)
	dailyMonday   = calendar.NewDate(2026, time.September, 14)
	dailyPeriod   = fmt.Sprintf("from=%s&to=%s", dailyFriday, dailyMonday)
)

// mvSchool creates a school of the organization in Mecklenburg-Vorpommern.
func mvSchool(t *testing.T, db *bun.DB, organization int64, name string) arrivalSchool {
	t.Helper()
	school := testpkg.CreateTestSchoolInOrganization(t, db, organization, name)
	testpkg.SetTestTenantSetting(t, db, school, configModels.KeyFederalState, `"DE-MV"`)
	return newArrivalSchool(t, db, school)
}

func dailyLogged(t *testing.T, db *bun.DB, resourceType string, school, account int64) int {
	t.Helper()
	var count int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM audit.data_access_log
		WHERE tenant_id = ? AND actor_account_id = ? AND resource_type = ? AND actor_role = 'traeger'`,
		school, account, resourceType).Scan(context.Background(), &count))
	return count
}

func dailyExportLogged(t *testing.T, db *bun.DB, school, account int64) int {
	t.Helper()
	return dailyLogged(t, db, traegerview.ResourceTypeTraegerDailyAttendanceExport, school, account)
}

func TestTraegerDailyAttendanceReportsTheSchoolsInMecklenburgVorpommernOnly(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Tagesmeldung", true)
	hafen := mvSchool(t, db, organization, "Hort am Hafen")
	// A school of the same Träger in Nordrhein-Westfalen (the default) stays out.
	nrwID := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Rheinblick")
	nrw := newArrivalSchool(t, db, nrwID)
	nrw.stay(nrw.child("Nina"), dailyFriday, wallClock(dailyFriday, 8, 0), at(dailyFriday, 15, 0))
	// A school in Mecklenburg-Vorpommern of another Träger stays out too.
	foreign := mvSchool(t, db, traegerOrganization(t, db, "Träger Fremd Tagesmeldung", true), "Hort Fremd")
	foreign.stay(foreign.child("Fritz"), dailyFriday, wallClock(dailyFriday, 7, 30), at(dailyFriday, 14, 0))

	anna, ben, clara, dana := hafen.child("Anna"), hafen.child("Ben"), hafen.child("Clara"), hafen.child("Dana")
	// Anna leaves for lunch and comes back: one stay from 07:40 to 15:10.
	hafen.stay(anna, dailyFriday, wallClock(dailyFriday, 7, 40), at(dailyFriday, 12, 0))
	hafen.stay(anna, dailyFriday, wallClock(dailyFriday, 13, 0), at(dailyFriday, 15, 10))
	// Ben was never checked out, Clara closed by the nightly cleanup: no pickup.
	hafen.stay(ben, dailyFriday, wallClock(dailyFriday, 11, 50), nil)
	forgotten := dailyFriday.EndOfDay()
	hafen.stay(clara, dailyFriday, wallClock(dailyFriday, 12, 5), &forgotten)
	hafen.stay(anna, dailySaturday, wallClock(dailySaturday, 9, 0), at(dailySaturday, 11, 0))
	testpkg.CreateTestStudentStatusDayForTenant(t, db, hafen.school, dana, dailyFriday, "sick")
	// Anna was sick on paper but came: place before status.
	testpkg.CreateTestStudentStatusDayForTenant(t, db, hafen.school, anna, dailyFriday, "sick")
	testpkg.CreateTestStudentStatusDayForTenant(t, db, hafen.school, ben, dailyMonday, "excused")

	office := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, office.ID, identityaccess.TraegerRoleReadOnly)
	code, answer := traegerSignIn(t, router, office.Email, password, 0)
	require.Equal(t, http.StatusOK, code)

	rec := traegerOccupancyRequest(t, router, "/traeger/schools/daily-attendance?"+dailyPeriod, answer.AccessToken, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	for _, hidden := range []string{"Anna", "Rheinblick", "Hort Fremd"} {
		assert.NotContains(t, rec.Body.String(), hidden)
	}
	got := decodeSchoolPortalData[traegerview.DailyAttendance](t, rec.Body.Bytes())
	assert.Equal(t, 1, got.OtherSchools, "the school in Nordrhein-Westfalen is counted, not shown")
	require.Len(t, got.Schools, 1)
	school := got.Schools[0]
	require.Len(t, school.Days, 3, "Friday, the Saturday with a child and Monday")
	friday := school.Days[0]
	assert.Equal(t, 3, friday.Present)
	assert.Equal(t, 1, friday.Sick, "Dana only; Anna was present")
	assert.Equal(t, 2, friday.WithoutPickup, "open and closed by the cleanup")
	require.NotNil(t, friday.AverageMinutes)
	assert.Equal(t, 450, *friday.AverageMinutes, "07:40 to 15:10")
	assert.True(t, friday.LastPickup.Equal(wallClock(dailyFriday, 15, 10)), "the cleanup's 23:59:59 is no pickup")
	assert.Equal(t, dailySaturday, school.Days[1].Date)
	assert.Equal(t, 1, school.Days[2].Excused)
	assert.Equal(t, 2, school.Summary.DaysWithChildren)
	assert.Equal(t, 1, dailyLogged(t, db, traegerview.ResourceTypeTraegerDailyAttendance, hafen.school, office.ID),
		"a day with one child shows that child's times, so the read stands in the access log")
	assert.Zero(t, dailyLogged(t, db, traegerview.ResourceTypeTraegerDailyAttendance, nrwID, office.ID), "the school outside the report read nothing")

	export := traegerOccupancyRequest(t, router, "/traeger/schools/daily-attendance/export?"+dailyPeriod, answer.AccessToken, nil)
	require.Equal(t, http.StatusOK, export.Code, export.Body.String())
	assert.Equal(t, "text/csv; charset=utf-8", export.Header().Get("Content-Type"))
	assert.Contains(t, export.Header().Get("Content-Disposition"), "tagesmeldung-mv-2026-09-11-bis-2026-09-14.csv")
	csv := strings.TrimPrefix(export.Body.String(), "\xEF\xBB\xBF")
	for _, line := range []string{
		"Einrichtung;Ort;Datum;Lfd. Nr.;Status;Ankunft;Abholung;Anwesenheit in Minuten",
		"Hort am Hafen;;11.09.2026;1;anwesend;07:40;15:10;450",
		"Hort am Hafen;;11.09.2026;2;anwesend;11:50;;",
		"Hort am Hafen;;11.09.2026;4;krank;;;",
		"Hort am Hafen;;12.09.2026;1;anwesend;09:00;11:00;120",
		"Hort am Hafen;;14.09.2026;1;entschuldigt;;;",
	} {
		assert.Contains(t, csv, line+"\n")
	}
	assert.Equal(t, 7, strings.Count(csv, "\n"), "a header and six child-days")
	for _, hidden := range []string{"Anna", "Dana", "Rheinblick", "Fremd"} {
		assert.NotContains(t, csv, hidden, "no name of a child, no other school")
	}
	assert.Equal(t, 1, dailyExportLogged(t, db, hafen.school, office.ID), "the export stands in the school's access log")
	assert.Zero(t, dailyExportLogged(t, db, nrwID, office.ID), "the school outside the report read nothing")

	frame := traegerOccupancyRequest(t, router, "/traeger/organization/", answer.AccessToken, nil)
	require.Equal(t, http.StatusOK, frame.Code, frame.Body.String())
	assert.Contains(t, frame.Body.String(), `"federal_states":["DE-MV","DE-NW"]`, "the frame offers the report where it applies")
}

func TestTraegerDailyAttendanceNeedsTheReportsRightAndAPeriod(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Tagesmeldung Ohne Recht", true)
	school := mvSchool(t, db, organization, "Hort Ohne Recht")
	signIn := func(roles ...string) (int64, string) {
		account := traegerAccount(t, db, password)
		testpkg.CreateTestTraegerMember(t, db, organization, account.ID, roles...)
		code, answer := traegerSignIn(t, router, account.Email, password, 0)
		require.Equal(t, http.StatusOK, code)
		return account.ID, answer.AccessToken
	}

	// Leitung reads the dashboard but no reports.
	for _, roles := range [][]string{nil, {identityaccess.TraegerRoleLeadership}} {
		account, token := signIn(roles...)
		for _, path := range []string{"/traeger/schools/daily-attendance?" + dailyPeriod, "/traeger/schools/daily-attendance/export?" + dailyPeriod} {
			rec := traegerOccupancyRequest(t, router, path, token, nil)
			assert.Equal(t, http.StatusForbidden, rec.Code, path+": "+rec.Body.String())
			assert.NotContains(t, rec.Body.String(), "Hort Ohne Recht")
		}
		assert.Zero(t, dailyExportLogged(t, db, school.school, account), "a refused export reads nothing")
		assert.Zero(t, dailyLogged(t, db, traegerview.ResourceTypeTraegerDailyAttendance, school.school, account), "a refused read reads nothing")
	}

	_, reader := signIn(identityaccess.TraegerRoleReadOnly)
	for _, query := range []string{"", "from=2026-09-14&to=2026-09-11", "from=2026-08-01&to=2026-09-11", "from=gestern&to=2026-09-11"} {
		for _, path := range []string{"/traeger/schools/daily-attendance?", "/traeger/schools/daily-attendance/export?"} {
			rec := traegerOccupancyRequest(t, router, path+query, reader, nil)
			assert.Equal(t, http.StatusBadRequest, rec.Code, path+query+": "+rec.Body.String())
		}
	}
}

func TestTraegerDailyAttendanceQueryBudgetIsFlat(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Tagesmeldung Budget", true)
	addSchool := func(name string) {
		school := mvSchool(t, db, organization, name)
		child := school.child("Kind")
		school.stay(child, dailyFriday, wallClock(dailyFriday, 8, 0), at(dailyFriday, 15, 0))
		testpkg.CreateTestStudentStatusDayForTenant(t, db, school.school, child, dailyMonday, "sick")
	}
	for _, name := range []string{"Hort Eins", "Hort Zwei", "Hort Drei"} {
		addSchool(name)
	}
	account := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, account.ID, identityaccess.TraegerRoleReadOnly)
	code, answer := traegerSignIn(t, router, account.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	// The reads are flat; the access log adds one tenant unit per school
	// with children (ADR 0084 section 7), counted apart.
	read := func() (testpkg.QueryMeasurement, int) {
		counter := testpkg.CaptureQueriesForContext(t, db)
		rec := traegerOccupancyRequest(t, router, "/traeger/schools/daily-attendance?"+dailyPeriod, answer.AccessToken, counter)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		reads := counter.Measurement(counter.Matching(func(sql string) bool {
			return (strings.HasPrefix(sql, "select") || strings.HasPrefix(sql, "with")) && !strings.Contains(sql, "set_config")
		}))
		logged := len(counter.Matching(func(sql string) bool {
			return strings.HasPrefix(sql, "insert") && strings.Contains(sql, "data_access_log")
		}))
		return reads, logged
	}
	three, loggedThree := read()
	for _, name := range []string{"Hort Vier", "Hort Fünf"} {
		addSchool(name)
	}
	five, loggedFive := read()
	assert.Len(t, five.Statements, len(three.Statements), "the report reads the same statements for any number of schools")
	assert.Equal(t, 3, loggedThree, "one access log entry per school with children")
	assert.Equal(t, 5, loggedFive)
	querybudgets.AssertQueryBudget(t, "api.traeger.schools_daily_attendance", three)
}
