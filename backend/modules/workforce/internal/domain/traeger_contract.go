package domain

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The Arbeitsvertrag of ADR 0089 section 1 (#4706): a contract of a
// Personalstamm with its kind, its validity, its Soll per Einsatzort from a
// day on and its Ferien-Soll per holiday week. Workforce mirrors the Soll
// into the time tracking of every Einsatzort; the rules below decide what
// the mirror writes and which changes the closed months still allow.

// Kinds of a contract. They are the kinds a school knows for an employment
// (users.staff.employment_type); Übungsleiter and Ehrenamt follow in #4712.
const (
	ContractKindFullTime = "full_time"
	ContractKindPartTime = "part_time"
	ContractKindMinijob  = "minijob"
)

// ContractKinds lists every kind in display order.
var ContractKinds = []string{ContractKindPartTime, ContractKindFullTime, ContractKindMinijob}

// ContractWeekdays is the number of weekdays a Soll names: Monday to Friday.
const ContractWeekdays = 5

// MaxContractDailyMinutes caps one day's Soll at twelve hours, as the
// school's schedule does.
const MaxContractDailyMinutes = 720

// Trail fields of a contract change.
const (
	StaffChangeFieldContract     = "contract"
	StaffChangeFieldContractSoll = "contract_soll"
	StaffChangeFieldHolidayWeek  = "holiday_week"
	StaffChangeAdded             = "added"
	StaffChangeRemoved           = "removed"
)

var (
	// ErrContractInvalid refuses a contract, a Soll or a holiday week;
	// ContractError names the field.
	ErrContractInvalid = errors.New("traeger staff contract invalid")
	// ErrContractOverlap refuses a second contract for one Einsatzort on the
	// same days.
	ErrContractOverlap = errors.New("traeger staff contracts overlap at one Einsatzort")
	// ErrContractMonthClosed refuses a change that reaches into a month an
	// Einsatzort has closed, or before the current month.
	ErrContractMonthClosed = errors.New("traeger staff contract change reaches a closed month")
	// ErrContractMissing answers a contract the record does not hold.
	ErrContractMissing = errors.New("traeger staff contract not found")
	// ErrHolidayWeekSchoolOverride refuses a holiday week that a
	// Sonderarbeitszeit of the school already covers.
	ErrHolidayWeekSchoolOverride = errors.New("traeger holiday week overlaps a school target override")
	// ErrStaffSollKeptByTraeger refuses a school's change of the Soll of an
	// employment whose contract the Träger keeps.
	ErrStaffSollKeptByTraeger = errors.New("the Träger keeps the Soll of this employment")
)

// ContractError carries the refused field and, for a closed month, the first
// day a change may start on.
type ContractError struct {
	Kind         error
	Field        string
	Reason       string
	SchoolID     int64
	FirstOpenDay calendar.Date
}

func (e *ContractError) Error() string {
	return fmt.Sprintf("%s: %s: %s", e.Kind, e.Field, e.Reason)
}

func (e *ContractError) Unwrap() error { return e.Kind }

func contractInvalid(field, format string, args ...any) error {
	return &ContractError{Kind: ErrContractInvalid, Field: field, Reason: fmt.Sprintf(format, args...)}
}

// TraegerStaffContract is one contract with its Soll versions and holiday
// weeks. EndsOn is the last day, zero while open.
type TraegerStaffContract struct {
	ID             int64
	OrganizationID int64
	RecordID       int64
	Kind           string
	StartsOn       calendar.Date
	EndsOn         calendar.Date
	Targets        []ContractTarget
	HolidayWeeks   []ContractHolidayWeek
	CreatedAt      time.Time
}

// ContractSite is one Einsatzort of a contract: the employment StaffID of
// SchoolID.
type ContractSite struct {
	SchoolID int64
	StaffID  int64
}

// ContractTarget is the Soll at one Einsatzort from ValidFrom on.
type ContractTarget struct {
	ContractSite
	ValidFrom      calendar.Date
	WeekdayMinutes []int
}

// ContractHolidayWeek is the Ferien-Soll of the week starting on WeekStart (a
// Monday) at one Einsatzort.
type ContractHolidayWeek struct {
	ContractSite
	ContractID     int64
	WeekStart      calendar.Date
	WeekdayMinutes []int
}

// Covers reports whether the contract runs on d.
func (c TraegerStaffContract) Covers(d calendar.Date) bool {
	start, end := c.StartsOn, c.EndsOn
	return !d.Before(start) && (end == "" || !d.After(end))
}

// Sites lists the Einsatzorte the contract names a Soll for, in the order
// they first appear.
func (c TraegerStaffContract) Sites() []ContractSite {
	var sites []ContractSite
	for _, target := range c.Targets {
		if !slices.Contains(sites, target.ContractSite) {
			sites = append(sites, target.ContractSite)
		}
	}
	return sites
}

// ValidateContractTerms checks kind and validity.
func ValidateContractTerms(kind string, startsOn, endsOn calendar.Date) error {
	if !slices.Contains(ContractKinds, kind) {
		return contractInvalid("kind", "unknown contract kind %q", kind)
	}
	if startsOn.IsZero() {
		return contractInvalid("starts_on", "the first day is required")
	}
	if !endsOn.IsZero() && endsOn.Before(startsOn) {
		return contractInvalid("ends_on", "the last day lies before the first day")
	}
	return nil
}

// ValidateWeekdayMinutes checks a Soll of Monday to Friday.
func ValidateWeekdayMinutes(field string, minutes []int) error {
	if len(minutes) != ContractWeekdays {
		return contractInvalid(field, "a Soll names Monday to Friday")
	}
	for _, value := range minutes {
		if value < 0 || value > MaxContractDailyMinutes {
			return contractInvalid(field, "a day's Soll lies between 0 and %d hours", MaxContractDailyMinutes/60)
		}
	}
	return nil
}

// ValidateContract checks a whole contract against the Einsatzorte of its
// record (live) and the record's other contracts: every Soll and holiday
// week names a live Einsatzort and starts inside the contract, and no
// Einsatzort belongs to two contracts on one day. An Einsatzort may join a
// running contract: its first Soll then starts later than the contract.
func ValidateContract(contract TraegerStaffContract, live []ContractSite, others []TraegerStaffContract) error {
	if err := ValidateContractTerms(contract.Kind, contract.StartsOn, contract.EndsOn); err != nil {
		return err
	}
	if len(contract.Targets) == 0 {
		return contractInvalid("targets", "a contract names the Soll of at least one Einsatzort")
	}
	for _, target := range contract.Targets {
		if !slices.Contains(live, target.ContractSite) {
			return contractInvalid("targets", "school %d is no Einsatzort of this record", target.SchoolID)
		}
		if err := ValidateWeekdayMinutes("targets", target.WeekdayMinutes); err != nil {
			return err
		}
		if target.ValidFrom.IsZero() || !contract.Covers(target.ValidFrom) {
			return contractInvalid("valid_from", "the Soll starts inside the contract")
		}
	}
	if err := validateHolidayWeeks(contract); err != nil {
		return err
	}
	return rejectSiteOverlap(contract, others)
}

func validateHolidayWeeks(contract TraegerStaffContract) error {
	sites := contract.Sites()
	type weekKey struct {
		site  ContractSite
		start calendar.Date
	}
	seen := make(map[weekKey]bool)
	for _, week := range contract.HolidayWeeks {
		if week.WeekStart.IsZero() || week.WeekStart.Weekday() != time.Monday {
			return contractInvalid("week_start", "a holiday week starts on a Monday")
		}
		if !slices.Contains(sites, week.ContractSite) {
			return contractInvalid("school_id", "school %d has no Soll in this contract", week.SchoolID)
		}
		if !contract.Covers(week.WeekStart) || !contract.Covers(week.WeekStart.AddDays(ContractWeekdays-1)) {
			return contractInvalid("week_start", "the holiday week lies inside the contract")
		}
		if err := ValidateWeekdayMinutes("weekday_minutes", week.WeekdayMinutes); err != nil {
			return err
		}
		key := weekKey{site: week.ContractSite, start: week.WeekStart}
		if seen[key] {
			return contractInvalid("week_start", "the holiday week is listed twice")
		}
		seen[key] = true
	}
	return nil
}

func rejectSiteOverlap(contract TraegerStaffContract, others []TraegerStaffContract) error {
	sites := contract.Sites()
	for _, other := range others {
		if other.ID == contract.ID || !contractsOverlap(contract, other) {
			continue
		}
		for _, site := range other.Sites() {
			if slices.Contains(sites, site) {
				return &ContractError{Kind: ErrContractOverlap, Field: "targets", SchoolID: site.SchoolID,
					Reason: fmt.Sprintf("contract %d already covers school %d on these days", other.ID, site.SchoolID)}
			}
		}
	}
	return nil
}

func contractsOverlap(a, b TraegerStaffContract) bool {
	aEndsAfterBStarts := a.EndsOn.IsZero() || !a.EndsOn.Before(b.StartsOn)
	bEndsAfterAStarts := b.EndsOn.IsZero() || !b.EndsOn.Before(a.StartsOn)
	return aEndsAfterBStarts && bEndsAfterAStarts
}

// FirstMirrorDay is the first day a change of the Träger may still change at
// one Einsatzort: the first of the current month, or the day after the last
// month the school closed for the employment, whichever is later. Earlier
// days keep the Soll the school's Stundenkonto has already counted.
func FirstMirrorDay(today calendar.Date, closed []*StaffMonthBalanceSnapshot) calendar.Date {
	first := calendar.NewDate(today.Year(), today.Month(), 1)
	for _, snapshot := range closed {
		if snapshot == nil || snapshot.ReopenedAt != nil {
			continue
		}
		after := calendar.NewDate(snapshot.Year, time.Month(snapshot.Month)+1, 1)
		if after.After(first) {
			first = after
		}
	}
	return first
}

// RejectBeforeMirrorDay refuses a change that starts before the first day
// the Einsatzort still lets change.
func RejectBeforeMirrorDay(field string, schoolID int64, start, firstOpen calendar.Date) error {
	if start.Before(firstOpen) {
		return &ContractError{Kind: ErrContractMonthClosed, Field: field, SchoolID: schoolID, FirstOpenDay: firstOpen,
			Reason: fmt.Sprintf("the change starts on %s, school %d accepts changes from %s on", start, schoolID, firstOpen)}
	}
	return nil
}

// SollSegment is one stretch of a mirrored Soll: [ValidFrom, ValidUntil),
// ValidUntil zero while open.
type SollSegment struct {
	ValidFrom      calendar.Date
	ValidUntil     calendar.Date
	WeekdayMinutes []int
}

// SollPlan is what the Träger's contracts mean for one employment: its Soll
// segments in order and its holiday weeks. Governs is false when no
// contract names the employment; the mirror then leaves the school alone.
type SollPlan struct {
	Site         ContractSite
	Governs      bool
	Start        calendar.Date
	Segments     []SollSegment
	HolidayWeeks []ContractHolidayWeek
}

// BuildSollPlan derives the plan of one employment from all contracts of
// its record. Contracts of one Einsatzort never overlap (ValidateContract),
// so the segments never do either.
func BuildSollPlan(site ContractSite, contracts []TraegerStaffContract) SollPlan {
	plan := SollPlan{Site: site}
	for _, contract := range contracts {
		versions := siteVersions(contract, site)
		if len(versions) == 0 {
			continue
		}
		plan.Governs = true
		if plan.Start.IsZero() || versions[0].ValidFrom.Before(plan.Start) {
			plan.Start = versions[0].ValidFrom
		}
		plan.Segments = append(plan.Segments, contractSegments(contract, versions)...)
		plan.HolidayWeeks = append(plan.HolidayWeeks, siteWeeks(contract, site)...)
	}
	slices.SortFunc(plan.Segments, func(a, b SollSegment) int { return a.ValidFrom.Compare(b.ValidFrom) })
	slices.SortFunc(plan.HolidayWeeks, func(a, b ContractHolidayWeek) int { return a.WeekStart.Compare(b.WeekStart) })
	return plan
}

// contractSegments turns the sorted Soll versions of one Einsatzort into
// segments: each runs until the next version or the day after the
// contract's last day.
func contractSegments(contract TraegerStaffContract, versions []ContractTarget) []SollSegment {
	var end calendar.Date
	if !contract.EndsOn.IsZero() {
		end = contract.EndsOn.AddDays(1)
	}
	segments := make([]SollSegment, 0, len(versions))
	for i, version := range versions {
		until := end
		if i+1 < len(versions) {
			until = versions[i+1].ValidFrom
		}
		segments = append(segments, SollSegment{ValidFrom: version.ValidFrom, ValidUntil: until, WeekdayMinutes: version.WeekdayMinutes})
	}
	return segments
}

func siteWeeks(contract TraegerStaffContract, site ContractSite) []ContractHolidayWeek {
	var weeks []ContractHolidayWeek
	for _, week := range contract.HolidayWeeks {
		if week.ContractSite == site {
			week.ContractID = contract.ID
			weeks = append(weeks, week)
		}
	}
	return weeks
}

func siteVersions(contract TraegerStaffContract, site ContractSite) []ContractTarget {
	var versions []ContractTarget
	for _, target := range contract.Targets {
		if target.ContractSite == site {
			versions = append(versions, target)
		}
	}
	slices.SortFunc(versions, func(a, b ContractTarget) int { return a.ValidFrom.Compare(b.ValidFrom) })
	return versions
}

// From clips the plan to the days from first on: a segment that started
// earlier starts on first, earlier segments and holiday weeks drop.
func (p SollPlan) From(first calendar.Date) SollPlan {
	clipped := SollPlan{Site: p.Site, Governs: p.Governs, Start: p.Start}
	for _, segment := range p.Segments {
		if !segment.ValidUntil.IsZero() && !segment.ValidUntil.After(first) {
			continue
		}
		if segment.ValidFrom.Before(first) {
			segment.ValidFrom = first
		}
		clipped.Segments = append(clipped.Segments, segment)
	}
	for _, week := range p.HolidayWeeks {
		if !week.WeekStart.Before(first) {
			clipped.HolidayWeeks = append(clipped.HolidayWeeks, week)
		}
	}
	return clipped
}

// ScheduleRows turns the segments into school schedule rows: one week
// without rotation, a row per weekday, also for a free day, so a part-time
// day off counts as maintained (#6889).
func (p SollPlan) ScheduleRows() []StaffWorkSchedule {
	rows := make([]StaffWorkSchedule, 0, len(p.Segments)*ContractWeekdays)
	for _, segment := range p.Segments {
		for day, minutes := range segment.WeekdayMinutes {
			row := StaffWorkSchedule{
				StaffID: p.Site.StaffID, RotationLength: 1, DayOfWeek: day, TargetMinutes: minutes,
				ValidFrom: segment.ValidFrom.String(),
			}
			if !segment.ValidUntil.IsZero() {
				row.ValidUntil = segment.ValidUntil.String()
			}
			rows = append(rows, row)
		}
	}
	return rows
}

// HolidayOverrides turns the holiday weeks into Sonderarbeitszeiten of the
// school, Monday to Friday.
func (p SollPlan) HolidayOverrides() []StaffTargetOverride {
	overrides := make([]StaffTargetOverride, 0, len(p.HolidayWeeks))
	for _, week := range p.HolidayWeeks {
		overrides = append(overrides, StaffTargetOverride{
			StaffID: p.Site.StaffID, StartDate: week.WeekStart.String(), EndDate: week.WeekStart.AddDays(ContractWeekdays - 1).String(),
			WeekdayMinutes: slices.Clone(week.WeekdayMinutes), TraegerContractID: new(week.ContractID),
		})
	}
	return overrides
}

// WeeklyMinutes sums a Soll of Monday to Friday.
func WeeklyMinutes(minutes []int) int {
	total := 0
	for _, value := range minutes {
		total += value
	}
	return total
}
