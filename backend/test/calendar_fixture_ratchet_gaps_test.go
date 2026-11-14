package test

import (
	"strings"
	"testing"
)

// Regression cases for the gaps of TestCalendarFixtureClockRatchet found in
// the audit of 14.10.2026 (#4027). Gap b (sharedkernel/calendar imported as
// timezone or tz) is covered by every fixture here and in
// calendar_fixture_ratchet_test.go.

func TestCalendarFixtureRatchetDetectsShiftedLiveDateArguments(t *testing.T) {
	t.Parallel()

	root := writeCalendarFixtureSource(t, "parentportal/pickup_test.go", shiftedLiveDateFixture)
	writeCalendarFixtureSourceAt(t, root, "parentportal/clean_test.go", shiftedLiveDateNegativeFixture)

	findings, err := scanCalendarFixtureClockRisks(root)
	if err != nil {
		t.Fatal(err)
	}
	requireCalendarFinding(t, findings,
		"TestPickupArgument", "TestPickupStructField", "TestPickupAssignedField", "TestPickupRequestBody",
		"TestPickupThroughHelperParameter", "TestPickupThroughShiftedHelper", "TestPickupDayArithmetic",
		calendarShiftRisk,
	)
	requireNoCalendarFindingIn(t, findings, "parentportal/clean_test.go")
}

// shiftedLiveDateFixture hands shifted live dates to code under test in
// every shape gap a covers.
const shiftedLiveDateFixture = `package parentportal
import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)
type Request struct { Day timezone.Date }
func tomorrow() timezone.Date { return timezone.TodayDate().AddDays(1) }
func submit(svc Service, day timezone.Date) error { return svc.Submit(day) }
func TestPickupArgument(t *testing.T) {
	t.Parallel()
	_, _ = svc.SubmitPickupChangeRequest(ctx, 1, timezone.TodayDate().AddDays(3), "x")
}
func TestPickupStructField(t *testing.T) {
	t.Parallel()
	_ = svc.Create(ctx, Request{Day: timezone.TodayDate().AddDays(2)})
}
func TestPickupAssignedField(t *testing.T) {
	t.Parallel()
	today := timezone.TodayDate()
	var request Request
	request.Day = today.AddDays(5)
	_ = svc.Create(ctx, request)
}
func TestPickupRequestBody(t *testing.T) {
	t.Parallel()
	body, _ := json.Marshal(map[string]string{"day": timezone.TodayDate().AddDays(4).String()})
	req := httptest.NewRequest("POST", "/pickup", bytes.NewReader(body))
	router.ServeHTTP(httptest.NewRecorder(), req)
}
func TestPickupThroughHelperParameter(t *testing.T) {
	t.Parallel()
	_ = submit(svc, timezone.TodayDate().AddDays(3))
}
func TestPickupThroughShiftedHelper(t *testing.T) {
	t.Parallel()
	_ = svc.Submit(tomorrow())
}
func TestPickupDayArithmetic(t *testing.T) {
	t.Parallel()
	now := time.Now()
	_ = svc.Submit(timezone.NewDate(now.Year(), now.Month(), now.Day()+1))
}
`

// shiftedLiveDateNegativeFixture holds the current day of an operation,
// fixed dates and shifted live dates that reach no code under test.
const shiftedLiveDateNegativeFixture = `package parentportal
import (
	"fmt"
	"testing"
	"github.com/stretchr/testify/assert"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)
func label(day timezone.Date) string { return day.String() }
func TestCurrentDayOfTheOperation(t *testing.T) {
	t.Parallel()
	_ = svc.CheckIn(ctx, timezone.TodayDate())
}
func TestFixedDayShifted(t *testing.T) {
	t.Parallel()
	_ = svc.Submit(timezone.NewDate(2026, 3, 18).AddDays(3))
}
func TestShiftedDayOnlyInTestCode(t *testing.T) {
	t.Parallel()
	later := timezone.TodayDate().AddDays(3)
	t.Logf("day %s", later)
	_ = fmt.Sprintf("%s", label(later))
	assert.NotEmpty(t, later.String())
	insert := func(day timezone.Date) { _ = day }
	insert(later)
	_ = got.After(later)
}
func TestShiftedDayInSQLFixture(t *testing.T) {
	t.Parallel()
	later := timezone.TodayDate().AddDays(-1)
	_, _ = db.NewUpdate().TableExpr("users.memberships").Set("enrolled_until = ?", later).Exec(ctx)
	_ = db.NewRaw("INSERT INTO x (day) VALUES (?)", later).Scan(ctx)
}
`

func TestCalendarFixtureRatchetDetectsShiftedLiveInstants(t *testing.T) {
	t.Parallel()

	root := writeCalendarFixtureSource(t, "reminders/schedule_test.go", `package reminders
import (
	"testing"
	"time"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)
func TestBerlinMidnightNextDay(t *testing.T) {
	t.Parallel()
	_ = svc.Schedule(ctx, timezone.Today().Add(24*time.Hour))
}
func TestNowShiftedByCalendarDays(t *testing.T) {
	t.Parallel()
	_ = svc.Schedule(ctx, time.Now().AddDate(0, 0, 2))
}
func TestNowVariableShiftedByWholeDays(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	_ = svc.Expire(ctx, now.Add(-3*24*time.Hour))
}
func TestLiveDateMidnightShifted(t *testing.T) {
	t.Parallel()
	_ = svc.Schedule(ctx, timezone.TodayDate().BerlinMidnight().Add(48*time.Hour))
}
func TestBerlinMidnightAsCalendarDay(t *testing.T) {
	t.Parallel()
	_ = timezone.DateFromTime(timezone.Today())
}
func TestPlainInstants(t *testing.T) {
	t.Parallel()
	_ = svc.Record(ctx, time.Now())
	_ = svc.Record(ctx, time.Now().Add(2*time.Hour))
	_ = svc.Since(ctx, time.Now().Add(-90*time.Minute))
	_ = svc.Record(ctx, time.Date(2026, 3, 18, 8, 0, 0, 0, timezone.Berlin).Add(24*time.Hour))
	_ = svc.Record(ctx, timezone.NewDate(2027, 3, 28).BerlinMidnight().Add(8*time.Hour))
}
// Midnight plus hours is a wall-clock time an hour off on a clock-change day.
func TestLiveMidnightPlusHours(t *testing.T) {
	t.Parallel()
	_ = svc.Record(ctx, timezone.Today().Add(8*time.Hour))
	_ = svc.Record(ctx, timezone.TodayDate().BerlinMidnight().Add(23*time.Hour))
}
`)

	findings, err := scanCalendarFixtureClockRisks(root)
	if err != nil {
		t.Fatal(err)
	}
	requireCalendarFinding(t, findings,
		"TestBerlinMidnightNextDay", "TestNowShiftedByCalendarDays", "TestNowVariableShiftedByWholeDays",
		"TestLiveDateMidnightShifted", "TestLiveMidnightPlusHours", calendarShiftRisk,
		"TestBerlinMidnightAsCalendarDay: live instant converted to a calendar date",
	)
	requireNoCalendarFindingIn(t, findings, "TestPlainInstants")
}

func TestCalendarFixtureRatchetFollowsTestSupportPackages(t *testing.T) {
	t.Parallel()

	root := writeCalendarFixtureSource(t, "test/fixtures.go", `package test
import "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
type Row struct {
	ID        int64
	Name      string
	StartDate calendar.Date
}
type Submitter interface { Submit(calendar.Date) error }
func TodayDate() calendar.Date { return calendar.TodayDate() }
func NextCareDay() calendar.Date { return calendar.TodayDate().AddDays(3) }
func SubmitFor(svc Submitter, day calendar.Date) { _ = svc.Submit(day) }
func CreateRow() *Row { return &Row{ID: 1, Name: "row", StartDate: calendar.TodayDate()} }
`)
	writeCalendarFixtureSourceAt(t, root, "test/request_fixture.go", `package test
import "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
func CreatePendingRequest(svc Submitter) { _ = svc.Submit(calendar.TodayDate().AddDays(3)) }
`)
	writeCalendarFixtureSourceAt(t, root, "care/support_test.go", testSupportConsumerFixture)

	findings, err := scanCalendarFixtureClockRisks(root)
	if err != nil {
		t.Fatal(err)
	}
	requireCalendarFinding(t, findings,
		"care/support_test.go:9: TestSupportWeekday: live clock feeds a day or ISO-week expectation",
		"TestSupportExpectation: live calendar date used as an expectation",
		"TestSupportShiftedHelper: "+calendarShiftRisk,
		"TestSupportHelperParameter: "+calendarShiftRisk,
		"test/request_fixture.go:3: CreatePendingRequest: "+calendarShiftRisk,
	)
	requireNoCalendarFindingIn(t, findings, "TestSupportRowFixture")
}

// testSupportConsumerFixture calls the helpers of the shared test package
// through its usual import name.
const testSupportConsumerFixture = `package care_test
import (
	"testing"
	"github.com/stretchr/testify/assert"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)
func TestSupportWeekday(t *testing.T) {
	t.Parallel()
	_ = testpkg.TodayDate().Weekday()
}
func TestSupportExpectation(t *testing.T) {
	t.Parallel()
	assert.Equal(t, testpkg.TodayDate(), got.Day)
}
func TestSupportShiftedHelper(t *testing.T) {
	t.Parallel()
	_ = svc.Submit(testpkg.NextCareDay())
}
func TestSupportHelperParameter(t *testing.T) {
	t.Parallel()
	testpkg.SubmitFor(svc, testpkg.TodayDate().AddDays(1))
}
func TestSupportRowFixture(t *testing.T) {
	t.Parallel()
	row := testpkg.CreateRow()
	assert.Equal(t, row.ID, got.ID)
	assert.Equal(t, row.Name, got.Name)
}
`

func TestCalendarFixtureRatchetFollowsFunctionValueAliases(t *testing.T) {
	t.Parallel()

	root := writeCalendarFixtureSource(t, "sample/alias_helpers_test.go", `package sample
import (
	"time"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)
var TodayDate = timezone.TodayDate
var now = time.Now
var fixedDay = timezone.NewDate(2026, 3, 18)
`)
	writeCalendarFixtureSourceAt(t, root, "sample/alias_test.go", `package sample
import (
	"testing"
	"github.com/stretchr/testify/assert"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)
func TestAliasWeekday(t *testing.T) {
	t.Parallel()
	_ = TodayDate().Weekday()
}
func TestAliasExpectation(t *testing.T) {
	t.Parallel()
	assert.Equal(t, TodayDate(), got.Day)
}
func TestAliasInstant(t *testing.T) {
	t.Parallel()
	_ = timezone.DateFromTime(now())
}
func TestFixedValue(t *testing.T) {
	t.Parallel()
	_ = fixedDay.Weekday()
	assert.Equal(t, fixedDay, got.Day)
}
`)

	findings, err := scanCalendarFixtureClockRisks(root)
	if err != nil {
		t.Fatal(err)
	}
	requireCalendarFinding(t, findings,
		"TestAliasWeekday: live clock feeds a day or ISO-week expectation",
		"TestAliasExpectation: live calendar date used as an expectation",
		"TestAliasInstant: live instant converted to a calendar date",
	)
	requireNoCalendarFindingIn(t, findings, "TestFixedValue")
}

func TestCalendarShiftDebtFreezesFilesShrinkOnly(t *testing.T) {
	t.Parallel()

	findings := []calendarClockFinding{
		{file: "a_test.go", function: "TestA", line: 1, risk: calendarShiftRisk},
		{file: "a_test.go", function: "TestA", line: 2, risk: calendarShiftRisk},
		{file: "b_test.go", function: "TestB", line: 1, risk: calendarShiftRisk},
		{file: "c_test.go", function: "TestC", line: 1, risk: "live calendar date used as an expectation"},
	}
	for _, tc := range []struct {
		name     string
		debt     map[string]int
		kept     []string
		problems []string
	}{
		{name: "matching entries", debt: map[string]int{"a_test.go": 2, "b_test.go": 1}, kept: []string{"c_test.go"}},
		{name: "file over its entry", debt: map[string]int{"a_test.go": 1, "b_test.go": 1},
			kept: []string{"a_test.go", "a_test.go", "c_test.go"}, problems: []string{"a_test.go: 2 shifted-live-date finding(s), debt entry 1; fix"}},
		{name: "file without an entry", debt: map[string]int{"a_test.go": 2},
			kept: []string{"b_test.go", "c_test.go"}, problems: []string{"b_test.go: 1 shifted-live-date finding(s), debt entry 0; fix"}},
		{name: "file under its entry", debt: map[string]int{"a_test.go": 3, "b_test.go": 1},
			kept: []string{"c_test.go"}, problems: []string{"a_test.go: 2 shifted-live-date finding(s), debt entry 3; lower the entry to 2"}},
		{name: "stale entry", debt: map[string]int{"a_test.go": 2, "b_test.go": 1, "gone_test.go": 4},
			kept: []string{"c_test.go"}, problems: []string{"gone_test.go: debt entry 4 has no finding left; delete the entry"}},
		{name: "other categories have no debt", debt: map[string]int{"a_test.go": 2, "b_test.go": 1, "c_test.go": 1},
			kept: []string{"c_test.go"}, problems: []string{"c_test.go: debt entry 1 has no finding left"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			kept, problems := applyCalendarShiftDebt(append([]calendarClockFinding(nil), findings...), tc.debt)
			assertCalendarDebtOutcome(t, kept, problems, tc.kept, tc.problems)
		})
	}
}

func assertCalendarDebtOutcome(t *testing.T, kept []calendarClockFinding, problems, wantKept, wantProblems []string) {
	t.Helper()

	files := make([]string, 0, len(kept))
	for _, finding := range kept {
		files = append(files, finding.file)
	}
	if strings.Join(files, ",") != strings.Join(wantKept, ",") {
		t.Errorf("kept findings in %v, want %v", files, wantKept)
	}
	if len(problems) != len(wantProblems) {
		t.Fatalf("problems %q, want %d matching %q", problems, len(wantProblems), wantProblems)
	}
	for i, want := range wantProblems {
		if !strings.HasPrefix(problems[i], want) {
			t.Errorf("problem %q does not start with %q", problems[i], want)
		}
	}
}

func requireNoCalendarFindingIn(t *testing.T, findings []calendarClockFinding, unwanted string) {
	t.Helper()

	for _, finding := range formatCalendarClockFindings(findings) {
		if strings.Contains(finding, unwanted) {
			t.Errorf("clean source %q triggered %q", unwanted, finding)
		}
	}
}
