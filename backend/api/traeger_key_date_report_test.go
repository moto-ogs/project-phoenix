package api

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	carePlanCompose "github.com/moto-ogs/project-phoenix/modules/careplan/compose"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	organizationTenancyCompose "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/compose"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// reportKeyDate is a Thursday in the school year 2026/27: its absence window
// runs from 1 August 2026 to the key date.
var reportKeyDate = calendar.NewDate(2026, time.October, 15)

const keyDateReportPath = "/traeger/reports/key-date"

func keyDateReportQuery(template int64) string {
	query := "?key_date=" + reportKeyDate.String()
	if template > 0 {
		query += fmt.Sprintf("&template=%d", template)
	}
	return query
}

// statusDay records a sick or excused status day of student that stands for
// the day.
func statusDay(t *testing.T, db *bun.DB, school, student int64, day calendar.Date, status string) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO active.student_status_days (tenant_id, student_id, date, status, reported_at, source)
		VALUES (?, ?, ?, ?, NOW(), 'manual')`, school, student, day, status)
	require.NoError(t, err)
}

func keyDateSchoolOf(t *testing.T, report traegerview.KeyDateReport, school int64) traegerview.KeyDateSchool {
	t.Helper()
	for _, row := range report.Schools {
		if row.ID == school {
			return row
		}
	}
	t.Fatalf("school %d is missing from the report", school)
	return traegerview.KeyDateSchool{}
}

// keyDateReportFixture is a Träger with a busy school, an empty one and a
// school of another Träger that holds everything the reads look for.
type keyDateReportFixture struct {
	organization, park, linden, foreign int64
	token                               string
}

func newKeyDateReportFixture(t *testing.T, db *bun.DB, router *traegerPortalHandler, role string) keyDateReportFixture {
	t.Helper()
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Stichtag", true)
	testpkg.OwnTraegerMasterData(t, db, organization)
	park := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Am Park")
	linden := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Lindenweg")
	foreign := testpkg.CreateTestSchoolInOrganization(t, db, traegerOrganization(t, db, "Träger Fremd Stichtag", true), "OGS Fremd Stichtag")

	anna := testpkg.CreateTestStudentForTenant(t, db, park, "Anna", "Stichtag", "1a")
	ben := testpkg.CreateTestStudentForTenant(t, db, park, "Ben", "Stichtag", "1a")
	cem := testpkg.CreateTestStudentForTenant(t, db, park, "Cem", "Stichtag", "2b")
	testpkg.CreateTestStaffForTenant(t, db, park, "Petra", "Personal")
	testpkg.CreateTestStaffForTenant(t, db, park, "Paul", "Personal")
	bookings := newOccupancyBookings(t, db, park)
	ogs := bookings.offering("Bis 16 Uhr", true, 10)
	early := bookings.offering("Frühbetreuung", true, 0)
	bookings.book(anna.ID, ogs, "approved", nil, nil)
	bookings.book(ben.ID, ogs, "approved", nil, nil)
	bookings.book(anna.ID, early, "approved", nil, nil)
	// Cem waits for a decision; a sibling of the online enrollment is on
	// the waitlist. Neither booking counts as care.
	bookings.book(cem.ID, ogs, "submitted", nil, nil)
	bookings.book(cem.ID, early, "waitlisted", nil, nil)

	presence := newUtilizationPresence(t, db, park)
	presence.checkIn(anna.ID, calendar.NewDate(2026, time.October, 12)) // Monday
	presence.checkIn(ben.ID, calendar.NewDate(2026, time.October, 12))
	presence.checkIn(cem.ID, calendar.NewDate(2026, time.October, 11)) // Sunday: no weekday
	presence.checkIn(cem.ID, calendar.NewDate(2026, time.October, 13)) // the school is open
	presence.checkIn(cem.ID, calendar.NewDate(2026, time.October, 14))
	// A weekday without any check-in, a holiday say: its sick day raises no
	// absence (#4716).
	statusDay(t, db, park, ben.ID, calendar.NewDate(2026, time.October, 5), "sick")
	statusDay(t, db, park, anna.ID, calendar.NewDate(2026, time.October, 14), "sick")   // Wednesday
	statusDay(t, db, park, anna.ID, calendar.NewDate(2026, time.October, 10), "sick")   // Saturday: no weekday
	statusDay(t, db, park, ben.ID, calendar.NewDate(2026, time.October, 13), "excused") // Tuesday
	statusDay(t, db, park, cem.ID, calendar.NewDate(2026, time.July, 30), "sick")       // the school year before
	statusDay(t, db, park, cem.ID, calendar.NewDate(2026, time.October, 16), "excused") // after the key date

	fritz := testpkg.CreateTestStudentForTenant(t, db, foreign, "Fritz", "Fremd", "1a")
	testpkg.CreateTestStaffForTenant(t, db, foreign, "Frieda", "Fremd")
	foreignBookings := newOccupancyBookings(t, db, foreign)
	foreignBookings.book(fritz.ID, foreignBookings.offering("Fremdes Angebot", true, 5), "submitted", nil, nil)
	newUtilizationPresence(t, db, foreign).checkIn(fritz.ID, calendar.NewDate(2026, time.October, 12))
	statusDay(t, db, foreign, fritz.ID, calendar.NewDate(2026, time.October, 14), "sick")

	account := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, account.ID, role)
	code, answer := traegerSignIn(t, router, account.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	return keyDateReportFixture{organization: organization, park: park, linden: linden, foreign: foreign, token: answer.AccessToken}
}

func TestTraegerKeyDateReportCountsChildrenStaffAbsencesAndDemand(t *testing.T) {
	t.Parallel()
	// The report ends its absence window at today at the latest: the day lies
	// after the key date, so the window runs to the key date (rule 14).
	today := calendar.NewDate(2026, time.November, 18)
	db, router, _, _ := newTraegerPortalAt(t, func() calendar.Date { return today }, func() time.Time { return today.BerlinMidnight().Add(12 * time.Hour) })
	fixture := newKeyDateReportFixture(t, db, router, identityaccess.TraegerRoleAdministration)

	rec := traegerOccupancyRequest(t, router, keyDateReportPath+keyDateReportQuery(0), fixture.token, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), "Anna", "the report carries counts, no names of children")
	assert.NotContains(t, rec.Body.String(), "Petra", "nor of staff members")
	assert.NotContains(t, rec.Body.String(), "Fremd", "no school or care form of another Träger")
	report := decodeSchoolPortalData[traegerview.KeyDateReport](t, rec.Body.Bytes())
	assert.Equal(t, reportKeyDate, report.KeyDate)
	assert.Nil(t, report.Template, "the standard report")
	assert.Equal(t, []string{"children", "staff", "absences", "demand"}, report.Sections)
	require.NotNil(t, report.AbsenceWindow)
	assert.Equal(t, traegerview.ReportWindow{From: calendar.NewDate(2026, time.August, 1), To: reportKeyDate}, *report.AbsenceWindow)
	assert.Empty(t, report.Districts, "the standard report has no Sozialraum")
	require.Len(t, report.Schools, 2)
	assert.Equal(t, []int64{fixture.park, fixture.linden}, []int64{report.Schools[0].ID, report.Schools[1].ID}, "ordered by name")

	park := keyDateSchoolOf(t, report, fixture.park)
	assert.Nil(t, park.District)
	require.NotNil(t, park.AttendanceFrom)
	// Two absent of six counted days, computed at run time like the report.
	absent, counted := 2.0, 6.0
	half, rate := 1.5, absent/counted*100
	assert.Equal(t, traegerview.KeyDateFigures{
		Children: 3, WithoutCareForm: 1, Staff: 2, ChildrenPerStaff: &half,
		PresentDays: 4, SickDays: 1, ExcusedDays: 1, AbsenceRate: &rate,
		Places: 10, BookedPlaces: 2, FreePlaces: 8, Booked: 2, Open: 1, Waitlisted: 1, Demand: 4,
	}, park.Figures)
	ten := 10
	assert.Equal(t, []traegerview.KeyDateCareForm{
		{Name: "Bis 16 Uhr", Children: 2, Capacity: &ten, Active: true},
		{Name: "Frühbetreuung", Children: 1, Active: true},
	}, park.CareForms)

	linden := keyDateSchoolOf(t, report, fixture.linden)
	assert.Equal(t, traegerview.KeyDateFigures{}, linden.Figures, "a school without children counts zeros and no ratio")
	assert.Empty(t, linden.CareForms)
	assert.Nil(t, linden.AttendanceFrom)

	assert.Equal(t, 2, report.Total.Schools)
	assert.Equal(t, park.Figures, report.Total.Figures, "the empty school adds nothing")
	assert.Equal(t, park.CareForms, report.Total.CareForms)
}

func TestTraegerKeyDateReportFollowsItsTemplate(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	fixture := newKeyDateReportFixture(t, db, router, identityaccess.TraegerRoleAdministration)
	template := createReportTemplate(t, router, fixture.token, reportTemplateBody{
		Name: "Jugendamt Stichtag", Sections: []string{"children", "demand"}, KeyDateMonth: 10, KeyDateDay: 15,
		Districts: []reportTemplateDistrict{{SchoolID: wireID(fixture.park), District: "Nord"}},
	})

	rec := traegerOccupancyRequest(t, router, keyDateReportPath+keyDateReportQuery(int64(template.ID)), fixture.token, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	report := decodeSchoolPortalData[traegerview.KeyDateReport](t, rec.Body.Bytes())
	require.NotNil(t, report.Template)
	assert.Equal(t, traegerview.KeyDateReportTemplate{ID: int64(template.ID), Name: "Jugendamt Stichtag"}, *report.Template)
	assert.Equal(t, []string{"children", "demand"}, report.Sections)
	assert.Nil(t, report.AbsenceWindow, "the template shows no absences")
	park := keyDateSchoolOf(t, report, fixture.park)
	require.NotNil(t, park.District)
	assert.Equal(t, "Nord", *park.District)
	assert.Zero(t, park.Figures.Staff, "a section the template leaves out is not read")
	assert.Zero(t, park.Figures.SickDays)
	assert.Equal(t, 3, park.Figures.Children)
	assert.Equal(t, 4, park.Figures.Demand)
	assert.Nil(t, keyDateSchoolOf(t, report, fixture.linden).District)
	require.Len(t, report.Districts, 2, "Nord and the schools without a Sozialraum")
	assert.Equal(t, "Nord", report.Districts[0].Name)
	assert.False(t, report.Districts[0].Unmapped)
	assert.Equal(t, 1, report.Districts[0].Schools)
	assert.Equal(t, park.Figures, report.Districts[0].Figures)
	assert.Equal(t, traegerview.UnmappedDistrict, report.Districts[1].Name)
	assert.True(t, report.Districts[1].Unmapped)
	assert.Equal(t, 1, report.Districts[1].Schools)
	assert.Equal(t, 2, report.Total.Schools)

	for format, contentType := range map[string]string{
		"csv":  "text/csv; charset=utf-8",
		"xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"pdf":  "application/pdf",
	} {
		export := traegerOccupancyRequest(t, router, keyDateReportPath+"/export"+keyDateReportQuery(int64(template.ID))+"&format="+format, fixture.token, nil)
		require.Equal(t, http.StatusOK, export.Code, "%s: %s", format, export.Body.String())
		assert.Equal(t, contentType, export.Header().Get("Content-Type"), format)
		assert.Contains(t, export.Header().Get("Content-Disposition"), "bericht-stichtag-2026-10-15."+format, format)
		assert.Equal(t, "no-store", export.Header().Get("Cache-Control"), format)
		assert.NotEmpty(t, export.Body.Bytes(), format)
	}
	csv := traegerOccupancyRequest(t, router, keyDateReportPath+"/export"+keyDateReportQuery(int64(template.ID))+"&format=csv", fixture.token, nil)
	lines := strings.Split(strings.TrimPrefix(csv.Body.String(), "\xEF\xBB\xBF"), "\n")
	assert.Equal(t, "Standort;Ort;Sozialraum;Betreuungsform;Stichtag;Kinder;Ohne Betreuungsform;Plätze;Belegte Plätze;Freie Plätze;Offene Anmeldungen;Warteliste;Nachfrage;Anmeldungen Stand", lines[0])
	for _, line := range []string{
		"OGS Am Park;;Nord;;3;1;10;2;8;1;1;4",
		"Summe Nord;;Nord;;3;1;10;2;8;1;1;4",
		"OGS Lindenweg;;Ohne Sozialraum;;0;0;0;0;0;0;0;0",
		"Gesamt;;;;3;1;10;2;8;1;1;4",
		"OGS Am Park;;Nord;Bis 16 Uhr;2;;10;;;;;",
		"OGS Am Park;;Nord;Ohne Betreuungsform;1;;;;;;;",
		"Gesamt;;;Frühbetreuung;1;;;;;;;",
	} {
		cells := slices.Insert(strings.Split(line, ";"), 4, report.KeyDate.String())
		cells = append(cells, calendar.DateFromTime(report.AsOf).String())
		assert.Contains(t, lines, strings.Join(cells, ";"))
	}
	assert.NotContains(t, csv.Body.String(), "Fremd")
	unsupported := traegerOccupancyRequest(t, router, keyDateReportPath+"/export"+keyDateReportQuery(0)+"&format=docx", fixture.token, nil)
	assert.Equal(t, http.StatusBadRequest, unsupported.Code, unsupported.Body.String())
}

func TestTraegerKeyDateReportRefusals(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	fixture := newKeyDateReportFixture(t, db, router, identityaccess.TraegerRoleReadOnly)

	for _, bad := range []string{"", "?key_date=15.10.2026", "?key_date=1999-12-31", "?key_date=2999-01-01", "?key_date=2026-10-15&template=abc"} {
		rec := traegerOccupancyRequest(t, router, keyDateReportPath+bad, fixture.token, nil)
		assert.Equal(t, http.StatusBadRequest, rec.Code, "query %q: %s", bad, rec.Body.String())
	}

	// A template of another Träger, and an unknown one, is no template of
	// this Träger.
	foreignPortal := newTraegerOffice(t, db, router, "Träger Fremde Berichte", identityaccess.TraegerRoleAdministration)
	foreign := createReportTemplate(t, router, foreignPortal.token, reportTemplateBody{Name: "Fremd", Sections: []string{"staff"}, KeyDateMonth: 1, KeyDateDay: 1})
	for _, path := range []string{keyDateReportPath + keyDateReportQuery(int64(foreign.ID)), keyDateReportPath + "/export" + keyDateReportQuery(int64(foreign.ID)) + "&format=csv"} {
		rec := traegerOccupancyRequest(t, router, path, fixture.token, nil)
		require.Equal(t, http.StatusNotFound, rec.Code, "%s: %s", path, rec.Body.String())
		assert.Equal(t, "traeger.report_template_not_found", refusalOf(t, rec).Code)
	}

	// Leitung holds no "Berichte lesen": neither the report nor its export.
	password := testpkg.NewTestPassword()
	leader := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, fixture.organization, leader.ID, identityaccess.TraegerRoleLeadership)
	code, answer := traegerSignIn(t, router, leader.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	for _, path := range []string{keyDateReportPath + keyDateReportQuery(0), keyDateReportPath + "/export" + keyDateReportQuery(0) + "&format=pdf"} {
		rec := traegerOccupancyRequest(t, router, path, answer.AccessToken, nil)
		assert.Equal(t, http.StatusForbidden, rec.Code, "%s without traeger_reports:read: %s", path, rec.Body.String())
	}
}

func TestTraegerKeyDateReportQueryBudget(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Stichtag Budget", true)
	testpkg.OwnTraegerMasterData(t, db, organization)
	addSchool := func(name string) int64 {
		school := testpkg.CreateTestSchoolInOrganization(t, db, organization, name)
		child := testpkg.CreateTestStudentForTenant(t, db, school, "Kind", name, "1a")
		testpkg.CreateTestStaffForTenant(t, db, school, "Kraft", name)
		bookings := newOccupancyBookings(t, db, school)
		bookings.book(child.ID, bookings.offering("OGS", true, 10), "approved", nil, nil)
		waiting := testpkg.CreateTestStudentForTenant(t, db, school, "Warte", name, "1a")
		bookings.book(waiting.ID, bookings.offering("Früh", true, 5), "waitlisted", nil, nil)
		newUtilizationPresence(t, db, school).checkIn(child.ID, calendar.NewDate(2026, time.October, 12))
		statusDay(t, db, school, child.ID, calendar.NewDate(2026, time.October, 13), "sick")
		return school
	}
	schools := []int64{addSchool("OGS Eins"), addSchool("OGS Zwei"), addSchool("OGS Drei")}
	account := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, account.ID, identityaccess.TraegerRoleAdministration)
	code, answer := traegerSignIn(t, router, account.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	template := createReportTemplate(t, router, answer.AccessToken, reportTemplateBody{
		Name: "Alles", Sections: []string{"children", "staff", "absences", "demand"}, KeyDateMonth: 10, KeyDateDay: 15,
		Districts: []reportTemplateDistrict{{SchoolID: wireID(schools[0]), District: "Nord"}, {SchoolID: wireID(schools[1]), District: "Süd"}},
	})
	path := keyDateReportPath + keyDateReportQuery(int64(template.ID))
	read := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		rec := traegerOccupancyRequest(t, router, path, answer.AccessToken, counter)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		// The attendance read is a common table expression: count every
		// read, not only those that start with SELECT.
		return counter.Measurement(counter.Matching(func(sql string) bool {
			sql = strings.TrimSpace(sql)
			return strings.HasPrefix(sql, "select") || strings.HasPrefix(sql, "with")
		}))
	}
	three := read()
	addSchool("OGS Vier")
	addSchool("OGS Fünf")
	assert.Len(t, read().Statements, len(three.Statements), "the report reads the same statements for any number of schools")
	querybudgets.AssertQueryBudget(t, "api.traeger.reports_key_date", three)
}

func TestTraegerKeyDateReportReadsRefuseOutsideTheAdministrativeTransaction(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	school, _ := testpkg.CreateTestTenant(t, db)
	other, _ := testpkg.CreateTestTenant(t, db)
	child := testpkg.CreateTestStudentForTenant(t, db, school, "Ida", "Eule", "1a")
	statusDay(t, db, school, child.ID, calendar.NewDate(2026, time.October, 13), "sick")
	statusDay(t, db, school, child.ID, calendar.NewDate(2026, time.October, 14), "excused")
	bookings := newOccupancyBookings(t, db, school)
	bookings.book(child.ID, bookings.offering("OGS", true, 0), "waitlisted", nil, nil)
	// The other school holds everything the reads look for. The
	// administrative transaction bypasses RLS, so only the school filter of
	// each statement keeps it out.
	foreignChild := testpkg.CreateTestStudentForTenant(t, db, other, "Fritz", "Fremd", "1a")
	statusDay(t, db, other, foreignChild.ID, calendar.NewDate(2026, time.October, 13), "sick")
	foreign := newOccupancyBookings(t, db, other)
	foreign.book(foreignChild.ID, foreign.offering("Fremd", true, 0), "submitted", nil, nil)

	_, templates := organizationTenancyCompose.NewTraegerReportTemplates()
	ports := traegerReportPorts(templates)
	scope := []int64{school}
	from, to := calendar.NewDate(2026, time.August, 1), calendar.NewDate(2026, time.October, 15)
	reads := func(ctx context.Context) []error {
		_, _, absences := ports.Absences.StatusDayCountsByTenant(ctx, scope, from, to)
		_, _, demand := ports.Demand.EnrollmentDemandByTenant(ctx, scope)
		_, template := ports.Templates.ReportTemplate(ctx, 1, 1)
		return []error{absences, demand, template}
	}
	for index, err := range reads(testpkg.TenantContext(school)) {
		assert.Error(t, err, "read %d refuses a tenant transaction", index)
		assert.NotErrorIs(t, err, traegerview.ErrReportTemplateNotFound, "read %d refuses before it reads", index)
	}
	require.NoError(t, testpkg.WithinAdminContext(t, context.Background(), db, func(adminCtx context.Context) error {
		sick, excused, err := carePlanCompose.NewSickStudents().StatusDayCountsByTenant(adminCtx, scope, from, to)
		require.NoError(t, err)
		assert.Equal(t, map[int64]map[calendar.Date]int{school: {calendar.NewDate(2026, time.October, 13): 1}}, sick, "only the given schools")
		assert.Equal(t, map[int64]map[calendar.Date]int{school: {calendar.NewDate(2026, time.October, 14): 1}}, excused)
		open, waitlisted, err := enrollmentCompose.NewOpenEnrollments().EnrollmentDemandByTenant(adminCtx, scope)
		require.NoError(t, err)
		assert.Empty(t, open, "the waiting child is the other school's")
		assert.Equal(t, map[int64]int{school: 1}, waitlisted)
		return nil
	}))
}
