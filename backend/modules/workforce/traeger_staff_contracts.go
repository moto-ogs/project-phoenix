package workforce

import (
	"context"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The Arbeitsvertrag of ADR 0089 section 1 (#4706): a contract of a
// Personalstamm with kind, validity, the Soll Monday to Friday per Einsatzort
// and the Ferien-Soll of single holiday weeks. Workforce mirrors the Soll
// into the time tracking of each Einsatzort, from the first day the school
// has not closed on; the school sees it as „führt der Träger“.

// The kinds of a contract, the kinds a school knows for an employment.
const (
	TraegerContractKindFullTime = "full_time"
	TraegerContractKindPartTime = "part_time"
	TraegerContractKindMinijob  = "minijob"
)

var (
	// ErrTraegerContractInvalid refuses a contract, a Soll or a holiday
	// week; TraegerContractError names the field.
	ErrTraegerContractInvalid = errors.New("workforce: the contract is invalid")
	// ErrTraegerContractOverlap refuses a second contract for one Einsatzort
	// on the same days.
	ErrTraegerContractOverlap = errors.New("workforce: another contract covers this Einsatzort on these days")
	// ErrTraegerContractMonthClosed refuses a change that starts before the
	// first day an Einsatzort still lets change.
	ErrTraegerContractMonthClosed = errors.New("workforce: the change reaches a month that can no longer change")
	// ErrTraegerContractNotFound answers a contract the record does not hold.
	ErrTraegerContractNotFound = errors.New("workforce: contract not found")
	// ErrTraegerHolidayWeekSchoolOverride refuses a holiday week a
	// Sonderarbeitszeit of the school already covers.
	ErrTraegerHolidayWeekSchoolOverride = errors.New("workforce: the school already has a Sonderarbeitszeit in this week")
	// ErrStaffSollKeptByTraeger refuses a school's change of the Soll of an
	// employment a contract of the Träger governs.
	ErrStaffSollKeptByTraeger = errors.New("workforce: the Träger keeps the Soll of this employment")
)

// TraegerContractError names the refused field and, for a closed month or
// a school's Sonderarbeitszeit, the school and the first open day or week.
type TraegerContractError struct {
	Kind       error
	Field      string
	Reason     string
	SchoolID   int64
	SchoolName string
	Day        calendar.Date
}

func (e *TraegerContractError) Error() string {
	return fmt.Sprintf("workforce: contract %s: %s", e.Field, e.Reason)
}

func (e *TraegerContractError) Unwrap() error { return e.Kind }

// TraegerContractSite names one Einsatzort of a contract.
type TraegerContractSite struct {
	SchoolID int64 `json:"school_id"`
	StaffID  int64 `json:"staff_id"`
}

// TraegerContractSoll is a Soll from ValidFrom on, Monday to Friday in
// minutes.
type TraegerContractSoll struct {
	ValidFrom      calendar.Date `json:"valid_from"`
	WeekdayMinutes []int         `json:"weekday_minutes"`
}

// TraegerContractSiteDetail is one Einsatzort of a contract with its Soll
// history, newest first. ChangeableFrom is the first day a change may start
// on at this school: the first of the current month or the day after its
// last closed month.
type TraegerContractSiteDetail struct {
	TraegerContractSite
	SchoolName     string                `json:"school_name"`
	Soll           []TraegerContractSoll `json:"soll"`
	ChangeableFrom calendar.Date         `json:"changeable_from"`
}

// TraegerContractHolidayWeek is the Ferien-Soll of the week starting on
// WeekStart (a Monday) at one Einsatzort.
type TraegerContractHolidayWeek struct {
	TraegerContractSite
	SchoolName     string        `json:"school_name"`
	WeekStart      calendar.Date `json:"week_start"`
	WeekdayMinutes []int         `json:"weekday_minutes"`
}

// TraegerStaffContract is one contract of a record. EndsOn is its last day,
// nil while open.
type TraegerStaffContract struct {
	ID       int64          `json:"id"`
	Kind     string         `json:"kind"`
	StartsOn calendar.Date  `json:"starts_on"`
	EndsOn   *calendar.Date `json:"ends_on"`
	// Pool marks a contract of the Vertretungspool (#4709).
	Pool         bool                         `json:"pool"`
	Sites        []TraegerContractSiteDetail  `json:"sites"`
	HolidayWeeks []TraegerContractHolidayWeek `json:"holiday_weeks"`
}

// TraegerContractSiteSoll is the Soll of one Einsatzort in a write.
type TraegerContractSiteSoll struct {
	TraegerContractSite
	WeekdayMinutes []int
}

// TraegerContractInput creates a contract: kind, validity and the first Soll
// of each Einsatzort from StartsOn on.
type TraegerContractInput struct {
	Kind     string
	StartsOn calendar.Date
	EndsOn   *calendar.Date
	Pool     bool
	Sites    []TraegerContractSiteSoll
}

// TraegerContractTermsInput changes kind and last day of a contract. A Soll
// or a holiday week after a new last day goes with it.
type TraegerContractTermsInput struct {
	Kind   string
	EndsOn *calendar.Date
	Pool   bool
}

// TraegerContractSollInput changes the Soll of the named Einsatzorte from
// ValidFrom on; a later planned Soll of those Einsatzorte gives way.
type TraegerContractSollInput struct {
	ValidFrom calendar.Date
	Sites     []TraegerContractSiteSoll
}

// TraegerHolidayWeeksInput sets the Ferien-Soll of every week from FromWeek
// to ToWeek (Mondays) at one Einsatzort.
type TraegerHolidayWeeksInput struct {
	TraegerContractSite
	FromWeek       calendar.Date
	ToWeek         calendar.Date
	WeekdayMinutes []int
}

// TraegerStaffContracts keeps the contracts of a record in the
// Träger-Portal. Every write checks the release and the closed months of
// each Einsatzort, saves in the Träger transaction and then mirrors the Soll
// into each Einsatzort in its own tenant transaction (ADR 0105). Each
// answers with the record as Record shows it.
type TraegerStaffContracts interface {
	CreateContract(ctx context.Context, actor TraegerStaffActor, recordID int64, input TraegerContractInput) (TraegerStaffRecordDetail, error)
	UpdateContract(ctx context.Context, actor TraegerStaffActor, recordID, contractID int64, input TraegerContractTermsInput) (TraegerStaffRecordDetail, error)
	ChangeContractSoll(ctx context.Context, actor TraegerStaffActor, recordID, contractID int64, input TraegerContractSollInput) (TraegerStaffRecordDetail, error)
	AddHolidayWeeks(ctx context.Context, actor TraegerStaffActor, recordID, contractID int64, input TraegerHolidayWeeksInput) (TraegerStaffRecordDetail, error)
	DeleteHolidayWeek(ctx context.Context, actor TraegerStaffActor, recordID, contractID int64, week TraegerContractSite, weekStart calendar.Date) (TraegerStaffRecordDetail, error)
	DeleteContract(ctx context.Context, actor TraegerStaffActor, recordID, contractID int64) (TraegerStaffRecordDetail, error)
}
