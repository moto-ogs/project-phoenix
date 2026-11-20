package daychangesviewhttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

func TestMain(m *testing.M) { testpkg.PerTestTenants(); testutil.SeedTestJWTConfig(); testpkg.Run(m) }

// day is the fixed school day of the tests; no wall clock (Rule 14).
var day = calendar.NewDate(2026, 9, 9)

type wirePerson struct {
	Name   string `json:"name"`
	Role   string `json:"role"`
	IsSelf bool   `json:"is_self"`
}

type wireEntry struct {
	Kind     string       `json:"kind"`
	Section  string       `json:"section"`
	Since    *string      `json:"since"`
	Until    *string      `json:"until"`
	StartsAt *time.Time   `json:"starts_at"`
	EndsAt   *time.Time   `json:"ends_at"`
	People   []wirePerson `json:"people"`
	Group    *struct {
		Name string `json:"name"`
	} `json:"group"`
	Link *struct {
		Target string `json:"target"`
	} `json:"link"`
	Count *int `json:"count"`
}

type wireOverview struct {
	Date    string `json:"date"`
	Sources []struct {
		Source string `json:"source"`
		Status string `json:"status"`
	} `json:"sources"`
	Entries []wireEntry `json:"entries"`
}

func newRouter(t *testing.T, db *testpkg.DB, today calendar.Date) chi.Router {
	t.Helper()
	resource, err := api.NewDayChangesTestResource(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), today)
	require.NoError(t, err)
	router := chi.NewRouter()
	router.Use(api.RequestIdentityCacheMiddleware)
	router.Mount("/api/day-changes", resource.Router(api.ProtectedTenantRoutes))
	return router
}

func read(t *testing.T, router chi.Router, accountID int64, tenantID int64, perms ...string) (wireOverview, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/day-changes/today", nil)
	req.Header.Set("Authorization", "Bearer "+testutil.MintTestJWT(t, testutil.TenantUserTestClaims(int(accountID), tenantID, perms...)))
	rec := testutil.ExecuteRequestForTest(t, router, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var envelope struct {
		Data wireOverview `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope))
	return envelope.Data, rec.Body.String()
}

// summary renders the entries as "section kind names group since until count".
func summary(entries []wireEntry) []string {
	lines := make([]string, 0, len(entries))
	for _, entry := range entries {
		line := entry.Section + " " + entry.Kind
		for _, person := range entry.People {
			line += fmt.Sprintf(" %s/%s", person.Name, person.Role)
			if person.IsSelf {
				line += "(du)"
			}
		}
		if entry.Group != nil {
			// Group fixtures carry a unique suffix after the name.
			name, _, _ := strings.Cut(entry.Group.Name, "-")
			line += " @" + name
		}
		if entry.Since != nil {
			line += " seit " + *entry.Since
		}
		if entry.Until != nil {
			line += " bis " + *entry.Until
		}
		if entry.StartsAt != nil && entry.EndsAt != nil {
			line += " " + entry.StartsAt.In(calendar.Berlin).Format("15:04") + "-" + entry.EndsAt.In(calendar.Berlin).Format("15:04")
		}
		if entry.Count != nil {
			line += fmt.Sprintf(" n=%d", *entry.Count)
		}
		if entry.Link != nil {
			line += " ->" + entry.Link.Target
		}
		lines = append(lines, line)
	}
	return lines
}

// TestDayChangesStaffSource is Seam 1 for the Personal source: one school
// with care staff, a lead, an account without rights and a second school,
// read through the route against the test database.
func TestDayChangesStaffSource(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)

	carer, carerAccount := testpkg.CreateTestTeacherWithAccount(t, db, "Anna", "Betreuung")
	igel := testpkg.CreateTestEducationGroup(t, db, "Igel")
	testpkg.CreateTestGroupTeacher(t, db, igel.ID, carer.ID)
	colleague := testpkg.CreateTestTeacher(t, db, "Ben", "Kollege")
	testpkg.CreateTestGroupTeacher(t, db, igel.ID, colleague.ID)
	testpkg.CreateTestStaffAbsenceSpan(t, db, tenantID, colleague.StaffID, day, day.AddDays(2), "Grippe Ben")
	other := testpkg.CreateTestStaff(t, db, "Clara", "Andere")
	testpkg.CreateTestStaffAbsenceSpan(t, db, tenantID, other.ID, day.AddDays(-3), day, "Grippe Clara")
	yesterday := testpkg.CreateTestStaff(t, db, "Emil", "Gestern")
	testpkg.CreateTestStaffAbsenceSpan(t, db, tenantID, yesterday.ID, day.AddDays(-1), day.AddDays(-1), "Grippe Emil")
	fuchs := testpkg.CreateTestEducationGroup(t, db, "Fuchs")
	jumper := testpkg.CreateTestStaff(t, db, "Sara", "Springer")
	testpkg.CreateTestGroupSubstitution(t, db, fuchs.ID, nil, jumper.ID, day, day)
	helper := testpkg.CreateTestStaff(t, db, "Tom", "Hilfe")
	testpkg.CreateTestGroupSubstitution(t, db, igel.ID, nil, helper.ID, day, day.AddDays(1))
	_, leadAccount := testpkg.CreateTestStaffWithAccount(t, db, "Lea", "Leitung")
	_, plainAccount := testpkg.CreateTestStaffWithAccount(t, db, "Zoe", "Ohne")

	t.Run("other school", func(t *testing.T) {
		testpkg.OwnTenant(t)
		foreign := testpkg.CreateTestStaff(t, db, "Xaver", "Fremd")
		testpkg.CreateTestStaffAbsenceSpan(t, db, testpkg.Tenant(t), foreign.ID, day, day, "Grippe Xaver")
	})

	router := newRouter(t, db, day)

	t.Run("care staff sees names for its group and numbers for the school", func(t *testing.T) {
		overview, body := read(t, router, carerAccount.ID, tenantID, "users:read")
		assert.Equal(t, day.String(), overview.Date)
		require.Len(t, overview.Sources, 1)
		assert.Equal(t, "staff", overview.Sources[0].Source)
		assert.Equal(t, "loaded", overview.Sources[0].Status)
		assert.Equal(t, []string{
			"you group_substitution Tom Hilfe/substitute @Igel bis 2026-09-10 ->group_handovers",
			"you staff_absent Ben Kollege/absent bis 2026-09-11 ->staff_member",
			"school group_substitution_count n=1 ->group_handovers",
			"school staff_absent_count n=1 ->staff_list",
		}, summary(overview.Entries))
		assertNoReason(t, body)
	})

	t.Run("care staff without users:read keeps its own entries and gets no numbers", func(t *testing.T) {
		overview, _ := read(t, router, carerAccount.ID, tenantID)
		assert.Equal(t, []string{
			"you group_substitution Tom Hilfe/substitute @Igel bis 2026-09-10 ->group_handovers",
			"you staff_absent Ben Kollege/absent bis 2026-09-11",
		}, summary(overview.Entries))
		assert.Equal(t, "loaded", overview.Sources[0].Status)
	})

	t.Run("lead sees every name of the school and no other school", func(t *testing.T) {
		overview, body := read(t, router, leadAccount.ID, tenantID, "users:read", "vacation:approve")
		assert.Equal(t, []string{
			"school group_substitution Sara Springer/substitute @Fuchs ->group_handovers",
			"school group_substitution Tom Hilfe/substitute @Igel bis 2026-09-10 ->group_handovers",
			"school staff_absent Ben Kollege/absent bis 2026-09-11 ->staff_absences",
			"school staff_absent Clara Andere/absent seit 2026-09-06 ->staff_absences",
		}, summary(overview.Entries))
		assert.NotContains(t, body, "Emil", "an absence of yesterday is not today's")
		assert.NotContains(t, body, "Xaver", "another school stays out")
		assertNoReason(t, body)
	})

	t.Run("account without the rights gets no entries and no failure", func(t *testing.T) {
		overview, _ := read(t, router, plainAccount.ID, tenantID)
		assert.Empty(t, overview.Entries)
		require.Len(t, overview.Sources, 1)
		assert.Equal(t, "loaded", overview.Sources[0].Status)
	})

	t.Run("the day before shows that day only", func(t *testing.T) {
		overview, body := read(t, newRouter(t, db, day.AddDays(-1)), leadAccount.ID, tenantID, "vacation:approve")
		assert.Equal(t, []string{
			"school staff_absent Emil Gestern/absent ->staff_absences",
			"school staff_absent Clara Andere/absent seit 2026-09-06 bis 2026-09-09 ->staff_absences",
		}, summary(overview.Entries))
		assert.NotContains(t, body, "Ben", "an absence from tomorrow is not on the day before")
	})

	t.Run("a cover sees the team of the group it covers today by name", func(t *testing.T) {
		biber := testpkg.CreateTestEducationGroup(t, db, "Biber")
		regular := testpkg.CreateTestTeacher(t, db, "Rita", "Biber")
		testpkg.CreateTestGroupTeacher(t, db, biber.ID, regular.ID)
		testpkg.CreateTestStaffAbsenceSpan(t, db, tenantID, regular.StaffID, day, day, "Grippe Rita")
		cover, coverAccount := testpkg.CreateTestStaffWithAccount(t, db, "Nora", "Vertretung")
		testpkg.CreateTestGroupSubstitution(t, db, biber.ID, nil, cover.ID, day, day)

		overview, _ := read(t, router, coverAccount.ID, tenantID)
		assert.Equal(t, []string{
			"you group_substitution Nora Vertretung/substitute(du) @Biber ->group_handovers",
			"you staff_absent Rita Biber/absent",
		}, summary(overview.Entries))
	})

	t.Run("own absence has a link only with time_tracking:own", func(t *testing.T) {
		testpkg.CreateTestStaffAbsenceSpan(t, db, tenantID, carer.StaffID, day, day, "Eigener Grund")

		withoutPermission, _ := read(t, router, carerAccount.ID, tenantID)
		ownWithoutPermission := ownAbsence(t, withoutPermission.Entries)
		assert.Nil(t, ownWithoutPermission.Link)

		withPermission, _ := read(t, router, carerAccount.ID, tenantID, "time_tracking:own")
		ownWithPermission := ownAbsence(t, withPermission.Entries)
		require.NotNil(t, ownWithPermission.Link)
		assert.Equal(t, "own_absences", ownWithPermission.Link.Target)
	})
}

func ownAbsence(t *testing.T, entries []wireEntry) wireEntry {
	t.Helper()
	for _, entry := range entries {
		if entry.Kind != "staff_absent" {
			continue
		}
		for _, person := range entry.People {
			if person.IsSelf {
				return entry
			}
		}
	}
	require.Fail(t, "own absence missing")
	return wireEntry{}
}

// assertNoReason proves the Personal answer carries no reason: neither the
// note, nor the substitution's reason, nor the absence type.
func assertNoReason(t *testing.T, body string) {
	t.Helper()
	for _, leak := range []string{"Grippe", "Test substitution", "sick", "absence_type", "reason", "note"} {
		assert.NotContains(t, body, leak)
	}
}

// TestDayChangesShiftSource is Seam 1 for the Dienstplan part of the
// Personal source (#7661): one school with care staff, colleagues, a lead of
// the Dienstplan, an account without rights and a second school.
func TestDayChangesShiftSource(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	sick, talk := "Krankheit", "Personalgespräch"
	yesterday := day.AddDays(-1)

	carer, carerAccount := testpkg.CreateTestTeacherWithAccount(t, db, "Anna", "Betreuung")
	annaSeries := testpkg.CreateTestStaffShiftSeries(t, db, carer.StaffID, day)
	testpkg.CreateTestStaffShiftChange(t, db, carer.StaffID, yesterday, testpkg.StaffShiftChange{Series: &annaSeries})
	testpkg.CreateTestStaffShiftChange(t, db, carer.StaffID, day, testpkg.StaffShiftChange{Series: &annaSeries, Detached: true, StartHHMM: "10:00", EndHHMM: "14:00"})
	// A withdrawn sick report leaves the occurrence detached at the series' times.
	same := testpkg.CreateTestStaff(t, db, "Dora", "Gleich")
	doraSeries := testpkg.CreateTestStaffShiftSeries(t, db, same.ID, day)
	testpkg.CreateTestStaffShiftChange(t, db, same.ID, yesterday, testpkg.StaffShiftChange{Series: &doraSeries})
	testpkg.CreateTestStaffShiftChange(t, db, same.ID, day, testpkg.StaffShiftChange{Series: &doraSeries, Detached: true})
	moved := testpkg.CreateTestStaff(t, db, "Fritz", "Verschoben")
	fritzSeries := testpkg.CreateTestStaffShiftSeries(t, db, moved.ID, day)
	testpkg.CreateTestStaffShiftChange(t, db, moved.ID, day.AddDays(1), testpkg.StaffShiftChange{Series: &fritzSeries, Slot: &day, Detached: true})
	colleague, colleagueAccount := testpkg.CreateTestStaffWithAccount(t, db, "Ben", "Kollege")
	cancelled := testpkg.CreateTestStaffShiftChange(t, db, colleague.ID, day, testpkg.StaffShiftChange{Cancelled: true, ChangeReason: &talk, StartHHMM: "12:00", EndHHMM: "16:00"})
	cover := testpkg.CreateTestStaff(t, db, "Tom", "Hilfe")
	testpkg.CreateTestStaffShiftChange(t, db, cover.ID, day, testpkg.StaffShiftChange{Covers: &cancelled.ID, StartHHMM: "12:00", EndHHMM: "15:00"})
	ill := testpkg.CreateTestStaff(t, db, "Clara", "Krank")
	absence := testpkg.CreateTestStaffAbsenceSpan(t, db, tenantID, ill.ID, day, day, "Grippe Clara")
	testpkg.CreateTestStaffShiftChange(t, db, ill.ID, day, testpkg.StaffShiftChange{Cancelled: true, ChangeReason: &sick, SickAbsence: &absence})
	standalone := testpkg.CreateTestStaff(t, db, "Gerd", "Einzeln")
	testpkg.CreateTestStaffShiftChange(t, db, standalone.ID, day, testpkg.StaffShiftChange{StartHHMM: "07:00", EndHHMM: "07:30"})
	before := testpkg.CreateTestStaff(t, db, "Emil", "Gestern")
	testpkg.CreateTestStaffShiftChange(t, db, before.ID, yesterday, testpkg.StaffShiftChange{Cancelled: true})
	_, leadAccount := testpkg.CreateTestStaffWithAccount(t, db, "Lea", "Leitung")
	_, plainAccount := testpkg.CreateTestStaffWithAccount(t, db, "Zoe", "Ohne")

	t.Run("other school", func(t *testing.T) {
		testpkg.OwnTenant(t)
		foreign := testpkg.CreateTestStaff(t, db, "Xaver", "Fremd")
		testpkg.CreateTestStaffShiftChange(t, db, foreign.ID, day, testpkg.StaffShiftChange{Cancelled: true})
	})

	router := newRouter(t, db, day)

	t.Run("care staff sees only its own changed shift", func(t *testing.T) {
		overview, body := read(t, router, carerAccount.ID, tenantID, "time_tracking:own")
		assert.Equal(t, []string{
			"you shift_changed Anna Betreuung/on_duty(du) 10:00-14:00 ->own_shift_plan",
		}, summary(overview.Entries))
		require.Len(t, overview.Sources, 1)
		assert.Equal(t, "loaded", overview.Sources[0].Status)
		assert.NotContains(t, body, "Ben", "another person's shift stays with the lead")
		assertNoShiftReason(t, body)
	})

	t.Run("care staff sees its cancelled shift and who covers it", func(t *testing.T) {
		overview, body := read(t, router, colleagueAccount.ID, tenantID, "time_tracking:own")
		assert.Equal(t, []string{
			"you shift_cancelled Ben Kollege/on_duty(du) 12:00-16:00 ->own_shift_plan",
			"you shift_replacement Tom Hilfe/substitute Ben Kollege/replaced(du) 12:00-15:00",
		}, summary(overview.Entries))
		assertNoShiftReason(t, body)
	})

	t.Run("lead of the Dienstplan sees every changed shift of the school", func(t *testing.T) {
		overview, body := read(t, router, leadAccount.ID, tenantID, "time_tracking:manage")
		assert.Equal(t, []string{
			"school shift_cancelled Ben Kollege/on_duty 12:00-16:00 ->shift_plan",
			"school shift_cancelled Fritz Verschoben/on_duty ->shift_plan",
			"school shift_changed Anna Betreuung/on_duty 10:00-14:00 ->shift_plan",
			"school shift_replacement Tom Hilfe/substitute Ben Kollege/replaced 12:00-15:00 ->shift_plan",
			"school staff_absent Clara Krank/absent ->staff_absences",
		}, summary(overview.Entries))
		for _, absent := range []string{"Dora", "Gerd", "Emil", "Xaver"} {
			assert.NotContains(t, body, absent, "unchanged times, a standalone shift, yesterday and another school stay out")
		}
		assertNoShiftReason(t, body)
	})

	t.Run("account without the rights gets no shifts and no failure", func(t *testing.T) {
		overview, _ := read(t, router, plainAccount.ID, tenantID)
		assert.Empty(t, overview.Entries)
		require.Len(t, overview.Sources, 1)
		assert.Equal(t, "loaded", overview.Sources[0].Status)
	})

	t.Run("the day before shows that day only", func(t *testing.T) {
		overview, _ := read(t, newRouter(t, db, yesterday), leadAccount.ID, tenantID, "time_tracking:manage")
		assert.Equal(t, []string{
			"school shift_cancelled Emil Gestern/on_duty 08:00-16:00 ->shift_plan",
		}, summary(overview.Entries))
	})
}

// assertNoShiftReason proves no reason of an absence or a cancellation
// reaches the answer.
func assertNoShiftReason(t *testing.T, body string) {
	t.Helper()
	assertNoReason(t, body)
	for _, leak := range []string{"Personalgespräch", "Krankheit", "change_reason"} {
		assert.NotContains(t, body, leak)
	}
}

// TestDayChangesQueryBudget proves the statement count does not grow with
// the number of absences, substitutions and changed shifts.
func TestDayChangesQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	tenantID := testpkg.Tenant(t)
	carer, account := testpkg.CreateTestTeacherWithAccount(t, db, "Budget", "Betreuung")
	group := testpkg.CreateTestEducationGroup(t, db, "Budget-Gruppe")
	testpkg.CreateTestGroupTeacher(t, db, group.ID, carer.ID)
	router := newRouter(t, db, day)
	counter := testpkg.CaptureQueries(t, db)
	var statements testpkg.QueryMeasurement
	baseline := 0
	for round, n := range []int{1, 4} {
		for created := baseline; created < n; created++ {
			colleague := testpkg.CreateTestTeacher(t, db, "Budget", fmt.Sprintf("Kollege-%d", created))
			testpkg.CreateTestGroupTeacher(t, db, group.ID, colleague.ID)
			testpkg.CreateTestStaffAbsenceSpan(t, db, tenantID, colleague.StaffID, day, day, "")
			other := testpkg.CreateTestEducationGroup(t, db, fmt.Sprintf("Budget-%d", created))
			jumper := testpkg.CreateTestStaff(t, db, "Budget", fmt.Sprintf("Springer-%d", created))
			testpkg.CreateTestGroupSubstitution(t, db, other.ID, nil, jumper.ID, day, day)
			testpkg.CreateTestStaffShiftChange(t, db, jumper.ID, day, testpkg.StaffShiftChange{Cancelled: true})
		}
		baseline = n
		counter.Reset()
		overview, _ := read(t, router, account.ID, tenantID, "users:read", "vacation:approve", "time_tracking:manage")
		require.Len(t, overview.Entries, 3*n)
		measured := counter.Measurement(counter.Queries())
		if round > 0 {
			require.Len(t, measured.Statements, len(statements.Statements), "statements must not grow with the rows")
		}
		statements = measured
	}
	querybudgets.AssertQueryBudget(t, "api.day_changes.today", statements)
}
