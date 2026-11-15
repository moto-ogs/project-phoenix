package workforce

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The working-time check of the Einsatzplanung (#4708, ADR 0089 section 8,
// ADR 0242). Every shift write for a person with a Personalakte checks the
// shifts at all Einsatzorte: a shift that overlaps one at another school is
// refused, a violation of the Träger's working-time rules warns. Whoever
// plans anyway confirms, with a reason where the rule asks for one; the
// reason goes into the Änderungsprotokoll of the school.

// The kinds of a working-time warning, as the wire names them.
const (
	WorkingTimeDailyMaximum  = "daily_maximum"
	WorkingTimeRestPeriod    = "rest_period"
	WorkingTimeRestShortened = "rest_shortened"
	WorkingTimeBreakTooShort = "break_too_short"
	WorkingTimeAboveSoll     = "above_soll"
)

// MaxWorkingTimeReasonLength bounds the reason a planner gives.
const MaxWorkingTimeReasonLength = 500

var (
	// ErrShiftOverlapsOtherSite refuses a shift that overlaps a shift of the
	// same person at another Einsatzort; ShiftOtherSiteError names it.
	ErrShiftOverlapsOtherSite = errors.New("shift overlaps a shift at another Einsatzort")
	// ErrShiftWorkingTimeWarning answers a shift write that violates a
	// working-time rule without a confirmation; ShiftWorkingTimeError lists
	// the warnings.
	ErrShiftWorkingTimeWarning = errors.New("shift violates a working-time rule")
	// ErrShiftPlanningOff refuses a new shift while the Träger keeps the
	// Einsatzplanung outside moto (Träger value „Einsatzplanung in moto“).
	ErrShiftPlanningOff = errors.New("the Träger plans shifts outside moto")
)

// WorkingTimeConfirmation is the planner's answer to the warnings: planned
// anyway, with a reason where a warning needs one.
type WorkingTimeConfirmation struct {
	Confirmed bool
	Reason    string
}

// ShiftWorkingTimeWarning is one violation. Date is the day it happens on,
// for a short rest the day the rest ends, above the Soll the Monday of the
// week. Minutes is the planned value, Limit the rule.
type ShiftWorkingTimeWarning struct {
	Kind        string        `json:"kind"`
	Date        calendar.Date `json:"date"`
	Minutes     int           `json:"minutes"`
	Limit       int           `json:"limit"`
	NeedsReason bool          `json:"needs_reason"`
}

// ShiftWorkingTimeError carries the warnings of a write that was not
// confirmed, or that needs a reason it lacks.
type ShiftWorkingTimeError struct {
	Warnings       []ShiftWorkingTimeWarning
	ReasonRequired bool
}

func (e *ShiftWorkingTimeError) Error() string {
	return fmt.Sprintf("workforce: shift violates %d working-time rule(s)", len(e.Warnings))
}

func (e *ShiftWorkingTimeError) Unwrap() error { return ErrShiftWorkingTimeWarning }

// ShiftOtherSiteError names the shift at another Einsatzort the write
// overlaps. SchoolName is set only where the caller may know the school,
// in the Träger-Portal; a school reads „anderer Einsatzort“.
type ShiftOtherSiteError struct {
	Date       calendar.Date
	StartTime  string
	EndTime    string
	SchoolName string
}

func (e *ShiftOtherSiteError) Error() string {
	return fmt.Sprintf("workforce: shift overlaps %s to %s on %s at another Einsatzort", e.StartTime, e.EndTime, e.Date)
}

func (e *ShiftOtherSiteError) Unwrap() error { return ErrShiftOverlapsOtherSite }

// ShiftPlanSlot is one active shift of a Personalakte at one of its
// Einsatzorte. SchoolID and ShiftID are 0 for another school in a tenant
// transaction. Minutes count from midnight.
type ShiftPlanSlot struct {
	StaffRecordID int64
	SchoolID      int64
	ShiftID       int64
	Date          calendar.Date
	StartMinute   int
	EndMinute     int
	BreakMinutes  int
}

// ShiftPlanSollDay is the Soll of a Personalakte on one weekday from the
// Arbeitsverträge of the Träger, over all Einsatzorte.
type ShiftPlanSollDay struct {
	StaffRecordID int64
	Date          calendar.Date
	// Own marks the share of the school of the tenant transaction; only that
	// school knows its holidays and closing days.
	Own     bool
	Minutes int
}

// ShiftWorkingTimeOverride is the Änderungsprotokoll entry of a shift
// planned despite a warning: who planned it, why, and what it violates.
type ShiftWorkingTimeOverride struct {
	OccurrenceDate calendar.Date
	StartTime      time.Time
	StaffShiftID   int64
	SubjectStaffID int64
	ActorAccountID *int64
	ActorStaffID   *int64
	Reason         string
	Warnings       json.RawMessage
}
