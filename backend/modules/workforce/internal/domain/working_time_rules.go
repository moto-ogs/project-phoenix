package domain

import (
	"slices"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The working-time checks of ADR 0089 section 8 for planning a person over
// all Einsatzorte of the Personalakte. A violation warns; whoever plans
// anyway gives a reason. Overlapping shifts at two schools are refused.

// The kinds of a working-time warning.
const (
	// WarningDailyMaximum: more planned working time on a day than the
	// Träger allows (§ 3 ArbZG, 10 h by default).
	WarningDailyMaximum = "daily_maximum"
	// WarningRestPeriod: less rest between two working days than the
	// Träger's minimum (§ 5 Abs. 1 ArbZG, 11 h by default).
	WarningRestPeriod = "rest_period"
	// WarningRestShortened: the Träger allows a shortened rest (§ 5 Abs. 2
	// ArbZG) and the rest is below 11 h; it needs a compensation later and
	// no reason now.
	WarningRestShortened = "rest_shortened"
	// WarningBreakTooShort: less break on a day than § 4 ArbZG requires.
	WarningBreakTooShort = "break_too_short"
	// WarningAboveSoll: more planned working time in a week than the Soll of
	// all contracts at all Einsatzorte.
	WarningAboveSoll = "above_soll"
)

// StatutoryRestMinutes is the rest of § 5 Abs. 1 ArbZG.
const StatutoryRestMinutes = 11 * 60

// Breaks of § 4 ArbZG: more than six hours of work need 30 minutes, more
// than nine hours 45 minutes, in parts of at least 15 minutes.
const (
	breakAfterSixHours    = 6 * 60
	breakAfterNineHours   = 9 * 60
	breakForSixHours      = 30
	breakForNineHours     = 45
	minimumBreakPart      = 15
	minutesPerDay         = 24 * 60
	statutoryDailyMaximum = 10 * 60
)

// WorkingTimeRules are the Träger's limits. A zero limit switches its check
// off.
type WorkingTimeRules struct {
	MaxDailyMinutes int
	MinRestMinutes  int
	CheckBreaks     bool
}

// StatutoryWorkingTimeRules are the limits of the ArbZG, the defaults of
// the Träger values.
func StatutoryWorkingTimeRules() WorkingTimeRules {
	return WorkingTimeRules{MaxDailyMinutes: statutoryDailyMaximum, MinRestMinutes: StatutoryRestMinutes, CheckBreaks: true}
}

// PlanSlot is one planned shift of the person. Start and End are minutes
// after midnight of Date; shifts never cross midnight. Own marks a shift of
// the school that asks; SchoolID and ShiftID are set only where the caller
// may name them.
type PlanSlot struct {
	SchoolID     int64
	ShiftID      int64
	Date         calendar.Date
	Start        int
	End          int
	BreakMinutes int
	Own          bool
}

func (s PlanSlot) net() int { return s.End - s.Start - s.BreakMinutes }

func (s PlanSlot) overlaps(other PlanSlot) bool {
	return s.Date == other.Date && s.Start < other.End && other.Start < s.End
}

// WorkingTimeWarning is one violation. Date is the day of the violation,
// for WarningRestPeriod the day the short rest ends, for WarningAboveSoll
// the Monday of the week. Minutes is the planned value, Limit the rule.
type WorkingTimeWarning struct {
	Kind        string
	Date        calendar.Date
	Minutes     int
	Limit       int
	NeedsReason bool
}

// PlanVerdict is what a plan change causes: the shifts at other sites it
// overlaps and the warnings it adds or makes worse.
type PlanVerdict struct {
	Overlaps []PlanSlot
	Warnings []WorkingTimeWarning
}

// NeedsReason reports whether planning needs a reason.
func (v PlanVerdict) NeedsReason() bool {
	return slices.ContainsFunc(v.Warnings, func(w WorkingTimeWarning) bool { return w.NeedsReason })
}

// CheckPlan checks replacing before with candidates among the unchanged
// slots of the person. soll maps the Monday of a week (YYYY-MM-DD) to the
// weekly Soll in minutes; a week without Soll is not checked. Only warnings
// the change adds or makes worse are reported, so a correction of an
// existing violation needs no reason.
func CheckPlan(rules WorkingTimeRules, unchanged, before, candidates []PlanSlot, soll map[string]int) PlanVerdict {
	var verdict PlanVerdict
	for _, candidate := range candidates {
		for _, other := range unchanged {
			if !other.Own && candidate.overlaps(other) {
				verdict.Overlaps = append(verdict.Overlaps, other)
			}
		}
	}
	base := EvaluateWorkingTime(rules, slices.Concat(unchanged, before), soll)
	after := EvaluateWorkingTime(rules, slices.Concat(unchanged, candidates), soll)
	for _, warning := range after {
		if !madeWorse(warning, base) {
			continue
		}
		verdict.Warnings = append(verdict.Warnings, warning)
	}
	return verdict
}

func madeWorse(warning WorkingTimeWarning, base []WorkingTimeWarning) bool {
	for _, old := range base {
		if old.Kind != warning.Kind || old.Date != warning.Date {
			continue
		}
		switch warning.Kind {
		case WarningRestPeriod, WarningRestShortened:
			return warning.Minutes < old.Minutes
		case WarningBreakTooShort:
			// A longer day raises the required break: the change makes the
			// day worse even if it brings a gap that counts as break.
			return warning.Limit > old.Limit || warning.Limit-warning.Minutes > old.Limit-old.Minutes
		default:
			return warning.Minutes > old.Minutes
		}
	}
	return true
}

type planDay struct {
	date   calendar.Date
	slots  []PlanSlot
	net    int
	breaks int
}

// EvaluateWorkingTime lists every violation in slots, ordered by day.
func EvaluateWorkingTime(rules WorkingTimeRules, slots []PlanSlot, soll map[string]int) []WorkingTimeWarning {
	days := groupDays(slots)
	var warnings []WorkingTimeWarning
	for i, d := range days {
		if rules.MaxDailyMinutes > 0 && d.net > rules.MaxDailyMinutes {
			warnings = append(warnings, WorkingTimeWarning{Kind: WarningDailyMaximum, Date: d.date, Minutes: d.net, Limit: rules.MaxDailyMinutes, NeedsReason: true})
		}
		if rules.CheckBreaks {
			if required := requiredBreak(d.net); d.breaks < required {
				warnings = append(warnings, WorkingTimeWarning{Kind: WarningBreakTooShort, Date: d.date, Minutes: d.breaks, Limit: required, NeedsReason: true})
			}
		}
		if i > 0 && rules.MinRestMinutes > 0 {
			warnings = append(warnings, restWarnings(rules, days[i-1], d)...)
		}
	}
	return append(warnings, sollWarnings(days, soll)...)
}

func groupDays(slots []PlanSlot) []planDay {
	sorted := slices.Clone(slots)
	slices.SortFunc(sorted, func(a, b PlanSlot) int {
		if c := a.Date.Compare(b.Date); c != 0 {
			return c
		}
		return a.Start - b.Start
	})
	var days []planDay
	for _, s := range sorted {
		if len(days) == 0 || days[len(days)-1].date != s.Date {
			days = append(days, planDay{date: s.Date})
		}
		d := &days[len(days)-1]
		if n := len(d.slots); n > 0 {
			if gap := s.Start - d.slots[n-1].End; gap >= minimumBreakPart {
				d.breaks += gap
			}
		}
		d.slots = append(d.slots, s)
		d.net += s.net()
		d.breaks += s.BreakMinutes
	}
	return days
}

func requiredBreak(net int) int {
	switch {
	case net > breakAfterNineHours:
		return breakForNineHours
	case net > breakAfterSixHours:
		return breakForSixHours
	default:
		return 0
	}
}

func restWarnings(rules WorkingTimeRules, previous, current planDay) []WorkingTimeWarning {
	if previous.date.AddDays(1) != current.date {
		return nil
	}
	lastEnd := slices.MaxFunc(previous.slots, func(a, b PlanSlot) int { return a.End - b.End }).End
	rest := minutesPerDay - lastEnd + current.slots[0].Start
	switch {
	case rest < rules.MinRestMinutes:
		return []WorkingTimeWarning{{Kind: WarningRestPeriod, Date: current.date, Minutes: rest, Limit: rules.MinRestMinutes, NeedsReason: true}}
	case rest < StatutoryRestMinutes:
		return []WorkingTimeWarning{{Kind: WarningRestShortened, Date: current.date, Minutes: rest, Limit: StatutoryRestMinutes}}
	default:
		return nil
	}
}

func sollWarnings(days []planDay, soll map[string]int) []WorkingTimeWarning {
	if len(soll) == 0 {
		return nil
	}
	weeks := map[calendar.Date]int{}
	var order []calendar.Date
	for _, d := range days {
		week := d.date.StartOfISOWeek()
		if _, seen := weeks[week]; !seen {
			order = append(order, week)
		}
		weeks[week] += d.net
	}
	var warnings []WorkingTimeWarning
	for _, week := range order {
		limit := soll[week.String()]
		if limit > 0 && weeks[week] > limit {
			warnings = append(warnings, WorkingTimeWarning{Kind: WarningAboveSoll, Date: week, Minutes: weeks[week], Limit: limit, NeedsReason: true})
		}
	}
	return warnings
}
