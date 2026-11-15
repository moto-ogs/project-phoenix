package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// captureKeyDate writes the Stichtagszahl of school on keyDate, as the
// monthly capture of the operator billing report does. The table holds no
// tenant, so the row goes again when the test ends.
func captureKeyDate(t *testing.T, db *bun.DB, school int64, keyDate calendar.Date, active int) {
	t.Helper()
	period := calendar.NewDate(keyDate.Year(), keyDate.Month(), 1)
	_, err := db.ExecContext(context.Background(), `INSERT INTO platform.billing_key_date_counts
		(school_id, period, key_date, school_name, organization_name, active_students, active_terminals)
		VALUES (?, ?, ?, 'Schule', 'Träger', ?, 1)`, school, period, keyDate, active)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := db.ExecContext(context.Background(), `DELETE FROM platform.billing_key_date_counts WHERE school_id = ?`, school)
		assert.NoError(t, err)
	})
}

func comparedSchool(t *testing.T, got traegerview.SchoolComparison, school int64) traegerview.ComparedSchool {
	t.Helper()
	for _, row := range got.Schools {
		if row.ID == school {
			return row
		}
	}
	t.Fatalf("school %d is missing from the comparison", school)
	return traegerview.ComparedSchool{}
}

func TestTraegerComparisonComparesTheChosenSchools(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Vergleich", true)
	bach := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Am Bach")
	linden := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Lindenweg")
	foreign := testpkg.CreateTestSchoolInOrganization(t, db, traegerOrganization(t, db, "Träger Fremd Vergleich", true), "OGS Fremd Vergleich")
	day := utilizationDay
	window := fmt.Sprintf("from=%s&to=%s", day, utilizationFriday)

	anna := testpkg.CreateTestStudentForTenant(t, db, bach, "Anna", "Vergleich", "1a")
	ben := testpkg.CreateTestStudentForTenant(t, db, bach, "Ben", "Vergleich", "1a")
	bookings := newOccupancyBookings(t, db, bach)
	ogs := bookings.offering("OGS bis 16 Uhr", true, 4)
	bookings.book(anna.ID, ogs, "approved", nil, nil)
	bookings.book(ben.ID, ogs, "approved", nil, nil)
	presence := newUtilizationPresence(t, db, bach)
	presence.checkIn(anna.ID, day)
	presence.checkIn(ben.ID, day)
	presence.checkIn(anna.ID, day.AddDays(1))
	captureKeyDate(t, db, bach, day.AddDays(1), 31)
	captureKeyDate(t, db, linden, calendar.NewDate(2026, 5, 15), 12) // before the window

	cem := testpkg.CreateTestStudentForTenant(t, db, linden, "Cem", "Vergleich", "2b")
	lindenBookings := newOccupancyBookings(t, db, linden)
	lindenBookings.book(cem.ID, lindenBookings.offering("Frühbetreuung", true, 0), "approved", nil, nil)

	foreignChild := testpkg.CreateTestStudentForTenant(t, db, foreign, "Fritz", "Fremd", "1a")
	foreignBookings := newOccupancyBookings(t, db, foreign)
	foreignBookings.book(foreignChild.ID, foreignBookings.offering("Fremdes Angebot", true, 10), "approved", nil, nil)

	office := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, office.ID, identityaccess.TraegerRoleReadOnly)
	code, answer := traegerSignIn(t, router, office.Email, password, 0)
	require.Equal(t, http.StatusOK, code)

	rec := traegerOccupancyRequest(t, router, "/traeger/schools/comparison?"+window, answer.AccessToken, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), "Anna", "the comparison carries counts, no names of children")
	assert.NotContains(t, rec.Body.String(), "Fremd", "no school of another Träger")
	got := decodeSchoolPortalData[traegerview.SchoolComparison](t, rec.Body.Bytes())
	assert.Equal(t, 3, got.Days)
	require.Len(t, got.Schools, 2)

	am := comparedSchool(t, got, bach).Values
	assert.InDelta(t, 4, am[traegerview.ComparisonPlaces], 1e-9)
	assert.InDelta(t, 0.5, am[traegerview.ComparisonPlacesRate], 1e-9, "2 of 4 places on every weekday")
	assert.InDelta(t, 2, am[traegerview.ComparisonFreePlaces], 1e-9)
	assert.InDelta(t, 2, am[traegerview.ComparisonBooked], 1e-9)
	assert.InDelta(t, 0, am[traegerview.ComparisonBookedChange], 1e-9)
	assert.InDelta(t, 1.5, am[traegerview.ComparisonPresent], 1e-9, "two check-ins, then one; Friday has none")
	assert.InDelta(t, 2, am[traegerview.ComparisonPresentPeak], 1e-9)
	assert.InDelta(t, 31, am[traegerview.ComparisonActiveStudents], 1e-9)

	lindenRow := comparedSchool(t, got, linden)
	assert.NotContains(t, lindenRow.Values, traegerview.ComparisonPlaces, "no limited offering: no places, not 0")
	assert.NotContains(t, lindenRow.Values, traegerview.ComparisonActiveStudents, "a key date before the window does not count")
	assert.NotContains(t, lindenRow.Values, traegerview.ComparisonPresent)
	assert.InDelta(t, 1, lindenRow.Values[traegerview.ComparisonBooked], 1e-9)
	assert.InDelta(t, 1.5, got.Average[traegerview.ComparisonBooked], 1e-9)
	assert.InDelta(t, 3, got.Together[traegerview.ComparisonBooked], 1e-9)

	one := traegerOccupancyRequest(t, router, fmt.Sprintf("/traeger/schools/comparison?%s&schools=%d", window, linden), answer.AccessToken, nil)
	require.Equal(t, http.StatusOK, one.Code, one.Body.String())
	chosen := decodeSchoolPortalData[traegerview.SchoolComparison](t, one.Body.Bytes())
	require.Len(t, chosen.Schools, 1)
	assert.Equal(t, linden, chosen.Schools[0].ID)
	assert.InDelta(t, 1, chosen.Average[traegerview.ComparisonBooked], 1e-9, "the average of the chosen schools only")

	export := traegerOccupancyRequest(t, router, "/traeger/schools/comparison/export?"+window+"&metrics=places_rate,booked,active_students", answer.AccessToken, nil)
	require.Equal(t, http.StatusOK, export.Code, export.Body.String())
	assert.Equal(t, "text/csv; charset=utf-8", export.Header().Get("Content-Type"))
	assert.Contains(t, export.Header().Get("Content-Disposition"), fmt.Sprintf("standortvergleich-%s-bis-%s.csv", day, utilizationFriday))
	csv := strings.TrimPrefix(export.Body.String(), "\xEF\xBB\xBF")
	for _, line := range []string{
		"Schule;Ort;Plätze belegt (%);Kinder gebucht (Ø je Tag);Aktive Kinder am Stichtag",
		"OGS Am Bach;;50,0;2,0;31",
		"OGS Lindenweg;;;1,0;",
		"Schnitt je Schule;;50,0;1,5;31",
		"Alle zusammen;;50,0;3,0;31",
	} {
		assert.Contains(t, csv, line+"\n")
	}
	assert.NotContains(t, csv, "Fremd")

	for path, status := range map[string]int{
		fmt.Sprintf("/traeger/schools/comparison?%s&schools=%d", window, foreign):        http.StatusNotFound,
		fmt.Sprintf("/traeger/schools/comparison/export?%s&schools=%d", window, foreign): http.StatusNotFound,
		"/traeger/schools/comparison?" + window + "&schools=abc":                         http.StatusBadRequest,
		"/traeger/schools/comparison/export?" + window + "&metrics=salary":               http.StatusBadRequest,
		"/traeger/schools/comparison?from=2026-06-01&to=2999-01-01":                      http.StatusBadRequest,
	} {
		rec := traegerOccupancyRequest(t, router, path, answer.AccessToken, nil)
		assert.Equal(t, status, rec.Code, "%s: %s", path, rec.Body.String())
		assert.NotContains(t, rec.Body.String(), "Fremd", path)
	}

	// Leitung holds no "Berichte lesen": neither the comparison nor the export.
	leader := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, leader.ID, identityaccess.TraegerRoleLeadership)
	code, leaderAnswer := traegerSignIn(t, router, leader.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	for _, path := range []string{"/traeger/schools/comparison?" + window, "/traeger/schools/comparison/export?" + window} {
		rec := traegerOccupancyRequest(t, router, path, leaderAnswer.AccessToken, nil)
		assert.Equal(t, http.StatusForbidden, rec.Code, "%s without traeger_reports:read: %s", path, rec.Body.String())
	}
}

func TestTraegerComparisonQueryBudget(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Vergleich Budget", true)
	day := utilizationDay
	addSchool := func(name string) {
		school := testpkg.CreateTestSchoolInOrganization(t, db, organization, name)
		child := testpkg.CreateTestStudentForTenant(t, db, school, "Kind", name, "1a")
		bookings := newOccupancyBookings(t, db, school)
		bookings.book(child.ID, bookings.offering("OGS", true, 10), "approved", nil, nil)
		newUtilizationPresence(t, db, school).checkIn(child.ID, day)
		captureKeyDate(t, db, school, day, 1)
	}
	for _, name := range []string{"OGS Eins", "OGS Zwei", "OGS Drei"} {
		addSchool(name)
	}
	account := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, account.ID, identityaccess.TraegerRoleReadOnly)
	code, answer := traegerSignIn(t, router, account.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	path := fmt.Sprintf("/traeger/schools/comparison?from=%s&to=%s", day, utilizationFriday)
	read := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		rec := traegerOccupancyRequest(t, router, path, answer.AccessToken, counter)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Matching(func(sql string) bool {
			sql = strings.TrimSpace(sql)
			return strings.HasPrefix(sql, "select") || strings.HasPrefix(sql, "with")
		}))
	}
	three := read()
	for _, name := range []string{"OGS Vier", "OGS Fünf"} {
		addSchool(name)
	}
	assert.Len(t, read().Statements, len(three.Statements), "the comparison reads the same statements for any number of schools")
	querybudgets.AssertQueryBudget(t, "api.traeger.schools_comparison", three)
}
