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
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// utilizationDay is a finished Wednesday: the series count check-ins and
// room visits of finished days only. utilizationFriday ends its week.
var (
	utilizationDay    = calendar.NewDate(2026, time.June, 3)
	utilizationFriday = calendar.NewDate(2026, time.June, 5)
)

// utilizationPresence records the check-ins and room visits of one school.
type utilizationPresence struct {
	t      *testing.T
	db     *bun.DB
	school int64
	device int64
}

func newUtilizationPresence(t *testing.T, db *bun.DB, school int64) utilizationPresence {
	t.Helper()
	device := testpkg.CreateTestDeviceForTenant(t, db, school, fmt.Sprintf("kiosk-%d", testpkg.UniqueTestTenantID(t)))
	return utilizationPresence{t: t, db: db, school: school, device: device.ID}
}

// checkIn records an attendance of student on day.
func (p utilizationPresence) checkIn(student int64, day calendar.Date) {
	p.t.Helper()
	at := day.BerlinMidnight().Add(8 * time.Hour)
	out := at.Add(6 * time.Hour)
	testpkg.CreateTestAttendanceForTenant(p.t, p.db, p.school, student, 0, p.device, day, at, &out)
}

// consent records an accepted privacy consent of student, so its room
// visits count.
func (p utilizationPresence) consent(student int64) {
	p.t.Helper()
	_, err := p.db.ExecContext(context.Background(), `INSERT INTO users.privacy_consents
		(tenant_id, student_id, policy_version, accepted, accepted_at, renewal_required, data_retention_days)
		VALUES (?, ?, 'v1', TRUE, NOW(), FALSE, 30)`, p.school, student)
	require.NoError(p.t, err)
}

// room adds a room with capacity and a session in it.
func (p utilizationPresence) room(name string, capacity int) (room, session int64) {
	p.t.Helper()
	ctx := context.Background()
	require.NoError(p.t, p.db.NewRaw(`INSERT INTO facilities.rooms (tenant_id, name, capacity) VALUES (?, ?, ?) RETURNING id`,
		p.school, fmt.Sprintf("%s %d", name, testpkg.UniqueTestTenantID(p.t)), capacity).Scan(ctx, &room))
	activity := testpkg.CreateTestActivityGroupForTenant(p.t, p.db, p.school, "Raumzeit")
	session = testpkg.CreateTestActiveGroupWithIDsForTenant(p.t, p.db, p.school, activity.ID, room).ID
	return room, session
}

// visit records a visit of student in session on day from hour to hour.
func (p utilizationPresence) visit(student, session int64, day calendar.Date, from, to int) {
	p.t.Helper()
	exit := day.BerlinMidnight().Add(time.Duration(to) * time.Hour)
	testpkg.CreateTestVisitForTenant(p.t, p.db, p.school, student, session, day.BerlinMidnight().Add(time.Duration(from)*time.Hour), &exit)
}

func utilizationOf(t *testing.T, got traegerview.Utilization, school int64) traegerview.SchoolUtilization {
	t.Helper()
	for _, row := range got.Schools {
		if row.ID == ident.ID(school) {
			return row
		}
	}
	t.Fatalf("school %d is missing from the utilization", school)
	return traegerview.SchoolUtilization{}
}

func TestTraegerUtilizationCountsOfferingsAttendanceAndRoomsPerDay(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Auslastung", true)
	school := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Am Bach")
	empty := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Lindenweg")
	foreignOrganization := traegerOrganization(t, db, "Träger Fremd Auslastung", true)
	foreign := testpkg.CreateTestSchoolInOrganization(t, db, foreignOrganization, "OGS Fremd Auslastung")
	day := utilizationDay
	window := fmt.Sprintf("from=%s&to=%s", day, utilizationFriday)

	anna := testpkg.CreateTestStudentForTenant(t, db, school, "Anna", "Auslastung", "1a")
	ben := testpkg.CreateTestStudentForTenant(t, db, school, "Ben", "Auslastung", "1a")
	cem := testpkg.CreateTestStudentForTenant(t, db, school, "Cem", "Auslastung", "2b")
	bookings := newOccupancyBookings(t, db, school)
	ogs := bookings.offering("OGS bis 16 Uhr", true, 4)
	early := bookings.offering("Frühbetreuung", true, 0)
	bookings.book(anna.ID, ogs, "approved", nil, nil)
	bookings.book(ben.ID, ogs, "approved", nil, nil)
	bookings.book(anna.ID, early, "approved", nil, nil)
	bookings.book(cem.ID, ogs, "submitted", nil, nil)
	bookings.offering("Mittagessen", false, 50)

	presence := newUtilizationPresence(t, db, school)
	presence.checkIn(anna.ID, day)
	presence.checkIn(ben.ID, day)
	gym, session := presence.room("Turnhalle", 20)
	presence.consent(anna.ID)
	presence.consent(cem.ID)
	presence.visit(anna.ID, session, day, 13, 15)
	presence.visit(cem.ID, session, day, 14, 16)
	presence.visit(ben.ID, session, day, 13, 16) // no consent: does not count

	foreignChild := testpkg.CreateTestStudentForTenant(t, db, foreign, "Fritz", "Fremd", "1a")
	foreignBookings := newOccupancyBookings(t, db, foreign)
	foreignBookings.book(foreignChild.ID, foreignBookings.offering("Fremdes Angebot", true, 10), "approved", nil, nil)
	foreignPresence := newUtilizationPresence(t, db, foreign)
	foreignPresence.checkIn(foreignChild.ID, day)

	office := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, office.ID, identityaccess.TraegerRoleReadOnly)
	code, answer := traegerSignIn(t, router, office.Email, password, 0)
	require.Equal(t, http.StatusOK, code)

	rec := traegerOccupancyRequest(t, router, "/traeger/schools/utilization?"+window, answer.AccessToken, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), "Anna", "the utilization carries counts, no names of children")
	assert.NotContains(t, rec.Body.String(), "Fremd", "no school or offering of another Träger")
	got := decodeSchoolPortalData[traegerview.Utilization](t, rec.Body.Bytes())
	require.NotEmpty(t, got.Days)
	assert.Equal(t, day, got.Days[0], "the series start on the first weekday of the window")
	require.Len(t, got.Schools, 2)

	bach := utilizationOf(t, got, school)
	assert.Equal(t, 4, bach.Places, "only offerings with a limit add places")
	assert.Equal(t, 2, bach.Booked[0], "Anna and Ben once each; an undecided child does not count")
	assert.Equal(t, 2, bach.BookedPlaces[0])
	require.NotNil(t, bach.Present[0])
	assert.Equal(t, 2, *bach.Present[0])
	assert.Equal(t, []calendar.Date{day, day.AddDays(1), utilizationFriday}, got.Days)
	assert.Nil(t, bach.Present[1], "a day without any check-in has no figure, not 0")
	require.NotNil(t, bach.AttendanceFrom)
	require.Len(t, bach.Offerings, 2, "lunch does not count as care")
	assert.Equal(t, "Frühbetreuung", bach.Offerings[0].Name)
	assert.Equal(t, early, bach.Offerings[0].ID)
	assert.Equal(t, 1, bach.Offerings[0].Booked[0])
	assert.Equal(t, ogs, bach.Offerings[1].ID)
	assert.Equal(t, 2, bach.Offerings[1].Booked[0])
	require.Len(t, bach.Rooms, 1, "only rooms with a counted visit")
	assert.Equal(t, gym, bach.Rooms[0].ID)
	require.NotNil(t, bach.Rooms[0].Children[0])
	assert.Equal(t, 2, *bach.Rooms[0].Children[0], "Anna and Cem; Ben has no consent")
	assert.Equal(t, 2, *bach.Rooms[0].Peak[0], "both between 14 and 15 o'clock")

	linden := utilizationOf(t, got, empty)
	assert.Zero(t, linden.Places)
	assert.Empty(t, linden.Offerings)
	assert.Empty(t, linden.Rooms)
	assert.Nil(t, linden.AttendanceFrom)

	export := traegerOccupancyRequest(t, router, "/traeger/schools/utilization/export?"+window, answer.AccessToken, nil)
	require.Equal(t, http.StatusOK, export.Code, export.Body.String())
	assert.Equal(t, "text/csv; charset=utf-8", export.Header().Get("Content-Type"))
	assert.Contains(t, export.Header().Get("Content-Disposition"), fmt.Sprintf("auslastung-%s-bis-%s.csv", day, utilizationFriday))
	csv := strings.TrimPrefix(export.Body.String(), "\xEF\xBB\xBF")
	date := day.Format("02.01.2006")
	for _, line := range []string{
		"Datum;Schule;Ort;Art;Name;Plätze;Kinder gebucht;Plätze belegt;Kinder anwesend;Kinder im Raum;Höchstens gleichzeitig",
		date + ";OGS Am Bach;;Schule;;4;2;2;2;;",
		date + ";OGS Am Bach;;Betreuungsangebot;OGS bis 16 Uhr;4;2;;;;",
		date + ";OGS Am Bach;;Betreuungsangebot;Frühbetreuung;;1;;;;",
		date + ";OGS Lindenweg;;Schule;;;0;0;;;",
	} {
		assert.Contains(t, csv, line+"\n")
	}
	assert.Contains(t, csv, ";Raum;Turnhalle ", "the room row")
	assert.NotContains(t, csv, "Fremd")

	single := traegerOccupancyRequest(t, router, fmt.Sprintf("/traeger/schools/utilization/export?%s&school=%d", window, empty), answer.AccessToken, nil)
	require.Equal(t, http.StatusOK, single.Code, single.Body.String())
	assert.NotContains(t, single.Body.String(), "OGS Am Bach", "one school only")
	assert.Contains(t, single.Body.String(), "OGS Lindenweg")
	stranger := traegerOccupancyRequest(t, router, fmt.Sprintf("/traeger/schools/utilization/export?%s&school=%d", window, foreign), answer.AccessToken, nil)
	assert.Equal(t, http.StatusNotFound, stranger.Code, "a school of another Träger: %s", stranger.Body.String())
	assert.Contains(t, stranger.Body.String(), "traeger.school_not_found")
	assert.NotContains(t, stranger.Body.String(), "Fremd")
	assertTraegerListFormats(t, router, answer.AccessToken, "/traeger/schools/utilization/export?"+window, fmt.Sprintf("auslastung-%s-bis-%s", day, utilizationFriday))

	// Leitung holds no "Berichte lesen": neither the figures nor the export.
	leader := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, leader.ID, identityaccess.TraegerRoleLeadership)
	code, leaderAnswer := traegerSignIn(t, router, leader.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	for _, path := range []string{"/traeger/schools/utilization?" + window, "/traeger/schools/utilization/export?" + window} {
		rec := traegerOccupancyRequest(t, router, path, leaderAnswer.AccessToken, nil)
		assert.Equal(t, http.StatusForbidden, rec.Code, "%s without traeger_reports:read: %s", path, rec.Body.String())
	}

	for _, bad := range []string{"", "from=" + day.String(), fmt.Sprintf("from=%s&to=%s", utilizationFriday, day), "from=2026-06-01&to=2999-01-01", "from=2025-01-01&to=2026-06-05"} {
		rec := traegerOccupancyRequest(t, router, "/traeger/schools/utilization?"+bad, answer.AccessToken, nil)
		assert.Equal(t, http.StatusBadRequest, rec.Code, "window %q: %s", bad, rec.Body.String())
	}
}

// Story 118: the figures are aggregated by default; the children of a
// school by name need "Verträge verwalten", stay with their Träger and are
// written to the school's access log.
func TestTraegerUtilizationChildrenNeedTheirRightAndAreLogged(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Auslastung Namen", true)
	school := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Am Hang")
	foreign := testpkg.CreateTestSchoolInOrganization(t, db, traegerOrganization(t, db, "Träger Fremd Namen", true), "OGS Fremd Namen")
	day := utilizationDay
	window := fmt.Sprintf("from=%s&to=%s", day, day)
	mia := testpkg.CreateTestStudentForTenant(t, db, school, "Mia", "Hang", "3c")
	newUtilizationPresence(t, db, school).checkIn(mia.ID, day)

	signIn := func(role string) (string, int64) {
		t.Helper()
		account := traegerAccount(t, db, password)
		testpkg.CreateTestTraegerMember(t, db, organization, account.ID, role)
		code, answer := traegerSignIn(t, router, account.Email, password, 0)
		require.Equal(t, http.StatusOK, code)
		return answer.AccessToken, account.ID
	}
	readOnly, readOnlyID := signIn(identityaccess.TraegerRoleReadOnly)
	admin, adminID := signIn(identityaccess.TraegerRoleAdministration)
	path := fmt.Sprintf("/traeger/schools/%d/utilization/children?%s", school, window)

	denied := traegerOccupancyRequest(t, router, path, readOnly, nil)
	assert.Equal(t, http.StatusForbidden, denied.Code, "Berichte lesen alone opens no names: %s", denied.Body.String())

	rec := traegerOccupancyRequest(t, router, path, admin, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	got := decodeSchoolPortalData[traegerview.UtilizationChildren](t, rec.Body.Bytes())
	assert.Equal(t, school, got.School.ID)
	require.Len(t, got.Children, 1)
	assert.Equal(t, "Mia", got.Children[0].FirstName)
	assert.Equal(t, 1, got.Children[0].PresentDays)

	outside := traegerOccupancyRequest(t, router, fmt.Sprintf("/traeger/schools/%d/utilization/children?%s", foreign, window), admin, nil)
	assert.Equal(t, http.StatusNotFound, outside.Code, outside.Body.String())
	assert.Contains(t, outside.Body.String(), "traeger.school_not_found")

	logged := func(account int64) int {
		var count int
		require.NoError(t, db.NewRaw(`SELECT count(*) FROM audit.data_access_log
			WHERE tenant_id = ? AND actor_account_id = ? AND resource_type = 'attendance_statistics' AND actor_role = 'traeger'`,
			school, account).Scan(context.Background(), &count))
		return count
	}
	assert.Equal(t, 1, logged(adminID), "the read of the names stands in the school's access log")
	assert.Zero(t, logged(readOnlyID), "a refused read reads nothing")
}

func TestTraegerUtilizationQueryBudget(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	password := testpkg.NewTestPassword()
	organization := traegerOrganization(t, db, "Träger Auslastung Budget", true)
	day := utilizationDay
	addSchool := func(name string) {
		school := testpkg.CreateTestSchoolInOrganization(t, db, organization, name)
		child := testpkg.CreateTestStudentForTenant(t, db, school, "Kind", name, "1a")
		bookings := newOccupancyBookings(t, db, school)
		bookings.book(child.ID, bookings.offering("OGS", true, 10), "approved", nil, nil)
		presence := newUtilizationPresence(t, db, school)
		presence.checkIn(child.ID, day)
		presence.consent(child.ID)
		_, session := presence.room("Raum", 10)
		presence.visit(child.ID, session, day, 13, 14)
	}
	for _, name := range []string{"OGS Eins", "OGS Zwei", "OGS Drei"} {
		addSchool(name)
	}
	account := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, account.ID, identityaccess.TraegerRoleReadOnly)
	code, answer := traegerSignIn(t, router, account.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	path := fmt.Sprintf("/traeger/schools/utilization?from=%s&to=%s", day, utilizationFriday)
	read := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		rec := traegerOccupancyRequest(t, router, path, answer.AccessToken, counter)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		// The series reads are common table expressions: count every read,
		// not only those that start with SELECT.
		return counter.Measurement(counter.Matching(func(sql string) bool {
			sql = strings.TrimSpace(sql)
			return strings.HasPrefix(sql, "select") || strings.HasPrefix(sql, "with")
		}))
	}
	three := read()
	for _, name := range []string{"OGS Vier", "OGS Fünf"} {
		addSchool(name)
	}
	assert.Len(t, read().Statements, len(three.Statements), "the utilization reads the same statements for any number of schools")
	querybudgets.AssertQueryBudget(t, "api.traeger.schools_utilization", three)
}

func TestTraegerUtilizationReadsRefuseOutsideTheAdministrativeTransaction(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	school, _ := testpkg.CreateTestTenant(t, db)
	other, _ := testpkg.CreateTestTenant(t, db)
	day := utilizationDay
	child := testpkg.CreateTestStudentForTenant(t, db, school, "Ida", "Eule", "1a")
	bookings := newOccupancyBookings(t, db, school)
	ogs := bookings.offering("OGS", true, 0)
	bookings.book(child.ID, ogs, "approved", nil, nil)
	presence := newUtilizationPresence(t, db, school)
	presence.checkIn(child.ID, day)
	presence.consent(child.ID)
	room, session := presence.room("Atelier", 8)
	presence.visit(child.ID, session, day, 13, 14)
	// The other school holds everything the reads look for. The
	// administrative transaction bypasses RLS, so only the school filter of
	// each statement keeps it out.
	foreignChild := testpkg.CreateTestStudentForTenant(t, db, other, "Fritz", "Fremd", "1a")
	foreign := newOccupancyBookings(t, db, other)
	foreign.book(foreignChild.ID, foreign.offering("Fremd gebucht", true, 0), "approved", nil, nil)
	foreignPresence := newUtilizationPresence(t, db, other)
	foreignPresence.checkIn(foreignChild.ID, day)
	foreignPresence.consent(foreignChild.ID)
	_, foreignSession := foreignPresence.room("Fremdraum", 8)
	foreignPresence.visit(foreignChild.ID, foreignSession, day, 13, 14)

	ports := traegerUtilizationPorts(nil, time.Now)
	scope := []int64{school}
	reads := func(ctx context.Context) []error {
		_, booked := ports.Bookings.CareOfferingIntervalsByTenant(ctx, scope, day, day, nil)
		_, attendance := ports.Presence.AttendanceCountsByTenant(ctx, scope, day, day)
		_, visits := ports.Presence.RoomVisitDaysByTenant(ctx, scope, day, day)
		_, rooms := ports.Rooms.RoomsByTenant(ctx, scope)
		return []error{booked, attendance, visits, rooms}
	}
	for index, err := range reads(testpkg.TenantContext(school)) {
		assert.Error(t, err, "read %d refuses a tenant transaction", index)
	}
	require.NoError(t, testpkg.WithinAdminContext(t, context.Background(), db, func(adminCtx context.Context) error {
		offerings, err := ports.Bookings.CareOfferingIntervalsByTenant(adminCtx, scope, day, day, []int64{bookings.phase, foreign.phase})
		require.NoError(t, err)
		require.Len(t, offerings, 1, "only the offerings of the given schools")
		require.Len(t, offerings[school], 1)
		assert.Equal(t, ogs, offerings[school][0].ID)
		require.Len(t, offerings[school][0].Bookings, 1)

		attendance, err := ports.Presence.AttendanceCountsByTenant(adminCtx, scope, day, day)
		require.NoError(t, err)
		require.Len(t, attendance, 1)
		assert.Equal(t, map[calendar.Date]int{day: 1}, attendance[school].Counts)

		visits, err := ports.Presence.RoomVisitDaysByTenant(adminCtx, scope, day, day)
		require.NoError(t, err)
		require.Len(t, visits, 1)
		assert.Equal(t, []traegerview.RoomVisitDay{{RoomID: room, Day: day, Children: 1, Peak: 1}}, visits[school].Days)

		rooms, err := ports.Rooms.RoomsByTenant(adminCtx, scope)
		require.NoError(t, err)
		require.Len(t, rooms, 1, "only the rooms of the given schools")
		for _, named := range rooms[school] {
			assert.NotContains(t, named.Name, "Fremdraum")
		}
		return nil
	}))
}
