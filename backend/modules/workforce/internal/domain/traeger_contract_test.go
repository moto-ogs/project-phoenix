package domain

import (
	"errors"
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var (
	siteA = ContractSite{SchoolID: 1, StaffID: 10}
	siteB = ContractSite{SchoolID: 2, StaffID: 20}
)

func day(s string) calendar.Date {
	d, err := calendar.ParseDate(s)
	if err != nil {
		panic(err)
	}
	return d
}

func TestBuildSollPlanFollowsVersionsAndContractEnd(t *testing.T) {
	t.Parallel()
	contracts := []TraegerStaffContract{
		{ID: 1, Kind: ContractKindPartTime, StartsOn: day("2026-08-01"), EndsOn: day("2026-12-31"), Targets: []ContractTarget{
			{ContractSite: siteA, ValidFrom: day("2026-10-01"), WeekdayMinutes: []int{300, 300, 300, 300, 0}},
			{ContractSite: siteA, ValidFrom: day("2026-08-01"), WeekdayMinutes: []int{240, 240, 240, 240, 240}},
			{ContractSite: siteB, ValidFrom: day("2026-08-01"), WeekdayMinutes: []int{0, 0, 0, 0, 180}},
		}, HolidayWeeks: []ContractHolidayWeek{
			{ContractSite: siteA, WeekStart: day("2026-10-12"), WeekdayMinutes: []int{480, 480, 480, 480, 480}},
			{ContractSite: siteB, WeekStart: day("2026-10-12"), WeekdayMinutes: []int{0, 0, 0, 0, 0}},
		}},
		{ID: 2, Kind: ContractKindMinijob, StartsOn: day("2027-02-01"), Targets: []ContractTarget{
			{ContractSite: siteA, ValidFrom: day("2027-02-01"), WeekdayMinutes: []int{60, 60, 60, 60, 60}},
		}},
	}
	plan := BuildSollPlan(siteA, contracts)
	if !plan.Governs || plan.Start != day("2026-08-01") {
		t.Fatalf("plan governs %v from %s, want from 2026-08-01", plan.Governs, plan.Start)
	}
	want := []SollSegment{
		{ValidFrom: day("2026-08-01"), ValidUntil: day("2026-10-01")},
		{ValidFrom: day("2026-10-01"), ValidUntil: day("2027-01-01")},
		{ValidFrom: day("2027-02-01")},
	}
	if len(plan.Segments) != len(want) {
		t.Fatalf("segments = %+v", plan.Segments)
	}
	for i, segment := range plan.Segments {
		if segment.ValidFrom != want[i].ValidFrom || segment.ValidUntil != want[i].ValidUntil {
			t.Fatalf("segment %d = %s..%s, want %s..%s", i, segment.ValidFrom, segment.ValidUntil, want[i].ValidFrom, want[i].ValidUntil)
		}
	}
	if len(plan.HolidayWeeks) != 1 || plan.HolidayWeeks[0].ContractID != 1 {
		t.Fatalf("holiday weeks = %+v, want the one of school 1 with its contract", plan.HolidayWeeks)
	}
	if other := BuildSollPlan(ContractSite{SchoolID: 3, StaffID: 30}, contracts); other.Governs {
		t.Fatal("a site without a Soll must stay with its school")
	}
}

func TestSollPlanFromKeepsTheClosedPast(t *testing.T) {
	t.Parallel()
	plan := SollPlan{Site: siteA, Governs: true, Segments: []SollSegment{
		{ValidFrom: day("2026-08-01"), ValidUntil: day("2026-10-01"), WeekdayMinutes: []int{1, 1, 1, 1, 1}},
		{ValidFrom: day("2026-10-01"), WeekdayMinutes: []int{2, 2, 2, 2, 2}},
	}, HolidayWeeks: []ContractHolidayWeek{{WeekStart: day("2026-10-26")}, {WeekStart: day("2026-11-02")}}}
	clipped := plan.From(day("2026-11-01"))
	if len(clipped.Segments) != 1 || clipped.Segments[0].ValidFrom != day("2026-11-01") || clipped.Segments[0].WeekdayMinutes[0] != 2 {
		t.Fatalf("clipped segments = %+v", clipped.Segments)
	}
	if len(clipped.HolidayWeeks) != 1 || clipped.HolidayWeeks[0].WeekStart != day("2026-11-02") {
		t.Fatalf("clipped weeks = %+v", clipped.HolidayWeeks)
	}
	rows := clipped.ScheduleRows()
	if len(rows) != ContractWeekdays || rows[4].DayOfWeek != 4 || rows[0].ValidUntil != "" || rows[0].RotationLength != 1 {
		t.Fatalf("schedule rows = %+v", rows)
	}
	overrides := clipped.HolidayOverrides()
	if len(overrides) != 1 || overrides[0].EndDate != "2026-11-06" || overrides[0].TraegerContractID == nil {
		t.Fatalf("overrides = %+v", overrides)
	}
}

func TestValidateContractRefusesOverlapAtOneEinsatzort(t *testing.T) {
	t.Parallel()
	live := []ContractSite{siteA, siteB}
	running := TraegerStaffContract{ID: 1, Kind: ContractKindPartTime, StartsOn: day("2026-08-01"), Targets: []ContractTarget{
		{ContractSite: siteA, ValidFrom: day("2026-08-01"), WeekdayMinutes: []int{60, 60, 60, 60, 60}},
	}}
	second := TraegerStaffContract{Kind: ContractKindMinijob, StartsOn: day("2026-09-01"), Targets: []ContractTarget{
		{ContractSite: siteA, ValidFrom: day("2026-09-01"), WeekdayMinutes: []int{60, 60, 60, 60, 60}},
	}}
	if err := ValidateContract(second, live, []TraegerStaffContract{running}); !errors.Is(err, ErrContractOverlap) {
		t.Fatalf("err = %v, want overlap", err)
	}
	second.Targets[0].ContractSite = siteB
	if err := ValidateContract(second, live, []TraegerStaffContract{running}); err != nil {
		t.Fatalf("another Einsatzort may hold a second contract: %v", err)
	}
	running.EndsOn = day("2026-08-31")
	second.Targets[0].ContractSite = siteA
	if err := ValidateContract(second, live, []TraegerStaffContract{running}); err != nil {
		t.Fatalf("a contract after the end of the first one is fine: %v", err)
	}
}

func TestValidateContractChecksSitesSollAndWeeks(t *testing.T) {
	t.Parallel()
	base := func() TraegerStaffContract {
		return TraegerStaffContract{Kind: ContractKindFullTime, StartsOn: day("2026-08-01"), EndsOn: day("2026-12-31"), Targets: []ContractTarget{
			{ContractSite: siteA, ValidFrom: day("2026-08-01"), WeekdayMinutes: []int{480, 480, 480, 480, 480}},
		}}
	}
	cases := map[string]func(*TraegerStaffContract){
		"unknown kind":           func(c *TraegerStaffContract) { c.Kind = "ehrenamt" },
		"end before start":       func(c *TraegerStaffContract) { c.EndsOn = day("2026-07-31") },
		"no Soll":                func(c *TraegerStaffContract) { c.Targets = nil },
		"foreign Einsatzort":     func(c *TraegerStaffContract) { c.Targets[0].ContractSite = ContractSite{SchoolID: 9, StaffID: 90} },
		"four weekdays":          func(c *TraegerStaffContract) { c.Targets[0].WeekdayMinutes = []int{1, 2, 3, 4} },
		"thirteen hours":         func(c *TraegerStaffContract) { c.Targets[0].WeekdayMinutes[2] = 780 },
		"Soll after the end":     func(c *TraegerStaffContract) { c.Targets[0].ValidFrom = day("2027-01-04") },
		"week on a Tuesday":      func(c *TraegerStaffContract) { c.HolidayWeeks = []ContractHolidayWeek{week(siteA, "2026-10-13")} },
		"week without Soll site": func(c *TraegerStaffContract) { c.HolidayWeeks = []ContractHolidayWeek{week(siteB, "2026-10-12")} },
		"week after the end":     func(c *TraegerStaffContract) { c.HolidayWeeks = []ContractHolidayWeek{week(siteA, "2027-01-04")} },
		"week twice": func(c *TraegerStaffContract) {
			c.HolidayWeeks = []ContractHolidayWeek{week(siteA, "2026-10-12"), week(siteA, "2026-10-12")}
		},
	}
	for name, mutate := range cases {
		contract := base()
		mutate(&contract)
		if err := ValidateContract(contract, []ContractSite{siteA, siteB}, nil); !errors.Is(err, ErrContractInvalid) {
			t.Errorf("%s: err = %v, want invalid", name, err)
		}
	}
	valid := base()
	valid.HolidayWeeks = []ContractHolidayWeek{week(siteA, "2026-10-12")}
	if err := ValidateContract(valid, []ContractSite{siteA}, nil); err != nil {
		t.Fatalf("valid contract refused: %v", err)
	}
}

func week(site ContractSite, start string) ContractHolidayWeek {
	return ContractHolidayWeek{ContractSite: site, WeekStart: day(start), WeekdayMinutes: []int{0, 0, 0, 0, 0}}
}

func TestFirstMirrorDayIsTheCurrentMonthOrAfterTheLastClosedOne(t *testing.T) {
	t.Parallel()
	today := day("2026-11-14")
	if got := FirstMirrorDay(today, nil); got != day("2026-11-01") {
		t.Fatalf("without a closed month = %s, want 2026-11-01", got)
	}
	closed := []*StaffMonthBalanceSnapshot{{Year: 2026, Month: 10}, {Year: 2026, Month: 11}}
	if got := FirstMirrorDay(today, closed); got != day("2026-12-01") {
		t.Fatalf("with November closed = %s, want 2026-12-01", got)
	}
	december := []*StaffMonthBalanceSnapshot{{Year: 2026, Month: 12}}
	if got := FirstMirrorDay(day("2026-12-20"), december); got != day("2027-01-01") {
		t.Fatalf("after a closed December = %s, want 2027-01-01", got)
	}
	err := RejectBeforeMirrorDay("valid_from", 1, day("2026-10-01"), day("2026-11-01"))
	var contractErr *ContractError
	if !errors.As(err, &contractErr) || !errors.Is(err, ErrContractMonthClosed) || contractErr.FirstOpenDay != day("2026-11-01") {
		t.Fatalf("err = %v, want closed month with its first open day", err)
	}
}
