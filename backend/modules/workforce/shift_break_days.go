package workforce

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Series shifts on closing days and in the Ferien (#8205). A series that
// leaves out Ferien and closing days applies that rule when it plans; a
// closing day entered later reaches its already planned shifts through
// SeriesBreakDays.FollowBreakDays, in the transaction that changed the day.

// ClosingDayShiftChangeReason is the neutral change reason of an unchanged
// series shift a closing day cancels; HolidayPeriodShiftChangeReason the one
// of a shift that now falls into the Ferien.
const (
	ClosingDayShiftChangeReason    = "Schließtag"
	HolidayPeriodShiftChangeReason = "Ferien"
)

// IsBreakDayShiftChangeReason reports whether reason is a label the
// break-day follow-up writes, which it may take back when the day opens.
func IsBreakDayShiftChangeReason(reason string) bool {
	return reason == ClosingDayShiftChangeReason || reason == HolidayPeriodShiftChangeReason
}

// Break kinds of a SeriesBreakDayShift.
const (
	BreakDayClosingDay    = "closing_day"
	BreakDayHolidayPeriod = "holiday_period"
)

// SeriesBreakDayShift is one planned shift of a series that leaves out Ferien
// and closing days, standing on such a day from tomorrow on (#8205). Adjusted
// marks a shift someone changed by hand: the follow-up leaves it to the
// planner. An unadjusted one stands there because its day became a break
// without the follow-up, for example through a closing day of the Träger.
// Date is a calendar day in DateLayout; StartTime and EndTime are "HH:MM".
type SeriesBreakDayShift struct {
	ShiftID   ident.ID `json:"shift_id"`
	StaffID   ident.ID `json:"staff_id"`
	Date      string   `json:"date"`
	StartTime string   `json:"start_time"`
	EndTime   string   `json:"end_time"`
	// Break names why the series would leave the day out: BreakDayClosingDay
	// or BreakDayHolidayPeriod.
	Break    string `json:"break"`
	Adjusted bool   `json:"adjusted"`
}

// SeriesBreakDays keeps the planned series shifts in step with the school's
// closing days (#8205).
type SeriesBreakDays interface {
	// FollowBreakDays reconciles the series shifts of [from, to] after the
	// school's closing days changed there, in the caller's tenant
	// transaction. Days up to and including today stay as they are. An
	// unchanged active shift on a day its series leaves out is cancelled
	// with a neutral reason; a shift this follow-up cancelled is planned
	// again when its day opens. Shifts changed by hand stay as they are.
	FollowBreakDays(ctx context.Context, from, to calendar.Date) error
	// BreakDayShifts lists the planned series shifts that still stand on a
	// day their series leaves out, from tomorrow on.
	BreakDayShifts(ctx context.Context) ([]SeriesBreakDayShift, error)
}

// BreakDayShiftState is the state the break-day follow-up writes on one
// shift: cancelled with its label, or planned again. SickAbsenceID stamps a
// shift planned again on a full absence day, which stays cancelled in the
// absence's state (#6302); Detached follows that stamp.
type BreakDayShiftState struct {
	ShiftID       int64
	Cancelled     bool
	ChangeReason  *string
	SickAbsenceID *int64
	Detached      bool
}
