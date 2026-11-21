package workforce

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The Einsatzplanung of the Träger (#4708, ADR 0089 section 8, ADR 0242):
// the Personalverwaltung plans the people of its Personalakten over all
// their Einsatzorte. Every shift it plans is a shift of the school, written
// in that school's tenant transaction through the school's Dienstplan, so
// it appears there at once and passes the same checks. The week view reads
// each school in its own tenant transaction and writes an access entry
// there first (ADR 0084 section 7).

// The access log views of the week plan: the page and its download as PDF,
// Excel or CSV (#4718).
const (
	TraegerStaffViewPlanning       = "staff_planning"
	TraegerStaffViewPlanningExport = "staff_planning_export"
)

var (
	// ErrTraegerPlanningSiteInvalid refuses a shift at a school that is no
	// live Einsatzort of the record, or a shift of another person.
	ErrTraegerPlanningSiteInvalid = errors.New("workforce: the school is no Einsatzort of the record")
	// ErrTraegerPlanningShiftNotFound answers an unknown shift or one of a
	// person without a record of the Träger.
	ErrTraegerPlanningShiftNotFound = errors.New("workforce: shift not found")
)

// TraegerPlanningRules are the Träger values the week is checked against.
type TraegerPlanningRules struct {
	Enabled         bool `json:"enabled"`
	MaxDailyMinutes int  `json:"max_daily_minutes"`
	MinRestMinutes  int  `json:"min_rest_minutes"`
	CheckBreaks     bool `json:"check_breaks"`
}

// TraegerPlanningSite is one live Einsatzort of a person.
type TraegerPlanningSite struct {
	SchoolID   ident.ID `json:"school_id"`
	SchoolName string   `json:"school_name"`
	StaffID    ident.ID `json:"staff_id"`
}

// TraegerPlanningShift is one shift of a person at one Einsatzort.
type TraegerPlanningShift struct {
	ID               ident.ID      `json:"id"`
	SchoolID         ident.ID      `json:"school_id"`
	SchoolName       string        `json:"school_name"`
	StaffID          ident.ID      `json:"staff_id"`
	Date             calendar.Date `json:"date"`
	StartTime        string        `json:"start_time"`
	EndTime          string        `json:"end_time"`
	BreakMinutes     int           `json:"break_minutes"`
	Notes            string        `json:"notes,omitempty"`
	Cancelled        bool          `json:"cancelled"`
	ShiftTypeName    string        `json:"shift_type_name,omitempty"`
	ShiftTypeColor   string        `json:"shift_type_color,omitempty"`
	PlannedByTraeger bool          `json:"planned_by_traeger"`
	FromSeries       bool          `json:"from_series"`
}

// TraegerPlanningPerson is one Personalakte in the week: its Einsatzorte,
// its shifts, the planned net minutes and the Soll of the week, and every
// working-time warning of the week.
type TraegerPlanningPerson struct {
	RecordID       ident.ID               `json:"staff_record_id"`
	FirstName      string                 `json:"first_name"`
	LastName       string                 `json:"last_name"`
	Sites          []TraegerPlanningSite  `json:"sites"`
	Shifts         []TraegerPlanningShift `json:"shifts"`
	PlannedMinutes int                    `json:"planned_minutes"`
	SollMinutes    *int                   `json:"soll_minutes"`
	// SollDays splits the Soll of the week by school and day (#7381): the
	// contract as a template for the shifts of the week.
	SollDays []TraegerPlanningSollDay `json:"soll_days"`
	// AbsentDays are the full absence days of the week per school, without
	// the kind of absence: a shift planned there is cancelled at once, so the
	// contract suggests none (#7381).
	AbsentDays []TraegerPlanningAbsentDay `json:"absent_days"`
	Warnings   []ShiftWorkingTimeWarning  `json:"warnings"`
}

// TraegerPlanningAbsentDay is a full absence day of a Personalakte at one
// school.
type TraegerPlanningAbsentDay struct {
	SchoolID ident.ID      `json:"school_id"`
	Date     calendar.Date `json:"date"`
}

// TraegerPlanningSollDay is the Soll of a Personalakte at one school on one
// day of the week from its Arbeitsvertrag, without the school's holidays and
// closing days.
type TraegerPlanningSollDay struct {
	SchoolID ident.ID      `json:"school_id"`
	Date     calendar.Date `json:"date"`
	Minutes  int           `json:"minutes"`
}

// TraegerPlanningWeek is the week plan of the Träger: Monday to Sunday.
type TraegerPlanningWeek struct {
	WeekStart calendar.Date           `json:"week_start"`
	Rules     TraegerPlanningRules    `json:"rules"`
	Schools   []TraegerStaffSchool    `json:"schools"`
	People    []TraegerPlanningPerson `json:"people"`
	// Unreached lists schools whose week could not be read; their shifts
	// are missing from the plan.
	Unreached []TraegerStaffSchool `json:"unreached"`
}

// TraegerPlanShift is a shift the Personalverwaltung plans or changes.
type TraegerPlanShift struct {
	RecordID     int64
	SchoolID     int64
	Date         calendar.Date
	StartTime    string
	EndTime      string
	BreakMinutes int
	Notes        string
	WorkingTime  WorkingTimeConfirmation
}

// TraegerFutureShifts counts the shifts after today at one school, for the
// list before the Träger switches the Einsatzplanung off.
type TraegerFutureShifts struct {
	SchoolID   ident.ID `json:"school_id"`
	SchoolName string   `json:"school_name"`
	Shifts     int      `json:"shifts"`
}

// TraegerStaffPlanning is the Einsatzplanung of the Träger-Portal.
type TraegerStaffPlanning interface {
	// PlanningWeek shows one week; view names the access entry, the page or
	// its export.
	PlanningWeek(ctx context.Context, actor TraegerStaffActor, weekStart calendar.Date, view string) (TraegerPlanningWeek, error)
	PlanShift(ctx context.Context, actor TraegerStaffActor, input TraegerPlanShift) (TraegerPlanningShift, error)
	ChangeShift(ctx context.Context, actor TraegerStaffActor, shiftID int64, input TraegerPlanShift) (TraegerPlanningShift, error)
	RemoveShift(ctx context.Context, actor TraegerStaffActor, recordID, schoolID, shiftID int64) error
	FutureShifts(ctx context.Context, actor TraegerStaffActor) ([]TraegerFutureShifts, error)
}

// TraegerSiteWeekQuery asks one school for its part of the week: the shifts
// of its employments in [From, To] and its own share of the Soll of the
// records in SollRecordIDs in [SollFrom, SollTo].
type TraegerSiteWeekQuery struct {
	StaffIDs      []int64
	From, To      calendar.Date
	SollRecordIDs []int64
	SollFrom      calendar.Date
	SollTo        calendar.Date
}

// TraegerSiteWeek is one school's part of the week: its shifts, its own share
// of the asked records' Soll without its holidays and closing days, and the
// Träger values as the school resolves them.
type TraegerSiteWeek struct {
	Shifts []PlannedShift
	Soll   []ShiftPlanSollDay
	// AbsentDays are the full absence days of the asked employments in
	// [SollFrom, SollTo], as the shift writes count them; read only for a
	// week with Soll at the school that reaches today.
	AbsentDays []TraegerSiteAbsentDay
	Rules      TraegerPlanningRules
}

// TraegerSiteAbsentDay is a full absence day of one employment at the school.
type TraegerSiteAbsentDay struct {
	StaffID int64
	Date    calendar.Date
}

// TraegerShiftSites is what the Einsatzplanung reads and writes at one
// school, in that school's tenant transaction: its part of the week, one
// shift, the count of future shifts and its Dienstplan.
type TraegerShiftSites interface {
	SiteWeek(ctx context.Context, query TraegerSiteWeekQuery) (TraegerSiteWeek, error)
	SiteShift(ctx context.Context, shiftID int64) (PlannedShift, error)
	CountShiftsAfter(ctx context.Context, after calendar.Date) (int, error)
	SitePlanning() StaffShiftPlanning
}
