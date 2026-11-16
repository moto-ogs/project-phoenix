package api

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// Fixed Berlin days of the heatmap tests (#4714): two Mondays and the
// Tuesday between them, long before any test runs.
var (
	arrivalMonday     = calendar.NewDate(2026, time.September, 7)
	arrivalTuesday    = calendar.NewDate(2026, time.September, 8)
	arrivalNextMonday = calendar.NewDate(2026, time.September, 14)
	arrivalPeriod     = fmt.Sprintf("from=%s&to=%s", arrivalMonday, arrivalNextMonday)
)

// wallClock is the instant of a Berlin wall-clock time on day.
func wallClock(day calendar.Date, hour, minute int) time.Time {
	return day.BerlinMidnight().Add(time.Duration(hour)*time.Hour + time.Duration(minute)*time.Minute)
}

// arrivalSchool records stays of the children of one school.
type arrivalSchool struct {
	t      *testing.T
	db     *bun.DB
	school int64
	staff  int64
	device int64
}

func newArrivalSchool(t *testing.T, db *bun.DB, school int64) arrivalSchool {
	t.Helper()
	staff := testpkg.CreateTestStaffForTenant(t, db, school, "Bea", "Betreuung")
	device := testpkg.CreateTestDeviceForTenant(t, db, school, fmt.Sprintf("arrival-%d", school))
	return arrivalSchool{t: t, db: db, school: school, staff: staff.ID, device: device.ID}
}

func (s arrivalSchool) child(name string) int64 {
	s.t.Helper()
	return testpkg.CreateTestStudentForTenant(s.t, s.db, s.school, name, "Kind", "1a").ID
}

// stay records a stay from in to out on day; a nil out leaves it open.
func (s arrivalSchool) stay(student int64, day calendar.Date, in time.Time, out *time.Time) {
	s.t.Helper()
	testpkg.CreateTestAttendanceForTenant(s.t, s.db, s.school, student, s.staff, s.device, day, in, out)
}

func at(day calendar.Date, hour, minute int) *time.Time {
	instant := wallClock(day, hour, minute)
	return &instant
}

func arrivalCell(t *testing.T, row traegerview.ArrivalPickupWeekday, hour, minute int) traegerview.ArrivalPickupCell {
	t.Helper()
	for _, cell := range row.Slots {
		if cell.StartMinute == hour*60+minute {
			return cell
		}
	}
	t.Fatalf("no slot at %02d:%02d", hour, minute)
	return traegerview.ArrivalPickupCell{}
}

func TestTraegerArrivalPickupTimesCountFirstArrivalAndLastPickupPerChildDay(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Ankunft", true)
	bachID := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Am Bach")
	testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Lindenweg")
	foreignID := testpkg.CreateTestSchoolInOrganization(t, db, traegerOrganization(t, db, "Träger Fremd Ankunft", true), "OGS Fremd Ankunft")

	bach := newArrivalSchool(t, db, bachID)
	anna, ben, clara := bach.child("Anna"), bach.child("Ben"), bach.child("Clara")
	// Anna leaves for lunch and comes back: one arrival at 07:40, one pickup at 15:10.
	bach.stay(anna, arrivalMonday, wallClock(arrivalMonday, 7, 40), at(arrivalMonday, 12, 0))
	bach.stay(anna, arrivalMonday, wallClock(arrivalMonday, 13, 0), at(arrivalMonday, 15, 10))
	// Ben was never checked out: an arrival without a pickup.
	bach.stay(ben, arrivalMonday, wallClock(arrivalMonday, 7, 35), nil)
	bach.stay(anna, arrivalNextMonday, wallClock(arrivalNextMonday, 11, 45), at(arrivalNextMonday, 16, 5))
	bach.stay(ben, arrivalTuesday, wallClock(arrivalTuesday, 18, 10), at(arrivalTuesday, 18, 20))
	// Nobody checked Clara out; the nightly cleanup closed her stay at
	// 23:59:59. That is no pickup and must not stretch the axis to 23:30.
	forgotten := arrivalTuesday.EndOfDay()
	bach.stay(clara, arrivalTuesday, wallClock(arrivalTuesday, 7, 50), &forgotten)
	// Outside the period and at another Träger: never counted.
	bach.stay(ben, arrivalMonday.AddDays(-7), wallClock(arrivalMonday.AddDays(-7), 9, 0), nil)
	foreign := newArrivalSchool(t, db, foreignID)
	foreign.stay(foreign.child("Fritz"), arrivalMonday, wallClock(arrivalMonday, 7, 30), at(arrivalMonday, 14, 0))

	office := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, office.ID, identityaccess.TraegerRoleReadOnly)
	code, answer := traegerSignIn(t, router, office.Email, password, 0)
	require.Equal(t, http.StatusOK, code)

	rec := traegerOccupancyRequest(t, router, "/traeger/schools/arrival-pickup-times?"+arrivalPeriod, answer.AccessToken, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), "Anna", "averages, no names of children")
	assert.NotContains(t, rec.Body.String(), "OGS Fremd Ankunft", "no school of another Träger")
	got := decodeSchoolPortalData[traegerview.ArrivalPickupTimes](t, rec.Body.Bytes())
	assert.Equal(t, arrivalMonday, got.From)
	assert.Equal(t, arrivalNextMonday, got.To)
	assert.Equal(t, 7*60, got.FirstMinute)
	assert.Equal(t, 18*60, got.LastMinute, "the stay at 18:10 widens the axis, the cleanup's 23:59:59 does not")
	require.Len(t, got.Schools, 2)
	assert.Equal(t, "OGS Am Bach", got.Schools[0].Name, "ordered by name")

	monday, tuesday := got.Schools[0].Weekdays[0], got.Schools[0].Weekdays[1]
	assert.Equal(t, 2, monday.Days, "two Mondays with an attendance")
	assert.InDelta(t, 1.0, arrivalCell(t, monday, 7, 30).Arrivals, 0.001, "two arrivals at 07:30 over two Mondays")
	assert.InDelta(t, 0.5, arrivalCell(t, monday, 11, 30).Arrivals, 0.001)
	assert.InDelta(t, 0, arrivalCell(t, monday, 13, 0).Arrivals, 0.001, "coming back after lunch is no arrival")
	assert.InDelta(t, 0, arrivalCell(t, monday, 12, 0).Pickups, 0.001, "leaving for lunch is no pickup")
	assert.InDelta(t, 0.5, arrivalCell(t, monday, 15, 0).Pickups, 0.001, "the last check-out of the day is the pickup")
	assert.InDelta(t, 0.5, arrivalCell(t, monday, 16, 0).Pickups, 0.001)
	assert.InDelta(t, 0, arrivalCell(t, monday, 9, 0).Arrivals, 0.001, "a day outside the period does not count")
	assert.Equal(t, 1, tuesday.Days)
	assert.InDelta(t, 1, arrivalCell(t, tuesday, 18, 0).Arrivals, 0.001)
	assert.InDelta(t, 1, arrivalCell(t, tuesday, 18, 0).Pickups, 0.001)
	assert.InDelta(t, 1, arrivalCell(t, tuesday, 7, 30).Arrivals, 0.001, "a stay the cleanup closed still counts its arrival")
	require.NotNil(t, got.Schools[0].FirstDay)
	assert.Equal(t, arrivalMonday, *got.Schools[0].FirstDay)
	assert.Nil(t, got.Schools[1].FirstDay, "a school without attendance has no data")
	assert.InDelta(t, 1.0, arrivalCell(t, got.All.Weekdays[0], 7, 30).Arrivals, 0.001, "all schools of the Träger, no other Träger")

	export := traegerOccupancyRequest(t, router, "/traeger/schools/arrival-pickup-times/export?"+arrivalPeriod, answer.AccessToken, nil)
	require.Equal(t, http.StatusOK, export.Code, export.Body.String())
	assert.Equal(t, "text/csv; charset=utf-8", export.Header().Get("Content-Type"))
	assert.Contains(t, export.Header().Get("Content-Disposition"), "ankunft-und-abholung-2026-09-07-bis-2026-09-14.csv")
	csv := strings.TrimPrefix(export.Body.String(), "\xEF\xBB\xBF")
	for _, line := range []string{
		"Von;Bis;Schule;Ort;Wochentag;Uhrzeit;Ankunft je Tag;Abholung je Tag;Tage",
		"07.09.2026;14.09.2026;Alle Schulen;;Montag;07:30–08:00;1,0;0,0;2",
		"07.09.2026;14.09.2026;OGS Am Bach;;Montag;15:00–15:30;0,0;0,5;2",
		"07.09.2026;14.09.2026;OGS Lindenweg;;Montag;07:30–08:00;0,0;0,0;0",
	} {
		assert.Contains(t, csv, line+"\n")
	}
	assert.NotContains(t, csv, "Fremd")

	// #4718: one school without the rows of all schools, and PDF and Excel.
	single := traegerOccupancyRequest(t, router, fmt.Sprintf("/traeger/schools/arrival-pickup-times/export?%s&school=%d", arrivalPeriod, got.Schools[0].ID), answer.AccessToken, nil)
	require.Equal(t, http.StatusOK, single.Code, single.Body.String())
	assert.Contains(t, single.Body.String(), "07.09.2026;14.09.2026;OGS Am Bach;;Montag;15:00–15:30;0,0;0,5;2\n")
	assert.NotContains(t, single.Body.String(), "Alle Schulen")
	assert.NotContains(t, single.Body.String(), "OGS Lindenweg")
	stranger := traegerOccupancyRequest(t, router, fmt.Sprintf("/traeger/schools/arrival-pickup-times/export?%s&school=%d", arrivalPeriod, foreignID), answer.AccessToken, nil)
	assert.Equal(t, http.StatusNotFound, stranger.Code, stranger.Body.String())
	assertTraegerListFormats(t, router, answer.AccessToken, "/traeger/schools/arrival-pickup-times/export?"+arrivalPeriod, "ankunft-und-abholung-2026-09-07-bis-2026-09-14")
}

func TestTraegerArrivalPickupTimesNeedTheReportsRightAndAPeriod(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Ankunft Ohne Recht", true)
	testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Ankunft Ohne Recht")
	signIn := func(roles ...string) string {
		account := traegerAccount(t, db, password)
		testpkg.CreateTestTraegerMember(t, db, organization, account.ID, roles...)
		code, answer := traegerSignIn(t, router, account.Email, password, 0)
		require.Equal(t, http.StatusOK, code)
		return answer.AccessToken
	}

	// Leitung reads the dashboard but no reports.
	for _, token := range []string{signIn(), signIn(identityaccess.TraegerRoleLeadership)} {
		for _, path := range []string{"/traeger/schools/arrival-pickup-times?" + arrivalPeriod, "/traeger/schools/arrival-pickup-times/export?" + arrivalPeriod} {
			rec := traegerOccupancyRequest(t, router, path, token, nil)
			assert.Equal(t, http.StatusForbidden, rec.Code, path+": "+rec.Body.String())
			assert.NotContains(t, rec.Body.String(), "OGS Ankunft Ohne Recht")
		}
	}

	reader := signIn(identityaccess.TraegerRoleReadOnly)
	for _, query := range []string{"", "from=2026-09-14&to=2026-09-07", "from=2025-09-01&to=2026-09-07", "from=morgen&to=2026-09-07"} {
		rec := traegerOccupancyRequest(t, router, "/traeger/schools/arrival-pickup-times?"+query, reader, nil)
		assert.Equal(t, http.StatusBadRequest, rec.Code, query+": "+rec.Body.String())
	}
}

func TestTraegerArrivalPickupTimesQueryBudgetIsFlat(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Ankunft Budget", true)
	addSchool := func(name string) {
		school := newArrivalSchool(t, db, testpkg.CreateTestSchoolInOrganization(t, db, organization, name))
		school.stay(school.child("Kind"), arrivalMonday, wallClock(arrivalMonday, 8, 0), at(arrivalMonday, 15, 0))
	}
	for _, name := range []string{"OGS Eins", "OGS Zwei", "OGS Drei"} {
		addSchool(name)
	}
	account := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, account.ID, identityaccess.TraegerRoleReadOnly)
	code, answer := traegerSignIn(t, router, account.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	read := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		rec := traegerOccupancyRequest(t, router, "/traeger/schools/arrival-pickup-times?"+arrivalPeriod, answer.AccessToken, counter)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		// The arrivals start with WITH: every read counts, not only SELECT.
		return counter.Measurement(counter.Matching(func(sql string) bool {
			return strings.HasPrefix(sql, "select") || strings.HasPrefix(sql, "with")
		}))
	}
	three := read()
	for _, name := range []string{"OGS Vier", "OGS Fünf"} {
		addSchool(name)
	}
	assert.Len(t, read().Statements, len(three.Statements), "the heatmap reads the same statements for any number of schools")
	querybudgets.AssertQueryBudget(t, "api.traeger.schools_arrival_pickup_times", three)
}
