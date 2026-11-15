package domain

import (
	"testing"
)

func slot(date string, start, end string, breakMinutes int, own bool) PlanSlot {
	return PlanSlot{Date: day(date), Start: clock(start), End: clock(end), BreakMinutes: breakMinutes, Own: own}
}

func clock(value string) int {
	hour := int(value[0]-'0')*10 + int(value[1]-'0')
	minute := int(value[3]-'0')*10 + int(value[4]-'0')
	return hour*60 + minute
}

func kinds(warnings []WorkingTimeWarning) map[string]WorkingTimeWarning {
	result := make(map[string]WorkingTimeWarning, len(warnings))
	for _, warning := range warnings {
		result[warning.Kind] = warning
	}
	return result
}

func TestCheckPlanRefusesOverlapAtAnotherSite(t *testing.T) {
	t.Parallel()
	existing := []PlanSlot{slot("2026-11-16", "08:00", "12:00", 0, false)}
	verdict := CheckPlan(StatutoryWorkingTimeRules(), existing, nil, []PlanSlot{slot("2026-11-16", "11:30", "15:00", 0, true)}, nil)
	if len(verdict.Overlaps) != 1 || verdict.Overlaps[0].Date != day("2026-11-16") {
		t.Fatalf("overlaps = %+v, want the morning at the other site", verdict.Overlaps)
	}
	verdict = CheckPlan(StatutoryWorkingTimeRules(), existing, nil, []PlanSlot{slot("2026-11-16", "12:00", "15:00", 0, true)}, nil)
	if len(verdict.Overlaps) != 0 {
		t.Fatalf("a shift starting when the other ends overlaps: %+v", verdict.Overlaps)
	}
}

func TestCheckPlanWarnsAboutDailyMaximumAndBreaks(t *testing.T) {
	t.Parallel()
	// Vormittags A, nachmittags B: 7 h + 4 h = 11 h net, 30 min gap.
	existing := []PlanSlot{slot("2026-11-16", "07:00", "14:00", 0, false)}
	verdict := CheckPlan(StatutoryWorkingTimeRules(), existing, nil, []PlanSlot{slot("2026-11-16", "14:30", "18:30", 0, true)}, nil)
	found := kinds(verdict.Warnings)
	daily, ok := found[WarningDailyMaximum]
	if !ok || daily.Minutes != 660 || daily.Limit != 600 || !daily.NeedsReason {
		t.Fatalf("daily warning = %+v, want 660 of 600 needing a reason", daily)
	}
	// 11 h of work need 45 min of breaks; the 30 min gap is the only one.
	breaks, ok := found[WarningBreakTooShort]
	if !ok || breaks.Minutes != 30 || breaks.Limit != 45 {
		t.Fatalf("break warning = %+v, want 30 of 45", breaks)
	}

	verdict = CheckPlan(StatutoryWorkingTimeRules(), nil, nil, []PlanSlot{slot("2026-11-16", "08:00", "14:30", 30, true)}, nil)
	if len(verdict.Warnings) != 0 {
		t.Fatalf("6.5 h with 30 min break warns: %+v", verdict.Warnings)
	}
	verdict = CheckPlan(StatutoryWorkingTimeRules(), nil, nil, []PlanSlot{slot("2026-11-16", "08:00", "14:30", 10, true)}, nil)
	if _, ok := kinds(verdict.Warnings)[WarningBreakTooShort]; !ok {
		t.Fatalf("6.5 h with 10 min break does not warn: %+v", verdict.Warnings)
	}
}

func TestCheckPlanWarnsAboutRestPeriodAndShortenedRest(t *testing.T) {
	t.Parallel()
	existing := []PlanSlot{slot("2026-11-16", "12:00", "21:00", 45, false)}
	candidate := []PlanSlot{slot("2026-11-17", "07:00", "12:00", 0, true)}

	verdict := CheckPlan(StatutoryWorkingTimeRules(), existing, nil, candidate, nil)
	rest, ok := kinds(verdict.Warnings)[WarningRestPeriod]
	if !ok || rest.Minutes != 600 || rest.Limit != 660 || !rest.NeedsReason || rest.Date != day("2026-11-17") {
		t.Fatalf("rest warning = %+v, want 10 h of 11 h on the 17th", rest)
	}

	shortened := StatutoryWorkingTimeRules()
	shortened.MinRestMinutes = 600
	verdict = CheckPlan(shortened, existing, nil, candidate, nil)
	found := kinds(verdict.Warnings)
	if _, ok := found[WarningRestPeriod]; ok {
		t.Fatalf("10 h rest with a 10 h rule is a violation: %+v", verdict.Warnings)
	}
	notice, ok := found[WarningRestShortened]
	if !ok || notice.NeedsReason {
		t.Fatalf("shortened rest = %+v, want a notice without reason", notice)
	}

	// The rest before an earlier day counts too: the candidate ends late.
	verdict = CheckPlan(StatutoryWorkingTimeRules(), []PlanSlot{slot("2026-11-17", "06:00", "10:00", 0, false)}, nil,
		[]PlanSlot{slot("2026-11-16", "17:00", "21:00", 0, true)}, nil)
	if rest := kinds(verdict.Warnings)[WarningRestPeriod]; rest.Minutes != 540 {
		t.Fatalf("rest into the next day = %+v, want 9 h", rest)
	}
}

func TestCheckPlanWarnsAboveWeeklySollAcrossSites(t *testing.T) {
	t.Parallel()
	soll := map[string]int{"2026-11-16": 600}
	existing := []PlanSlot{slot("2026-11-16", "08:00", "13:00", 0, false)}
	verdict := CheckPlan(StatutoryWorkingTimeRules(), existing, nil, []PlanSlot{slot("2026-11-18", "08:00", "14:00", 30, true)}, soll)
	above, ok := kinds(verdict.Warnings)[WarningAboveSoll]
	if !ok || above.Minutes != 630 || above.Limit != 600 || above.Date != day("2026-11-16") {
		t.Fatalf("soll warning = %+v, want 630 of 600 in the week of the 16th", above)
	}
}

func TestCheckPlanOnlyReportsWhatTheChangeMakesWorse(t *testing.T) {
	t.Parallel()
	before := slot("2026-11-16", "07:00", "18:30", 60, true)
	// The day is already too long; shortening it must not ask for a reason.
	verdict := CheckPlan(StatutoryWorkingTimeRules(), nil, []PlanSlot{before}, []PlanSlot{slot("2026-11-16", "07:00", "18:00", 60, true)}, nil)
	if len(verdict.Warnings) != 0 {
		t.Fatalf("a shorter day warns: %+v", verdict.Warnings)
	}
	verdict = CheckPlan(StatutoryWorkingTimeRules(), nil, []PlanSlot{before}, []PlanSlot{slot("2026-11-16", "07:00", "19:00", 60, true)}, nil)
	if _, ok := kinds(verdict.Warnings)[WarningDailyMaximum]; !ok {
		t.Fatalf("a longer day does not warn: %+v", verdict.Warnings)
	}
}

func TestDisabledRulesStaySilent(t *testing.T) {
	t.Parallel()
	rules := WorkingTimeRules{}
	verdict := CheckPlan(rules, []PlanSlot{slot("2026-11-16", "07:00", "14:00", 0, false)}, nil,
		[]PlanSlot{slot("2026-11-16", "14:00", "22:00", 0, true), slot("2026-11-17", "05:00", "08:00", 0, true)}, nil)
	if len(verdict.Warnings) != 0 {
		t.Fatalf("rules without limits warn: %+v", verdict.Warnings)
	}
}
