package workforce

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// OwnTimeViews reads the three independently refreshed parts of a staff
// member's time tracking. The caller resolves staffID from the tenant session.
type OwnTimeViews interface {
	Period(ctx context.Context, staffID int64, view string, start calendar.Date) (OwnTimePeriod, error)
	ClockOverview(ctx context.Context, staffID int64) (OwnClockOverview, error)
	LeaveOverview(ctx context.Context, staffID int64) (OwnLeaveOverview, error)
}

// OwnTimeViewPlanning binds Workforce's planning and allowance readers and
// its narrow calendar and booking ports to the own time-tracking views.
type OwnTimeViewPlanning struct {
	Calendar     PlanningCalendar
	Shifts       OwnShiftQuery
	ShiftsBooked func(context.Context) (bool, error)
	Assignments  StaffAssignmentQuery
	Allowances   OwnAbsenceAllowances
}

const (
	OwnTimeWeek  = "week"
	OwnTimeMonth = "month"

	OwnReadReady       = "ready"
	OwnReadNotBooked   = "not_booked"
	OwnReadUnavailable = "unavailable"
)

// OwnTimeDay distinguishes an unmaintained target from a known day off.
type OwnTimeDay struct {
	Date           calendar.Date `json:"date"`
	HasTarget      bool          `json:"has_target"`
	TargetSource   string        `json:"target_source,omitempty"`
	TargetMinutes  int           `json:"target_minutes"`
	ActualMinutes  int           `json:"actual_minutes"`
	CreditMinutes  int           `json:"credit_minutes"`
	BalanceMinutes int           `json:"balance_minutes"`
}

// OwnTimeBlock contains the editable stamps and their existing read token,
// not the author and administration metadata of a history row.
type OwnTimeBlock struct {
	ID               ident.ID       `json:"id"`
	Date             calendar.Date  `json:"date"`
	CheckInTime      time.Time      `json:"check_in_time"`
	CheckOutTime     *time.Time     `json:"check_out_time"`
	Status           string         `json:"status"`
	Source           string         `json:"source"`
	Notes            string         `json:"notes,omitempty"`
	AutoCheckedOut   bool           `json:"auto_checked_out"`
	NetMinutes       int            `json:"net_minutes"`
	BreakMinutes     int            `json:"break_minutes"`
	IsOvertime       bool           `json:"is_overtime"`
	IsBreakCompliant bool           `json:"is_break_compliant"`
	PackUpMinutes    int            `json:"pack_up_minutes"`
	RoundingMinutes  int            `json:"rounding_minutes"`
	EditCount        int            `json:"edit_count"`
	AuditCount       int            `json:"audit_count"`
	Version          string         `json:"version"`
	Breaks           []OwnTimeBreak `json:"breaks"`
}

type OwnTimeBreak struct {
	ID              ident.ID   `json:"id"`
	StartedAt       time.Time  `json:"started_at"`
	EndedAt         *time.Time `json:"ended_at"`
	DurationMinutes int        `json:"duration_minutes"`
	PlannedEndTime  *time.Time `json:"planned_end_time"`
}

type OwnTimeAbsence struct {
	ID               ident.ID      `json:"id"`
	DateStart        calendar.Date `json:"date_start"`
	DateEnd          calendar.Date `json:"date_end"`
	AbsenceType      string        `json:"absence_type"`
	AbsenceTypeID    *ident.ID     `json:"absence_type_id,omitempty"`
	AbsenceTypeLabel string        `json:"absence_type_label,omitempty"`
	HalfDay          bool          `json:"half_day"`
	StartHalfDay     bool          `json:"start_half_day"`
	EndHalfDay       bool          `json:"end_half_day"`
	Note             string        `json:"note,omitempty"`
	Status           string        `json:"status"`
	DecisionNote     string        `json:"decision_note,omitempty"`
	RequestedAt      time.Time     `json:"requested_at"`
	DurationDays     int           `json:"duration_days"`
	WorkingDays      *float64      `json:"working_days,omitempty"`
}

type OwnTimeShift struct {
	ID             ident.ID      `json:"id"`
	Date           calendar.Date `json:"date"`
	StartTime      string        `json:"start_time"`
	EndTime        string        `json:"end_time"`
	BreakMinutes   int           `json:"break_minutes"`
	ShiftTypeName  string        `json:"shift_type_name,omitempty"`
	ShiftTypeColor string        `json:"shift_type_color,omitempty"`
	Cancelled      bool          `json:"cancelled"`
	ChangeReason   *string       `json:"change_reason,omitempty"`
	OriginShiftID  *ident.ID     `json:"origin_shift_id,omitempty"`
}

type OwnTimeShifts struct {
	State string         `json:"state"`
	Rows  []OwnTimeShift `json:"rows"`
}

type OwnTimeHoliday struct {
	Date calendar.Date `json:"date"`
	Name string        `json:"name"`
}

type OwnTimeClosingDay struct {
	StartDate calendar.Date `json:"start_date"`
	EndDate   calendar.Date `json:"end_date"`
	Reason    string        `json:"reason"`
}

type OwnTimePeriod struct {
	StaffID         ident.ID             `json:"staff_id"`
	View            string               `json:"view"`
	Start           calendar.Date        `json:"start"`
	End             calendar.Date        `json:"end"`
	WeekStart       calendar.Date        `json:"week_start"`
	WeekEnd         calendar.Date        `json:"week_end"`
	AccountStart    calendar.Date        `json:"account_start"`
	Sessions        []OwnTimeBlock       `json:"sessions"`
	LaborDays       []WorkDayLaborHint   `json:"labor_days"`
	RestHints       []OwnTimeRestHint    `json:"rest_hints"`
	WeeklySummaries []WorkWeekSummary    `json:"weekly_summaries"`
	Absences        []OwnTimeAbsence     `json:"absences"`
	Shifts          OwnTimeShifts        `json:"shifts"`
	Holidays        []OwnTimeHoliday     `json:"holidays"`
	ClosingDays     []OwnTimeClosingDay  `json:"closing_days"`
	Days            []OwnTimeDay         `json:"days"`
	MonthSummary    *OwnTimeMonthSummary `json:"month_summary,omitempty"`
}

// OwnTimeMonthSummary distinguishes missing shift data from a month with no
// planned shifts. PlannedShiftMinutes is authoritative only when ready.
type OwnTimeMonthSummary struct {
	MonthSummary
	PlannedShiftState string `json:"planned_shift_state"`
}

type OwnTimeRestHint struct {
	Date         calendar.Date `json:"date"`
	RestMinutes  int           `json:"rest_minutes"`
	LimitMinutes int           `json:"limit_minutes"`
}

type OwnTimeChartPoint struct {
	Date          calendar.Date `json:"date"`
	ActualMinutes int           `json:"actual_minutes"`
	BreakMinutes  int           `json:"break_minutes"`
}

type OwnTimeTotals struct {
	HasTarget      bool `json:"has_target"`
	HasOverride    bool `json:"has_override"`
	TargetMinutes  int  `json:"target_minutes"`
	ActualMinutes  int  `json:"actual_minutes"`
	CreditMinutes  int  `json:"credit_minutes"`
	BalanceMinutes int  `json:"balance_minutes"`
}

type OwnTimeAssignment struct {
	InstanceID      ident.ID      `json:"instance_id"`
	Title           string        `json:"title"`
	GroupName       *string       `json:"group_name,omitempty"`
	RoomName        string        `json:"room_name,omitempty"`
	Date            calendar.Date `json:"date"`
	StartTime       string        `json:"start_time"`
	EndTime         string        `json:"end_time"`
	Status          string        `json:"status"`
	IsSpontaneous   bool          `json:"is_spontaneous"`
	Cancelled       bool          `json:"cancelled"`
	IsPrimary       bool          `json:"is_primary"`
	IsSubstitute    bool          `json:"is_substitute"`
	IsAbsent        bool          `json:"is_absent"`
	AbsenceReason   *string       `json:"absence_reason,omitempty"`
	CancelReason    *string       `json:"cancel_reason,omitempty"`
	UnderstaffedAck bool          `json:"understaffed_ack"`
}

type OwnTimeAssignments struct {
	State string              `json:"state"`
	Rows  []OwnTimeAssignment `json:"rows"`
}

// OwnClockOverview is priced as of AsOf on the current Berlin day. Only a
// successful response establishes that Session or TodayAbsence is absent.
type OwnClockOverview struct {
	Today               calendar.Date       `json:"today"`
	AsOf                time.Time           `json:"as_of"`
	StaffID             ident.ID            `json:"staff_id"`
	Session             *OwnTimeBlock       `json:"session"`
	TodayAbsence        *OwnTimeAbsence     `json:"today_absence"`
	Shifts              OwnTimeShifts       `json:"shifts"`
	Assignments         OwnTimeAssignments  `json:"assignments"`
	Chart               []OwnTimeChartPoint `json:"chart"`
	CompletedToday      int                 `json:"completed_today_minutes"`
	CompletedWeek       int                 `json:"completed_week_minutes"`
	TodayCountsInTotals bool                `json:"today_counts_in_totals"`
	LaborDays           []WorkDayLaborHint  `json:"labor_days"`
	IsOverWeeklyMax     bool                `json:"is_over_weekly_max"`
	Week                OwnTimeTotals       `json:"week"`
	Month               OwnTimeTotals       `json:"month"`
	AccountStart        calendar.Date       `json:"account_start"`
	AccountBalance      *int                `json:"account_balance_minutes"`
	// TerminalOnlyStamping says the staff member stamps only with the own
	// chip at the NFC terminal (#8024): the app offers no stamp and no edit
	// of recorded times.
	TerminalOnlyStamping bool `json:"terminal_only_stamping"`
}

type OwnLeaveCounts struct {
	Reserved int `json:"reserved"`
	Question int `json:"question"`
	Approved int `json:"approved"`
	Declined int `json:"declined"`
}

type OwnLeaveQuota struct {
	EntitledDays    float64 `json:"entitled_days"`
	CarryoverDays   float64 `json:"carryover_days"`
	TakenBeforeDays float64 `json:"taken_before_days"`
	TakenDays       float64 `json:"taken_days"`
	ReservedDays    float64 `json:"reserved_days"`
	RemainingDays   float64 `json:"remaining_days"`
}

type OwnLeaveAllowance struct {
	AbsenceTypeID ident.ID                `json:"absence_type_id"`
	Name          string                  `json:"name"`
	EntitledDays  float64                 `json:"entitled_days"`
	TakenDays     float64                 `json:"taken_days"`
	ReservedDays  float64                 `json:"reserved_days"`
	RemainingDays float64                 `json:"remaining_days"`
	ExpiresOn     calendar.Date           `json:"expires_on"`
	ExpiredDays   float64                 `json:"expired_days"`
	CarriedIn     *OwnLeaveAllowanceCarry `json:"carried_in"`
}

type OwnLeaveAllowanceCarry struct {
	Year          int           `json:"year"`
	RemainingDays float64       `json:"remaining_days"`
	ExpiredDays   float64       `json:"expired_days"`
	ExpiresOn     calendar.Date `json:"expires_on"`
}

type OwnLeaveMails struct {
	State            string                      `json:"state"`
	AwaitingFeedback bool                        `json:"awaiting_feedback"`
	Absences         map[ident.ID]map[string]int `json:"absences"`
}

type OwnLeaveOverview struct {
	Year       int                 `json:"year"`
	Quota      OwnLeaveQuota       `json:"quota"`
	Counts     OwnLeaveCounts      `json:"counts"`
	Recent     []OwnTimeAbsence    `json:"recent"`
	Questions  []OwnTimeAbsence    `json:"questions"`
	Allowances []OwnLeaveAllowance `json:"allowances"`
	Mails      OwnLeaveMails       `json:"mails"`
}
