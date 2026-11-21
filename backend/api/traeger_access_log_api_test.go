// Router-level tests for the access log of the Träger-Portal (#4655, ADR
// 0084 section 7, ADR 0109): only entries of the Träger's own schools, the
// filters, the CSV export, the right check, and that every answer is itself
// written to the access log of each school it shows.
package api

import (
	"context"
	"encoding/csv"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/auditlog"
	auditCompose "github.com/moto-ogs/project-phoenix/modules/auditlog/compose"
	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// accessLogDay is the fixed Berlin day the fixtures record their entries on.
var accessLogDay = calendar.NewDate(2026, time.October, 20)

func accessLogAt(hour int) time.Time {
	return accessLogDay.BerlinMidnight().Add(time.Duration(hour) * time.Hour)
}

type accessLogEntry struct {
	ID         string      `json:"id"`
	OccurredAt time.Time   `json:"occurred_at"`
	SchoolID   testpkg.ID  `json:"school_id"`
	SchoolName string      `json:"school_name"`
	AccountID  *testpkg.ID `json:"account_id"`
	Person     string      `json:"person"`
	Kind       string      `json:"kind"`
	Data       string      `json:"data"`
	DataLabel  string      `json:"data_label"`
}

type accessLogPage struct {
	Entries []accessLogEntry `json:"entries"`
	HasMore bool             `json:"has_more"`
	AsOf    time.Time        `json:"as_of"`
}

type accessLogPerson struct {
	AccountID testpkg.ID `json:"account_id"`
	Name      string     `json:"name"`
}

func accessLogRequest(t *testing.T, router http.Handler, token, path string, query url.Values) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path+"?"+query.Encode(), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func accessLogWindow(extra map[string]string) url.Values {
	query := url.Values{"from": {accessLogDay.String()}, "to": {accessLogDay.String()}}
	for key, value := range extra {
		query.Set(key, value)
	}
	return query
}

func listAccessLog(t *testing.T, router http.Handler, token string, extra map[string]string) accessLogPage {
	t.Helper()
	rec := accessLogRequest(t, router, token, "/traeger/access-log/", accessLogWindow(extra))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[accessLogPage](t, rec.Body.Bytes())
}

// accessLogPersonAt gives the account a person at the school.
func accessLogPersonAt(t *testing.T, db *bun.DB, school, account int64, first, last string) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO users.persons (tenant_id, first_name, last_name, account_id) VALUES (?, ?, ?, ?)`,
		school, first, last, account)
	require.NoError(t, err)
}

func recordAccessLogRead(t *testing.T, db *bun.DB, school, account int64, resourceType string, at time.Time) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO audit.data_access_log
		(tenant_id, actor_account_id, actor_role, resource_type, range_start, range_end, accessed_at)
		VALUES (?, ?, 'staff', ?, ?, ?, ?)`, school, account, resourceType, at, at, at)
	require.NoError(t, err)
}

// recordAccessLogPersonnelNumberChange records a personnel number change;
// the ledger stores the editing staff member, not the account.
func recordAccessLogPersonnelNumberChange(t *testing.T, db *bun.DB, school, editorStaffID int64, at time.Time) {
	t.Helper()
	staff := testpkg.CreateTestStaffForTenant(t, db, school, "Paula", "Personal")
	_, err := db.ExecContext(context.Background(), `INSERT INTO audit.personnel_number_changes
		(tenant_id, staff_id, changed_by, old_value, new_value, note, occurred_at) VALUES (?, ?, ?, '1', '2', '', ?)`,
		school, staff.ID, editorStaffID, at)
	require.NoError(t, err)
}

// recordAccessLogSystemEdit records an automated change of a child's data:
// the ledger stores the system actor 0 with its name.
func recordAccessLogSystemEdit(t *testing.T, db *bun.DB, school int64, at time.Time) {
	t.Helper()
	student := testpkg.CreateTestStudentForTenant(t, db, school, "Mia", "Muster", "1a")
	_, err := db.ExecContext(context.Background(), `INSERT INTO audit.student_field_edits
		(tenant_id, student_id, edited_by, edited_by_name, field_name, created_at) VALUES (?, ?, 0, 'System', 'school_class', ?)`,
		school, student.ID, at)
	require.NoError(t, err)
}

// traegerAccessLogFixture is a Träger with two schools, a foreign Träger
// with one, and a member of the Träger-Büro with the right to read the
// access log.
type traegerAccessLogFixture struct {
	db                           *bun.DB
	router                       http.Handler
	own, foreign                 int64
	first, second, foreignSchool int64
	staff, otherStaff, member    int64
	otherStaffMember             int64
	token                        string
}

func newTraegerAccessLogFixture(t *testing.T, role string) traegerAccessLogFixture {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	unit := testpkg.TenantRuntime(t, db)
	// The log lists up to the root clock's instant (ADR 0281); it runs on a
	// fixed day after accessLogDay.
	today := calendar.NewDate(2026, time.November, 18)
	router := traegerPortalWithDaysOn(t, db, unit, owners.HolidayTestSchoolCalendar{}, func() calendar.Date { return today },
		func() time.Time { return today.BerlinMidnight().Add(12 * time.Hour) })
	return traegerAccessLogFixtureOn(t, db, router, role)
}

// traegerAccessLogFixtureOn builds the fixture over router.
func traegerAccessLogFixtureOn(t *testing.T, db *bun.DB, router *traegerPortalHandler, role string) traegerAccessLogFixture {
	t.Helper()
	password := testpkg.NewTestPassword()
	f := traegerAccessLogFixture{db: db, router: router}
	f.own = traegerOrganization(t, db, "Träger Protokoll", true)
	f.foreign = traegerOrganization(t, db, "Träger Fremd", true)
	f.first = testpkg.CreateTestSchoolInOrganization(t, db, f.own, "OGS Am Bach")
	f.second = testpkg.CreateTestSchoolInOrganization(t, db, f.own, "OGS Waldweg")
	f.foreignSchool = testpkg.CreateTestSchoolInOrganization(t, db, f.foreign, "OGS Fremd")
	f.staff = testpkg.CreateTestAccount(t, db, "fachkraft").ID
	f.otherStaff = testpkg.CreateTestAccount(t, db, "leitung").ID
	accessLogPersonAt(t, db, f.first, f.staff, "Frieda", "Fachkraft")
	// Lena works at the second school; ledgers name her by account or by
	// her staff ID there.
	lena := testpkg.CreateTestStaffForTenant(t, db, f.second, "Lena", "Leitung")
	_, err := db.ExecContext(context.Background(), `UPDATE users.persons SET account_id = ? WHERE id = ?`, f.otherStaff, lena.PersonID)
	require.NoError(t, err)
	f.otherStaffMember = lena.ID
	account := traegerAccount(t, db, password)
	f.member = account.ID
	testpkg.CreateTestTraegerMember(t, db, f.own, account.ID, role)
	code, answer := traegerSignIn(t, router, account.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	f.token = answer.AccessToken
	return f
}

// traegerAccessReads counts the reads of the Träger-Portal the school's
// access log holds for the account.
func traegerAccessReads(t *testing.T, db *bun.DB, school, account int64, resourceType string) int {
	t.Helper()
	var count int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM audit.data_access_log
		WHERE tenant_id = ? AND actor_account_id = ? AND resource_type = ? AND actor_role = 'traeger'
			AND metadata->>'channel' = 'traeger_portal'`, school, account, resourceType).Scan(context.Background(), &count))
	return count
}

func TestTraegerAccessLogShowsOnlyTheOwnSchoolsAndIsItselfLogged(t *testing.T) {
	t.Parallel()
	f := newTraegerAccessLogFixture(t, identityaccess.TraegerRoleAdministration)
	recordAccessLogRead(t, f.db, f.first, f.staff, "attendance_history", accessLogAt(9))
	recordAccessLogPersonnelNumberChange(t, f.db, f.second, f.otherStaffMember, accessLogAt(10))
	recordAccessLogRead(t, f.db, f.foreignSchool, f.staff, "attendance_history", accessLogAt(11))
	recordAccessLogRead(t, f.db, f.first, f.staff, "attendance_history", accessLogDay.AddDays(-1).BerlinMidnight().Add(12*time.Hour))

	page := listAccessLog(t, f.router, f.token, nil)
	require.Len(t, page.Entries, 2, "the day's entries of the Träger's schools only: %+v", page.Entries)
	assert.False(t, page.HasMore)
	change, read := page.Entries[0], page.Entries[1]
	assert.Equal(t, f.second, change.SchoolID, "newest first")
	assert.Equal(t, "OGS Waldweg", change.SchoolName)
	assert.Equal(t, "Lena Leitung", change.Person, "the ledger stores her staff ID; the log names the person behind it")
	require.NotNil(t, change.AccountID)
	assert.Equal(t, f.otherStaff, *change.AccountID, "and her account, so the person filter finds the change")
	assert.Equal(t, "change", change.Kind)
	assert.Equal(t, "Personalnummer einer Fachkraft", change.DataLabel)
	assert.Equal(t, f.first, read.SchoolID)
	assert.Equal(t, "Frieda Fachkraft", read.Person)
	assert.Equal(t, "read", read.Kind)
	assert.Equal(t, "attendance_history", read.Data)
	assert.Equal(t, "Anwesenheit eines Kindes", read.DataLabel)

	assert.Equal(t, 1, traegerAccessReads(t, f.db, f.first, f.member, "traeger_access_log"), "the answer is in the access log of every school it shows")
	assert.Equal(t, 1, traegerAccessReads(t, f.db, f.second, f.member, "traeger_access_log"))
	assert.Equal(t, 0, traegerAccessReads(t, f.db, f.foreignSchool, f.member, "traeger_access_log"), "a school the answer does not show is not written")
}

func TestTraegerAccessLogFiltersByPersonSchoolPeriodAndKind(t *testing.T) {
	t.Parallel()
	f := newTraegerAccessLogFixture(t, identityaccess.TraegerRoleAdministration)
	recordAccessLogRead(t, f.db, f.first, f.staff, "class_day_view", accessLogAt(9))
	recordAccessLogRead(t, f.db, f.second, f.otherStaff, "staff_financial_view", accessLogAt(10))
	recordAccessLogPersonnelNumberChange(t, f.db, f.second, f.otherStaffMember, accessLogAt(11))

	page := listAccessLog(t, f.router, f.token, map[string]string{"school_id": fmt.Sprint(f.first)})
	require.Len(t, page.Entries, 1)
	assert.Equal(t, f.first, page.Entries[0].SchoolID)

	// The personnel number ledger stores Lena's staff ID; the account filter
	// still finds it (quorum review of #4932).
	page = listAccessLog(t, f.router, f.token, map[string]string{"account_id": fmt.Sprint(f.otherStaff)})
	require.Len(t, page.Entries, 2)
	for _, entry := range page.Entries {
		require.NotNil(t, entry.AccountID)
		assert.Equal(t, f.otherStaff, *entry.AccountID)
	}

	page = listAccessLog(t, f.router, f.token, map[string]string{"kind": "change"})
	require.Len(t, page.Entries, 1)
	assert.Equal(t, "staff_personnel_number", page.Entries[0].Data)

	next := accessLogDay.AddDays(1).String()
	page = listAccessLog(t, f.router, f.token, map[string]string{"from": next, "to": next})
	assert.Empty(t, page.Entries, "a later day holds none of the entries")

	page = listAccessLog(t, f.router, f.token, map[string]string{"school_id": fmt.Sprint(f.foreignSchool)})
	assert.Empty(t, page.Entries, "a school of another Träger reads nothing")

	rec := accessLogRequest(t, f.router, f.token, "/traeger/access-log/people", accessLogWindow(nil))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	people := decodeSchoolPortalData[[]accessLogPerson](t, rec.Body.Bytes())
	assert.Equal(t, []accessLogPerson{{AccountID: testpkg.ID(f.staff), Name: "Frieda Fachkraft"}, {AccountID: testpkg.ID(f.otherStaff), Name: "Lena Leitung"}}, people)
}

func TestTraegerAccessLogRejectsAnInvalidWindow(t *testing.T) {
	t.Parallel()
	f := newTraegerAccessLogFixture(t, identityaccess.TraegerRoleAdministration)
	for name, query := range map[string]url.Values{
		"missing window":  {},
		"reversed window": {"from": {accessLogDay.String()}, "to": {accessLogDay.AddDays(-1).String()}},
		"over a year":     {"from": {accessLogDay.AddDays(-366).String()}, "to": {accessLogDay.String()}},
		"unknown kind":    accessLogWindow(map[string]string{"kind": "deleted"}),
	} {
		t.Run(name, func(t *testing.T) {
			rec := accessLogRequest(t, f.router, f.token, "/traeger/access-log/", query)
			assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
		})
	}
}

func TestTraegerAccessLogRequiresTheAccessLogRight(t *testing.T) {
	t.Parallel()
	for _, role := range []string{identityaccess.TraegerRoleReadOnly, identityaccess.TraegerRoleBilling, identityaccess.TraegerRolePersonnel} {
		t.Run(role, func(t *testing.T) {
			f := newTraegerAccessLogFixture(t, role)
			recordAccessLogRead(t, f.db, f.first, f.staff, "attendance_history", accessLogAt(9))
			for _, path := range []string{"/traeger/access-log/", "/traeger/access-log/people", "/traeger/access-log/export"} {
				rec := accessLogRequest(t, f.router, f.token, path, accessLogWindow(nil))
				assert.Equal(t, http.StatusForbidden, rec.Code, "%s %s", role, path)
			}
			assert.Equal(t, 0, traegerAccessReads(t, f.db, f.first, f.member, "traeger_access_log"), "a refused read leaves no trail")
		})
	}
}

func TestTraegerAccessLogExportsCSVAndLogsTheExport(t *testing.T) {
	t.Parallel()
	f := newTraegerAccessLogFixture(t, identityaccess.TraegerRoleAdministration)
	recordAccessLogRead(t, f.db, f.first, f.staff, "student_health_list_export", accessLogAt(9))
	recordAccessLogRead(t, f.db, f.foreignSchool, f.staff, "attendance_history", accessLogAt(10))

	rec := accessLogRequest(t, f.router, f.token, "/traeger/access-log/export", accessLogWindow(nil))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "text/csv; charset=utf-8", rec.Header().Get("Content-Type"))
	assert.Contains(t, rec.Header().Get("Content-Disposition"), "zugriffsprotokoll-2026-10-20-bis-2026-10-20.csv")
	body := rec.Body.String()
	require.True(t, strings.HasPrefix(body, "\xEF\xBB\xBF"), "spreadsheet programs need the BOM")
	reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(body, "\xEF\xBB\xBF")))
	reader.Comma = ';'
	rows, err := reader.ReadAll()
	require.NoError(t, err)
	require.Equal(t, [][]string{
		{"Datum", "Uhrzeit", "Schule", "Person", "Art", "Daten"},
		{"20.10.2026", "09:00:00", "OGS Am Bach", "Frieda Fachkraft", "Gelesen", "Gesundheitsliste (Export)"},
	}, rows, "only the Träger's school, in Berlin time")
	assert.Equal(t, 1, traegerAccessReads(t, f.db, f.first, f.member, "traeger_access_log_export"))
	assert.Equal(t, 0, traegerAccessReads(t, f.db, f.foreignSchool, f.member, "traeger_access_log_export"))

	// #4718: PDF and Excel hold the same entries, and each export is logged.
	assertTraegerListFormats(t, f.router, f.token, "/traeger/access-log/export?"+accessLogWindow(nil).Encode(), "zugriffsprotokoll-2026-10-20-bis-2026-10-20")
	assert.Equal(t, 3, traegerAccessReads(t, f.db, f.first, f.member, "traeger_access_log_export"), "the PDF and the Excel export are logged like the CSV")
}

func TestTraegerAccessLogQueryBudgetIsFlat(t *testing.T) {
	t.Parallel()
	f := newTraegerAccessLogFixture(t, identityaccess.TraegerRoleAdministration)
	recordAccessLogRead(t, f.db, f.first, f.staff, "attendance_history", accessLogAt(8))
	recordAccessLogPersonnelNumberChange(t, f.db, f.second, f.otherStaffMember, accessLogAt(9))
	list := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, f.db)
		req := httptest.NewRequest(http.MethodGet, "/traeger/access-log/?"+accessLogWindow(nil).Encode(), nil)
		req.Header.Set("Authorization", "Bearer "+f.token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, f.router, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Selects(""))
	}
	first := list()
	for hour := 10; hour < 14; hour++ {
		recordAccessLogRead(t, f.db, f.first, f.staff, "class_day_view", accessLogAt(hour))
		recordAccessLogPersonnelNumberChange(t, f.db, f.second, f.otherStaffMember, accessLogAt(hour))
	}
	assert.Len(t, list().Statements, len(first.Statements), "the access log reads the same statements for any number of entries")
	querybudgets.AssertQueryBudget(t, "api.traeger.access_log", first)
}

// The pages of one list end at its as_of instant, so entries recorded after
// the first page, such as the reads the access log itself records, never
// shift an entry onto the next page twice (quorum review of #4932).
func TestTraegerAccessLogPagesEndAtTheirAsOfInstant(t *testing.T) {
	t.Parallel()
	f := newTraegerAccessLogFixture(t, identityaccess.TraegerRoleAdministration)
	start := accessLogAt(6)
	for i := 0; i < 51; i++ {
		recordAccessLogRead(t, f.db, f.first, f.staff, "attendance_history", start.Add(time.Duration(i)*time.Minute))
	}
	asOf := accessLogAt(12)
	recordAccessLogRead(t, f.db, f.first, f.staff, "class_day_view", accessLogAt(13))
	window := map[string]string{"as_of": asOf.Format(time.RFC3339Nano)}

	first := listAccessLog(t, f.router, f.token, window)
	require.Len(t, first.Entries, 50)
	assert.True(t, first.HasMore)
	assert.True(t, first.AsOf.Equal(asOf), "the list answers the instant it reads up to")
	for _, entry := range first.Entries {
		assert.Equal(t, "attendance_history", entry.Data, "nothing after as_of is listed")
	}
	window["page"] = "2"
	second := listAccessLog(t, f.router, f.token, window)
	require.Len(t, second.Entries, 1)
	assert.False(t, second.HasMore)
	seen := map[string]bool{}
	for _, entry := range append(first.Entries, second.Entries...) {
		assert.False(t, seen[entry.ID], "entry %s is listed twice", entry.ID)
		seen[entry.ID] = true
	}
	assert.Len(t, seen, 51)
}

func TestTraegerAccessLogRejectsOverflowingPage(t *testing.T) {
	t.Parallel()
	f := newTraegerAccessLogFixture(t, identityaccess.TraegerRoleAdministration)
	rec := accessLogRequest(t, f.router, f.token, "/traeger/access-log/", accessLogWindow(map[string]string{"page": fmt.Sprint(math.MaxInt)}))
	assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
}

// An automated change stores the system actor 0: the log shows the stored
// name without an account, and the person filter does not offer it.
func TestTraegerAccessLogShowsTheSystemActorWithoutAnAccount(t *testing.T) {
	t.Parallel()
	f := newTraegerAccessLogFixture(t, identityaccess.TraegerRoleAdministration)
	recordAccessLogRead(t, f.db, f.first, f.staff, "class_day_view", accessLogAt(9))
	recordAccessLogSystemEdit(t, f.db, f.first, accessLogAt(10))

	page := listAccessLog(t, f.router, f.token, map[string]string{"kind": "change"})
	require.Len(t, page.Entries, 1)
	assert.Equal(t, "System", page.Entries[0].Person)
	assert.Nil(t, page.Entries[0].AccountID)

	rec := accessLogRequest(t, f.router, f.token, "/traeger/access-log/people", accessLogWindow(nil))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, []accessLogPerson{{AccountID: testpkg.ID(f.staff), Name: "Frieda Fachkraft"}}, decodeSchoolPortalData[[]accessLogPerson](t, rec.Body.Bytes()))
}

// recordHolidayAccess writes one entry of the audit trail of the holiday
// registrations of a Träger, as the review writes it (#5326).
func recordHolidayAccess(t *testing.T, db *bun.DB, organization, period int64, registration *int64, action string, account int64, at time.Time) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO enrollment.holiday_registration_audit
		(organization_id, holiday_period_id, holiday_registration_id, action, actor_account_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?)`,
		organization, period, registration, action, account, at)
	require.NoError(t, err)
}

func traegerOfficeAccount(t *testing.T, db *bun.DB, organization int64) (int64, string) {
	t.Helper()
	var row struct {
		ID    int64  `bun:"id"`
		Email string `bun:"email"`
	}
	require.NoError(t, db.NewRaw(`SELECT account.id, account.email FROM platform.organization_accounts AS member
		JOIN auth.accounts AS account ON account.id = member.account_id WHERE member.organization_id = ?`, organization).
		Scan(context.Background(), &row))
	return row.ID, row.Email
}

// Opening a holiday registration, opening its proof, exporting the
// registrations and changing one belong to the Träger, not to a school; the
// access log shows them with the Träger-Büro person, and never those of
// another Träger (#5326).
func TestTraegerAccessLogShowsTheHolidayRegistrationTrailOfTheOwnTraeger(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Protokoll Ferien")
	foreign := newTraegerOffice(t, f.db, f.traeger, "Träger Fremd Ferien", identityaccess.TraegerRoleAdministration)
	foreignPeriod := createHolidayPeriod(t, f.traeger, foreign, januaryHolidays(foreign))
	member, email := traegerOfficeAccount(t, f.db, f.office.organization)
	foreignMember, _ := traegerOfficeAccount(t, f.db, foreign.organization)
	registration := f.siblings
	recordHolidayAccess(t, f.db, f.office.organization, int64(f.period.ID), &registration, "read", member, accessLogAt(9))
	recordHolidayAccess(t, f.db, f.office.organization, int64(f.period.ID), &registration, "proof", member, accessLogAt(10))
	recordHolidayAccess(t, f.db, f.office.organization, int64(f.period.ID), nil, "export", member, accessLogAt(11))
	recordHolidayAccess(t, f.db, f.office.organization, int64(f.period.ID), &registration, "confirm", member, accessLogAt(12))
	recordHolidayAccess(t, f.db, foreign.organization, int64(foreignPeriod.ID), nil, "list", foreignMember, accessLogAt(13))

	page := listAccessLog(t, f.traeger, f.office.token, nil)
	require.Len(t, page.Entries, 4, "the Träger's own holiday trail only: %+v", page.Entries)
	person := email + " (Träger-Büro)"
	for i, want := range []struct{ kind, data, label string }{
		{"change", "holiday_registration_confirm", "Ferienanmeldung bestätigt"},
		{"read", "holiday_registration_export", "Ferienanmeldungen (Export)"},
		{"read", "holiday_registration_proof", "Nachweis aus einer Ferienanmeldung"},
		{"read", "holiday_registration_read", "Ferienanmeldung"},
	} {
		entry := page.Entries[i]
		assert.Equal(t, want.kind, entry.Kind, "entry %d", i)
		assert.Equal(t, want.data, entry.Data, "entry %d", i)
		assert.Equal(t, want.label, entry.DataLabel, "entry %d", i)
		assert.Equal(t, person, entry.Person, "entry %d", i)
		require.NotNil(t, entry.AccountID)
		assert.Equal(t, member, *entry.AccountID)
		assert.Zero(t, entry.SchoolID, "a holiday registration belongs to the Träger, not to a school")
		assert.Equal(t, "Träger (keine Schule)", entry.SchoolName)
	}

	assert.Len(t, listAccessLog(t, f.traeger, f.office.token, map[string]string{"kind": "read"}).Entries, 3)
	assert.Len(t, listAccessLog(t, f.traeger, f.office.token, map[string]string{"account_id": fmt.Sprint(member)}).Entries, 4)
	assert.Empty(t, listAccessLog(t, f.traeger, f.office.token, map[string]string{"school_id": fmt.Sprint(f.office.schools[0])}).Entries,
		"a school filter shows the school's entries only")

	rec := accessLogRequest(t, f.traeger, f.office.token, "/traeger/access-log/people", accessLogWindow(nil))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, []accessLogPerson{{AccountID: testpkg.ID(member), Name: person}}, decodeSchoolPortalData[[]accessLogPerson](t, rec.Body.Bytes()))

	rec = accessLogRequest(t, f.traeger, f.office.token, "/traeger/access-log/export", accessLogWindow(nil))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(rec.Body.String(), "\xEF\xBB\xBF")))
	reader.Comma = ';'
	rows, err := reader.ReadAll()
	require.NoError(t, err)
	require.Len(t, rows, 5)
	assert.Equal(t, []string{"20.10.2026", "10:00:00", "Träger (keine Schule)", person, "Gelesen", "Nachweis aus einer Ferienanmeldung"}, rows[3])
}

// The pages merge the school trail and the holiday trail by time: no entry
// is lost or listed twice across the page boundary (#5326).
func TestTraegerAccessLogPagesMergeTheSchoolAndTheHolidayTrail(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Protokoll Seiten")
	member, _ := traegerOfficeAccount(t, f.db, f.office.organization)
	school := f.office.schools[0]
	start := accessLogAt(6)
	for i := 0; i < 30; i++ {
		at := start.Add(time.Duration(2*i) * time.Minute)
		recordAccessLogRead(t, f.db, school, member, "attendance_history", at)
		recordHolidayAccess(t, f.db, f.office.organization, int64(f.period.ID), nil, "list", member, at.Add(time.Minute))
	}

	first := listAccessLog(t, f.traeger, f.office.token, nil)
	require.Len(t, first.Entries, 50)
	assert.True(t, first.HasMore)
	second := listAccessLog(t, f.traeger, f.office.token, map[string]string{"page": "2", "as_of": first.AsOf.Format(time.RFC3339Nano)})
	require.Len(t, second.Entries, 10)
	assert.False(t, second.HasMore)

	entries := append(first.Entries, second.Entries...)
	seen := map[string]bool{}
	for i, entry := range entries {
		key := fmt.Sprint(entry.SchoolID, "/", entry.ID)
		assert.False(t, seen[key], "entry %s is listed twice", key)
		seen[key] = true
		if i > 0 {
			assert.False(t, entry.OccurredAt.After(entries[i-1].OccurredAt), "entry %d is newer than the one before", i)
		}
		wantHoliday := i%2 == 0
		assert.Equal(t, wantHoliday, entry.SchoolID == 0, "entry %d alternates between the trails", i)
	}
	assert.Len(t, seen, 60)
}

// A deleted account leaves its holiday entries without an account; a person
// read the data, so the log names an unknown person, not an automated
// process (#5326).
func TestTraegerAccessLogNamesTheDeletedAccountOfAHolidayEntryUnknown(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Protokoll Gelöscht")
	_, err := f.db.ExecContext(context.Background(), `INSERT INTO enrollment.holiday_registration_audit
		(organization_id, holiday_period_id, action, actor_account_id, occurred_at) VALUES (?, ?, 'export', NULL, ?)`,
		f.office.organization, f.period.ID, accessLogAt(9))
	require.NoError(t, err)

	page := listAccessLog(t, f.traeger, f.office.token, nil)
	require.Len(t, page.Entries, 1)
	assert.Equal(t, "Unbekannte Person", page.Entries[0].Person)
	assert.Nil(t, page.Entries[0].AccountID)
}

// The access log lists up to the database time, the clock that stamps every
// ledger it reads (ADR 0281, Nachtrag). With the root clock years ahead of
// the database, a read and a guardian change recorded through the root's
// compositions are listed, and the list reads up to the database's instant,
// not the root clock's.
func TestTraegerAccessLogListsUpToTheDatabaseTime(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	unit := testpkg.TenantRuntime(t, db)
	rootNow := time.Date(2031, time.March, 30, 9, 0, 0, 0, calendar.Berlin)
	clock := func() time.Time { return rootNow }
	router := traegerPortalWithDaysOn(t, db, unit, owners.HolidayTestSchoolCalendar{}, calendar.TodayDate, clock)
	f := traegerAccessLogFixtureOn(t, db, router, identityaccess.TraegerRoleAdministration)
	student := testpkg.CreateTestStudentForTenant(t, db, f.first, "Mia", "Muster", "1a")
	guardian := testpkg.CreateTestGuardianProfileForTenant(t, db, f.first, "Erika", "Muster", "erika-root-clock@example.test")
	audits, err := auditCompose.NewTenantPersistence(db, clock)
	require.NoError(t, err)
	require.NoError(t, testpkg.WithinTenantContext(t, context.Background(), db, f.first, func(ctx context.Context) error {
		require.NoError(t, audits.DataAccessLog.Create(ctx, &auditModels.DataAccessLog{
			ActorAccountID: f.staff, ActorRole: "staff", ResourceType: "attendance_history", RangeStart: rootNow, RangeEnd: rootNow,
		}))
		return owners.ParentGuardianChanges().RecordGuardianChanges(ctx, []auditlog.GuardianChange{{
			StudentID: student.ID, GuardianProfileID: guardian.ID, ActorAccountID: &f.staff,
			ChangeType: auditlog.GuardianChangeTypeContact, FieldName: auditlog.GuardianFieldPhones,
		}})
	}))
	var databaseNow time.Time
	require.NoError(t, db.NewRaw(`SELECT clock_timestamp()`).Scan(context.Background(), &databaseNow))
	day := calendar.DateFromTime(databaseNow)

	rec := accessLogRequest(t, f.router, f.token, "/traeger/access-log/", url.Values{"from": {day.String()}, "to": {day.String()}})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	page := decodeSchoolPortalData[accessLogPage](t, rec.Body.Bytes())
	assert.WithinDuration(t, databaseNow, page.AsOf, time.Minute, "the list reads up to the database time")
	data := make([]string, 0, len(page.Entries))
	for _, entry := range page.Entries {
		data = append(data, entry.Data)
	}
	assert.ElementsMatch(t, []string{"attendance_history", "guardian_record"}, data)
}

// A Träger without schools still has its holiday trail. Its first page ends
// at the database time, which stamps that trail, and the next page reads up
// to that instant: an entry recorded after the first page neither shifts an
// entry onto the second page twice nor appears there.
func TestTraegerAccessLogWithoutSchoolsEndsAtTheDatabaseTime(t *testing.T) {
	t.Parallel()
	db, router := newHolidayPeriodPortal(t)
	office := newTraegerOffice(t, db, router, "Träger Ohne Schulen", identityaccess.TraegerRoleAdministration)
	period := createHolidayPeriod(t, router, office, januaryHolidays(office))
	successor := traegerOrganization(t, db, "Träger Nachfolge", true)
	_, err := db.ExecContext(context.Background(), `UPDATE platform.schools SET organization_id = ? WHERE id IN (?, ?)`,
		successor, office.schools[0], office.schools[1])
	require.NoError(t, err)
	member, _ := traegerOfficeAccount(t, db, office.organization)
	databaseNow := testpkg.DatabaseNow(t, db)
	for i := 1; i <= 51; i++ {
		recordHolidayAccess(t, db, office.organization, int64(period.ID), nil, "list", member, databaseNow.Add(-time.Duration(i)*time.Second))
	}
	day := calendar.DateFromTime(databaseNow)
	// Entries beyond the database bound must not use up the SQL page limit.
	for i := 1; i <= 51; i++ {
		recordHolidayAccess(t, db, office.organization, int64(period.ID), nil, "export", member, databaseNow.Add(time.Hour+time.Duration(i)*time.Second))
	}
	window := url.Values{"from": {day.AddDays(-1).String()}, "to": {day.AddDays(1).String()}}

	rec := accessLogRequest(t, router, office.token, "/traeger/access-log/", window)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	first := decodeSchoolPortalData[accessLogPage](t, rec.Body.Bytes())
	require.Len(t, first.Entries, 50)
	assert.True(t, first.HasMore)
	require.False(t, first.AsOf.IsZero(), "the list answers the instant it reads up to")
	assert.WithinDuration(t, databaseNow, first.AsOf, time.Minute, "the list reads up to the database time")

	_, err = db.ExecContext(context.Background(), `INSERT INTO enrollment.holiday_registration_audit
		(organization_id, holiday_period_id, action, actor_account_id) VALUES (?, ?, 'export', ?)`, office.organization, period.ID, member)
	require.NoError(t, err)
	window.Set("as_of", first.AsOf.Format(time.RFC3339Nano))
	window.Set("page", "2")
	rec = accessLogRequest(t, router, office.token, "/traeger/access-log/", window)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	second := decodeSchoolPortalData[accessLogPage](t, rec.Body.Bytes())
	seen := map[string]bool{}
	for _, entry := range append(first.Entries, second.Entries...) {
		assert.False(t, seen[entry.ID], "entry %s is listed twice", entry.ID)
		assert.NotEqual(t, "holiday_registration_export", entry.Data, "nothing after as_of is listed")
		seen[entry.ID] = true
	}
	assert.GreaterOrEqual(t, len(seen), 51, "every entry before as_of is listed once")
}
