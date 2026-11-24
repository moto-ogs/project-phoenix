package workforce

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// This file is the public time-tracking contract the web adapters consume
// (#2690): the MA-facing stamp/history/absence surface and the Leitung's
// administration of working time. The time-tracking services of the module
// serve it (internal/timetracking, #3413); the wire shapes below are
// byte-for-byte what those services rendered, so the frontend contract does
// not move.
//
// Calendar days travel as YYYY-MM-DD strings; instants stay time.Time.

// Sentinel failures of the administration surface. Every adapter reports the
// retained service's sentinel as one of these kinds with the original wording
// preserved (see TimeTrackingError), so the HTTP layer classifies by kind and
// renders the message it always rendered.
var (
	ErrManagerControlledAbsence = errors.New("absence type is manager-controlled")
	ErrAllowanceBookingOverlap  = errors.New("allowance booking overlaps")
	// ErrAbsenceRebookingBlocked carries a German reason the Leitung has to
	// resolve before a rebooking (#3258).
	ErrAbsenceRebookingBlocked = errors.New("absence rebooking blocked")
	ErrVacationQuotaInvalid    = errors.New("vacation quota is invalid")
	ErrVacationQuotaExceeded   = errors.New("vacation quota exceeded")

	ErrAdjustmentInvalid           = errors.New("balance adjustment is invalid")
	ErrAdjustmentNotFound          = errors.New("balance adjustment not found")
	ErrAdjustmentExceedsBalance    = errors.New("balance adjustment exceeds the balance")
	ErrAdjustmentInClosedMonth     = errors.New("balance adjustment falls into a closed month")
	ErrAdjustmentHasDependentReset = errors.New("balance adjustment has a dependent reset")
	ErrBalanceAlreadyReset         = errors.New("balance already reset")
	ErrOpeningAlreadyExists        = errors.New("opening balance already exists")

	ErrMonthCloseInvalid = errors.New("month close is invalid")
	ErrMonthNotClosable  = errors.New("month cannot be closed yet")
	ErrMonthNotClosed    = errors.New("month is not closed")
	ErrLaterMonthClosed  = errors.New("a later month is closed")
	ErrMonthOutOfRange   = errors.New("month out of range")

	ErrVacationOpeningInvalid              = errors.New("vacation opening is invalid")
	ErrVacationOpeningNotFound             = errors.New("vacation opening not found")
	ErrVacationOpeningExists               = errors.New("vacation opening already exists")
	ErrVacationOpeningAbsencesBeforeCutoff = errors.New("absences exist before the vacation opening cutoff")

	ErrInvalidTargetRange      = errors.New("target range is invalid")
	ErrOverviewInvalid         = errors.New("overview request is invalid")
	ErrAuditLogInvalid         = errors.New("audit log request is invalid")
	ErrTimeExportInvalid       = errors.New("time export request is invalid")
	ErrPayrollConfigIncomplete = errors.New("payroll configuration is incomplete")
	ErrScheduleValidation      = errors.New("schedule validation failed")
	// ErrWorkTimeModelArchived refuses a new assignment of a template the
	// school no longer offers (#6891).
	ErrWorkTimeModelArchived = errors.New("work time model is archived")
)

// BreakDurationUpdate corrects one break's duration inside a session edit.
// ident.ID reads the break id as a decimal string, so a browser never rounds
// it while correcting recorded intervals.
type BreakDurationUpdate struct {
	ID              ident.ID `json:"id"`
	DurationMinutes int      `json:"duration_minutes"`
}

// SessionUpdateRequest is the body of a session edit; nil leaves a field
// untouched.
type SessionUpdateRequest struct {
	Date         *time.Time            `json:"date"`
	CheckInTime  *time.Time            `json:"check_in_time"`
	CheckOutTime *time.Time            `json:"check_out_time"`
	BreakMinutes *int                  `json:"break_minutes"`
	Status       *string               `json:"status"`
	Notes        *string               `json:"notes"`
	Breaks       []BreakDurationUpdate `json:"breaks"`
	// ExpectedVersion is the version of the history row the form showed
	// (ADR 0311). The routes refuse an omitted one; nil is a write that
	// showed no row.
	ExpectedVersion *string `json:"expected_version"`
}

// AdminCreateSessionRequest is the body of the admin nachtragen flow. Date
// stays an instant on the wire (the frontend sends RFC3339 UTC midnight); the
// service derives the Berlin calendar day.
type AdminCreateSessionRequest struct {
	Date         time.Time `json:"date"`
	CheckInTime  time.Time `json:"check_in_time"`
	CheckOutTime time.Time `json:"check_out_time"`
	BreakMinutes int       `json:"break_minutes"`
	Status       string    `json:"status"`
	Notes        string    `json:"notes"`
}

// SessionResponse is one block of the history with its as-of-now figures.
// BreakMinutes shadows the block's cached value on the wire on purpose: the
// cache holds ended breaks only while NetMinutes already deducts a running
// one, and gross = net + break must hold for the reader.
type SessionResponse struct {
	*WorkSession
	BreakMinutes     int                 `json:"break_minutes"`
	NetMinutes       int                 `json:"net_minutes"`
	IsOvertime       bool                `json:"is_overtime"`
	IsBreakCompliant bool                `json:"is_break_compliant"`
	Breaks           []*WorkSessionBreak `json:"breaks"`
	EditCount        int                 `json:"edit_count"`
	AuditCount       int                 `json:"audit_count"`
	// PackUpMinutes and RoundingMinutes explain the credit inside NetMinutes
	// (#6851, #6852): the pack-up time of a regular checkout and the signed
	// change the rounding made. Both are 0 for an open block.
	PackUpMinutes   int `json:"pack_up_minutes"`
	RoundingMinutes int `json:"rounding_minutes"`
	// Version is the token of the block and its breaks; a correction sends
	// it back as expected_version (ADR 0311).
	Version string `json:"version"`
}

// WorkWeekSummary aggregates the recorded work of one ISO week.
type WorkWeekSummary struct {
	WeekNumber      int  `json:"week_number"`
	Year            int  `json:"year"`
	TotalNetMinutes int  `json:"total_net_minutes"`
	TargetMinutes   *int `json:"target_minutes,omitempty"`
	DeltaMinutes    *int `json:"delta_minutes,omitempty"`
	SessionCount    int  `json:"session_count"`
	IsOverWeeklyMax bool `json:"is_over_weekly_max"`
}

// WorkDayLaborHint is the ArbZG view of one workday (#4804): every block
// checked in on that Berlin day, evaluated together. The flags are hints and
// block nothing. A running break is never judged as too short. While the day
// runs and no break does, the *At instants name when a hint starts if work
// simply continues, so a live clock needs no thresholds of its own.
type WorkDayLaborHint struct {
	Date                         string     `json:"date"`
	NetMinutes                   int        `json:"net_minutes"`
	BreakMinutes                 int        `json:"break_minutes"`
	CountedBreakMinutes          int        `json:"counted_break_minutes"`
	RequiredBreakMinutes         int        `json:"required_break_minutes"`
	IsBreakTooShort              bool       `json:"is_break_too_short"`
	IsOverDailyMax               bool       `json:"is_over_daily_max"`
	IsRunning                    bool       `json:"is_running"`
	OverDailyMaxAt               *time.Time `json:"over_daily_max_at"`
	BreakTooShortAt              *time.Time `json:"break_too_short_at"`
	BreakTooShortRequiredMinutes int        `json:"break_too_short_required_minutes"`
}

// HistoryResponse is the session history of a range with its weekly sums and
// the ArbZG hints per workday.
type HistoryResponse struct {
	Sessions        []*SessionResponse `json:"sessions"`
	WeeklySummaries []WorkWeekSummary  `json:"weekly_summaries"`
	LaborDays       []WorkDayLaborHint `json:"labor_days"`
}

// WorkSessionEdit is one audit row of a session edit.
type WorkSessionEdit struct {
	ID        ident.ID  `json:"id"`
	TenantID  ident.ID  `json:"tenant_id"`
	SessionID ident.ID  `json:"session_id"`
	StaffID   ident.ID  `json:"staff_id"`
	EditedBy  ident.ID  `json:"edited_by"`
	FieldName string    `json:"field_name"`
	OldValue  *string   `json:"old_value"`
	NewValue  *string   `json:"new_value"`
	Notes     *string   `json:"notes"`
	CreatedAt time.Time `json:"created_at"`
}

// WorkSessionEditView decorates an audit row with the editor's display name
// and whether the owner edited their own block.
type WorkSessionEditView struct {
	*WorkSessionEdit
	EditorName string `json:"editor_name"`
	IsSelfEdit bool   `json:"is_self_edit"`
}

// ExportFile is a rendered download.
type ExportFile struct {
	Data        []byte
	Filename    string
	ContentType string
}

// ScheduleEntry is one day of a schedule update.
type ScheduleEntry struct {
	WeekIndex     int
	DayOfWeek     int
	TargetMinutes int
	StartTime     *string
}

// ScheduleUpdateInput mirrors the schedule PUT at the capability boundary.
type ScheduleUpdateInput struct {
	Mode                          string
	ModelID                       *int64
	RotationLength                int
	RotationAnchorDate, ValidFrom string
	Entries                       []ScheduleEntry
	SaveAsTemplateName            string
	// ExpectedVersion is the ScheduleVersion of the schedule the form
	// showed (ADR 0311); another one, also an empty one, is refused.
	ExpectedVersion string
}

// WorkSessionHistory reads and exports session history for both staff and administrators.
type WorkSessionHistory interface {
	// HistoryIntersecting reads every block that reaches into [from, to].
	HistoryIntersecting(ctx context.Context, staffID int64, from, to string) (*HistoryResponse, error)
	ExportSessions(ctx context.Context, staffID int64, from, to, format string) (*ExportFile, error)
}

// OwnWorkSessions serves the staff member's own clock, breaks, edits and presence view.
type OwnWorkSessions interface {
	WorkSessionHistory
	CheckIn(ctx context.Context, staffID int64, status, source, reason string) (*WorkSession, error)
	CheckOut(ctx context.Context, staffID int64, reason string) (*WorkSession, error)
	StartBreak(ctx context.Context, staffID int64, plannedDurationMinutes *int) (*WorkSessionBreak, error)
	EndBreak(ctx context.Context, staffID int64) (*WorkSession, error)
	// LatestOpenSession is the block still running, whichever day it was
	// opened on; nil when there is none.
	LatestOpenSession(ctx context.Context, staffID int64) (*WorkSession, error)
	SessionBreaks(ctx context.Context, staffID, sessionID int64) ([]*WorkSessionBreak, error)
	UpdateSession(ctx context.Context, staffID, sessionID int64, updates SessionUpdateRequest) (*WorkSession, error)
	SessionEdits(ctx context.Context, staffID, sessionID int64) ([]*WorkSessionEditView, error)
	// GetTodayPresenceMap maps staff id to the work status of everyone
	// clocked in right now.
	GetTodayPresenceMap(ctx context.Context) (map[int64]string, error)
}

// AdminWorkSessions serves the manager's session corrections and schedule changes.
type AdminWorkSessions interface {
	WorkSessionHistory
	UpdateSessionAsAdmin(ctx context.Context, editorStaffID, targetStaffID, sessionID int64, updates SessionUpdateRequest) (*WorkSession, error)
	CreateSessionAsAdmin(ctx context.Context, editorStaffID, targetStaffID int64, request AdminCreateSessionRequest) (*WorkSession, error)
	SessionEditsForStaff(ctx context.Context, staffID, sessionID int64) ([]*WorkSessionEditView, error)
	// UpdateStaffSchedule resolves the requested mode (template or custom),
	// validates and applies the change; validation failures carry
	// ErrScheduleValidation. The current schedule and the templates are read
	// through Query.
	UpdateStaffSchedule(ctx context.Context, staffID int64, input ScheduleUpdateInput) error
}

// WorkSessions combines the self-service and administration capabilities for composition.
type WorkSessions interface {
	OwnWorkSessions
	AdminWorkSessions
}

// StaffAbsenceResponse is an absence with its derived duration.
type StaffAbsenceResponse struct {
	*StaffAbsence
	DurationDays int `json:"duration_days"`
}

// StaffAbsenceRequestItem is one request of the Anfragen module: the absence
// plus the person it belongs to and, in the history, who decided it.
type StaffAbsenceRequestItem struct {
	*StaffAbsenceResponse
	StaffName     string `json:"staff_name"`
	DecidedByName string `json:"decided_by_name,omitempty"`
}

// CreateAbsenceRequest files an absence.
type CreateAbsenceRequest struct {
	AbsenceType   string    `json:"absence_type"`
	AbsenceTypeID *ident.ID `json:"absence_type_id"`
	DateStart     string    `json:"date_start"`
	DateEnd       string    `json:"date_end"`
	HalfDay       bool      `json:"half_day"`
	Note          string    `json:"note"`
	// ExpectedFingerprint confirms a Freizeitausgleich that takes the
	// Stundenkonto below zero (#2873): the Fingerprint of the preview the
	// Leitung confirmed. The Leitung's booking refuses an overdraft whose
	// projection differs with general.changed_since_read (ADR 0311). A staff
	// member's own absence confirms nothing; its route takes the
	// OwnAbsenceRequest of the HTTP adapter, which has no such field.
	ExpectedFingerprint string `json:"expected_fingerprint"`
}

// UpdateAbsenceRequest edits an absence; nil leaves a field untouched.
// AbsenceTypeIDSet distinguishes an omitted absence_type_id from JSON null,
// which clears a previously selected school-defined art.
type UpdateAbsenceRequest struct {
	AbsenceType      *string   `json:"absence_type"`
	AbsenceTypeID    *ident.ID `json:"absence_type_id"`
	AbsenceTypeIDSet bool      `json:"-"`
	DateStart        *string   `json:"date_start"`
	DateEnd          *string   `json:"date_end"`
	HalfDay          *bool     `json:"half_day"`
	Note             *string   `json:"note"`
}

// UnmarshalJSON reads the fields as encoding/json does and records whether
// absence_type_id was sent at all, so JSON null can clear a school-defined
// type.
func (r *UpdateAbsenceRequest) UnmarshalJSON(data []byte) error {
	type plain UpdateAbsenceRequest
	var presence struct {
		AbsenceTypeID json.RawMessage `json:"absence_type_id"`
	}
	if err := wire.Unmarshal(data, (*plain)(r)); err != nil {
		return err
	}
	if err := json.Unmarshal(data, &presence); err != nil {
		return err
	}
	r.AbsenceTypeIDSet = len(presence.AbsenceTypeID) != 0
	return nil
}

// RequestVacationRequest is what a staff member submits via "Urlaub
// beantragen"; the half-day flags cover the first and last day only.
type RequestVacationRequest struct {
	DateStart         string    `json:"date_start"`
	DateEnd           string    `json:"date_end"`
	StartHalfDay      bool      `json:"start_half_day"`
	EndHalfDay        bool      `json:"end_half_day"`
	Note              string    `json:"note"`
	SubstituteStaffID *ident.ID `json:"substitute_staff_id,omitempty"`
}

// VacationDecisionRequest is the Leitung's approve/deny/question payload.
type VacationDecisionRequest struct {
	DecisionNote string `json:"decision_note"`
}

// StaffAbsenceListFilter selects a staff member's absences by overlapping
// date range, status, or both. From and To are both set or both empty.
type StaffAbsenceListFilter struct {
	From   string
	To     string
	Status string
}

// AbsenceRequestListQuery selects the open work list or the decided history
// of the Anfragen module, narrowed by absence type and staff name.
type AbsenceRequestListQuery struct {
	History bool
	Types   []string
	Search  string
}

// VacationQuotaSummary aggregates entitled, taken and reserved vacation days
// of one staff member and year.
type VacationQuotaSummary struct {
	StaffID         ident.ID              `json:"staff_id"`
	Year            int                   `json:"year"`
	EntitledDays    float64               `json:"entitled_days"`
	CarryoverDays   float64               `json:"carryover_days"`
	TakenBeforeDays float64               `json:"taken_before_days"`
	TakenDays       float64               `json:"taken_days"`
	ReservedDays    float64               `json:"reserved_days"`
	RemainingDays   float64               `json:"remaining_days"`
	Opening         *StaffVacationOpening `json:"opening,omitempty"`
	// Version is the token of the stored claim (entitled and carryover
	// days); the change sends it back as expected_version (ADR 0311).
	Version string `json:"version"`
}

// SetVacationOpeningRequest carries the vacation takeover: the Resturlaub as
// of the Stichtag EffectiveDate.
type SetVacationOpeningRequest struct {
	EffectiveDate string
	RemainingDays float64
	Note          string
}

// CompTimeBalancePreview is what the create modal shows before a
// Freizeitausgleich is confirmed. All values are minutes.
type CompTimeBalancePreview struct {
	CurrentBalanceMinutes    int `json:"current_balance_minutes"`
	DeductionMinutes         int `json:"deduction_minutes"`
	RealizedDeductionMinutes int `json:"realized_deduction_minutes"`
	FutureCommitmentMinutes  int `json:"future_commitment_minutes"`
	FutureAdjustmentMinutes  int `json:"future_adjustment_minutes"`
	ProjectedBalanceMinutes  int `json:"projected_balance_minutes"`
	// Fingerprint is the token of this projection (ADR 0311): a booking that
	// confirms an overdraft sends it back as expected_fingerprint.
	Fingerprint string `json:"fingerprint"`
}

// RebookAbsencesRequest moves stored absences of one staff member to another
// type (#3258). The handler reads it from timetracking.RebookAbsencesBody.
type RebookAbsencesRequest struct {
	AbsenceIDs    []int64
	AbsenceType   string
	AbsenceTypeID *int64
	Reason        string
	DryRun        bool
	// ExpectedFingerprint is the dry run's Fingerprint the write was
	// confirmed against (ADR 0311).
	ExpectedFingerprint string
}

// AbsenceRebookingResult is what a rebooking does: the entries with their new
// type, the Stundenkonto change in minutes, and the touched accounts.
type AbsenceRebookingResult struct {
	Absences            []*StaffAbsenceResponse  `json:"absences"`
	Days                float64                  `json:"days"`
	BalanceDeltaMinutes int                      `json:"balance_delta_minutes"`
	Allowances          []RebookingAllowanceYear `json:"allowances,omitempty"`
	AllowanceExceeded   bool                     `json:"allowance_exceeded"`
	Vacation            []RebookingVacationYear  `json:"vacation,omitempty"`
	VacationExceeded    bool                     `json:"vacation_exceeded"`
	Applied             bool                     `json:"applied"`
	// Fingerprint is the token of the effect (ADR 0311): the write sends
	// the dry run's back as expected_fingerprint.
	Fingerprint string `json:"fingerprint"`
}

// RebookingAllowanceYear is the target allowance of one year after the
// rebooking; BookingDays is what the rebooked entries take from it.
type RebookingAllowanceYear struct {
	Year          int     `json:"year"`
	EntitledDays  float64 `json:"entitled_days"`
	TakenDays     float64 `json:"taken_days"`
	ReservedDays  float64 `json:"reserved_days"`
	RemainingDays float64 `json:"remaining_days"`
	BookingDays   float64 `json:"booking_days"`
}

// RebookingVacationYear is the Resturlaub of one year before and after.
type RebookingVacationYear struct {
	Year            int     `json:"year"`
	RemainingBefore float64 `json:"remaining_before"`
	RemainingAfter  float64 `json:"remaining_after"`
}

// VacationQuotaReader reads the vacation account both the staff member and
// the administration show.
type VacationQuotaReader interface {
	VacationQuotaSummary(ctx context.Context, staffID int64, year int) (*VacationQuotaSummary, error)
}

// OwnAbsences serves the staff member's own absences and vacation requests.
// The absence writes with plan effect, the withdrawal of an approved request
// among them, are SickReportWrites.
type OwnAbsences interface {
	VacationQuotaReader
	ListAbsences(ctx context.Context, staffID int64, filter StaffAbsenceListFilter) ([]*StaffAbsenceResponse, error)
	RequestVacation(ctx context.Context, staffID int64, request RequestVacationRequest) (*StaffAbsenceResponse, error)
	ResubmitAbsence(ctx context.Context, staffID, actorAccountID, absenceID int64, note string) (*StaffAbsenceResponse, error)
}

// AbsenceRequestReview serves the manager's decisions on vacation requests.
// The approval takes plan effect and is a SickReportWrites write.
type AbsenceRequestReview interface {
	DenyAbsence(ctx context.Context, absenceID, actorAccountID, decidedByStaffID int64, reason string) (*StaffAbsenceResponse, error)
	QuestionAbsence(ctx context.Context, absenceID, actorAccountID int64, note string) (*StaffAbsenceResponse, error)
	ListPendingRequests(ctx context.Context) ([]*StaffAbsenceResponse, error)
	ListAbsenceRequests(ctx context.Context, query AbsenceRequestListQuery) ([]*StaffAbsenceRequestItem, error)
}

// AdminAbsences serves the manager's absence bookings, rebookings and
// vacation account changes for a staff member. Creating and deleting an
// absence on the staff member's behalf are SickReportWrites.
type AdminAbsences interface {
	VacationQuotaReader
	AbsenceRequestReview
	AbsencesForRange(ctx context.Context, staffID int64, from, to string) ([]*StaffAbsenceResponse, error)
	PreviewCompTimeBalance(ctx context.Context, staffID int64, start, end string, halfDay bool) (*CompTimeBalancePreview, error)
	// RebookAbsences changes the type of stored absences with a reason; with
	// DryRun it only reports the effects (#3258).
	RebookAbsences(ctx context.Context, staffID, actorAccountID int64, request RebookAbsencesRequest) (*AbsenceRebookingResult, error)
	// SetVacationQuota changes the entitlement with a reason (#3256).
	SetVacationQuota(ctx context.Context, change VacationQuotaChange) error
	SetVacationOpening(ctx context.Context, staffID, decidedBy int64, request SetVacationOpeningRequest) (*StaffVacationOpening, error)
	DeleteVacationOpening(ctx context.Context, staffID, deletedBy int64, year int) error
}

// StaffAbsences is the absence and vacation administration of the web app:
// the self-service and administration capabilities for composition, the
// sick-report writes of the shift-plan-sync workflow, plus the quota write of
// the opening-balance import.
type StaffAbsences interface {
	OwnAbsences
	AdminAbsences
	SickReportWrites
	UpsertVacationQuota(ctx context.Context, staffID int64, year int, entitled, carryover float64) error
}

// AdjustmentView is one Stundenkonto transaction as the Monatskarte shows it.
type AdjustmentView struct {
	ID            ident.ID  `json:"id"`
	Type          string    `json:"type"`
	MinutesDelta  int       `json:"minutes_delta"`
	EffectiveDate string    `json:"effective_date"`
	Note          string    `json:"note"`
	DecidedBy     ident.ID  `json:"decided_by"`
	DecidedAt     time.Time `json:"decided_at"`
}

// MonthSummary is the Monatskarte of one staff member and month.
type MonthSummary struct {
	StaffID ident.ID `json:"staff_id"`
	Year    int      `json:"year"`
	Month   int      `json:"month"`

	CarryInMinutes      int `json:"carry_in_minutes"`
	TargetMinutes       int `json:"target_minutes"`
	TargetMinutesToDate int `json:"target_minutes_to_date"`
	// HasTarget is false when no Soll is maintained for the month (#6887).
	HasTarget               bool    `json:"has_target"`
	ActualMinutes           int     `json:"actual_minutes"`
	CreditedSickMinutes     int     `json:"credited_sick_minutes"`
	CreditedVacationMinutes int     `json:"credited_vacation_minutes"`
	CreditedTrainingMinutes int     `json:"credited_training_minutes"`
	CreditedOtherMinutes    int     `json:"credited_other_minutes"`
	SickDays                float64 `json:"sick_days"`
	VacationDays            float64 `json:"vacation_days"`
	TrainingDays            float64 `json:"training_days"`
	// *DaysWithoutTarget count absence workdays no maintained Soll governs;
	// they credit nothing (#6889).
	SickDaysWithoutTarget     float64 `json:"sick_days_without_target"`
	VacationDaysWithoutTarget float64 `json:"vacation_days_without_target"`
	TrainingDaysWithoutTarget float64 `json:"training_days_without_target"`
	OtherDaysWithoutTarget    float64 `json:"other_days_without_target"`

	PlannedShiftMinutes *int `json:"planned_shift_minutes,omitempty"`

	AdjustmentMinutes int              `json:"adjustment_minutes"`
	Adjustments       []AdjustmentView `json:"adjustments,omitempty"`

	BalanceMinutes        int `json:"balance_minutes"`
	ClosingBalanceMinutes int `json:"closing_balance_minutes"`

	IsClosed bool       `json:"is_closed"`
	ClosedAt *time.Time `json:"closed_at,omitempty"`
	ClosedBy *ident.ID  `json:"closed_by,omitempty"`
	// ClosedByTraeger marks a close of the Personalverwaltung of the
	// Träger (#4711); only the Träger reopens it.
	ClosedByTraeger             bool    `json:"closed_by_traeger"`
	CloseReason                 string  `json:"close_reason,omitempty"`
	FrozenClosingBalanceMinutes *int    `json:"frozen_closing_balance_minutes,omitempty"`
	DriftMinutes                int     `json:"drift_minutes"`
	CarryInFrozen               bool    `json:"carry_in_frozen"`
	CarryInFrozenFromMonth      *string `json:"carry_in_frozen_from_month,omitempty"`
}

// WorkTimeMonths is the Monatskarte read model.
type WorkTimeMonths interface {
	MonthSummary(ctx context.Context, staffID int64, year, month int) (*MonthSummary, error)
	DailyProjection(ctx context.Context, staffID int64, from, to string) ([]DailyProjection, error)
}

// CreateBalanceAdjustmentRequest carries a payout or lump-sum comp-time grant;
// MinutesDelta is signed and negative.
type CreateBalanceAdjustmentRequest struct {
	Type          string
	MinutesDelta  int
	EffectiveDate string
	Note          string
}

// BalanceAdjustments is the Stundenkonto ledger administration.
type BalanceAdjustments interface {
	ListAdjustments(ctx context.Context, staffID int64, from, to string) ([]*StaffBalanceAdjustment, error)
	CreateAdjustment(ctx context.Context, staffID, decidedBy int64, request CreateBalanceAdjustmentRequest) (*StaffBalanceAdjustment, error)
	DeleteAdjustment(ctx context.Context, staffID, adjustmentID, deletedBy int64) error
	ResetBalance(ctx context.Context, staffID, decidedBy int64, effectiveDate string, carryoverMinutes int, note string) (*StaffBalanceAdjustment, error)
	CreateOpeningBalance(ctx context.Context, staffID, decidedBy int64, effectiveDate string, balanceMinutes int, note string) (*StaffBalanceAdjustment, error)
}

// StaffMonthBalanceSnapshot is one frozen month of one staff member.
type StaffMonthBalanceSnapshot struct {
	ID                    ident.ID   `json:"id"`
	CreatedAt             time.Time  `json:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
	TenantID              ident.ID   `json:"tenant_id"`
	StaffID               ident.ID   `json:"staff_id"`
	Year                  int        `json:"year"`
	Month                 int        `json:"month"`
	ClosingBalanceMinutes int        `json:"closing_balance_minutes"`
	CarryInMinutes        int        `json:"carry_in_minutes"`
	TargetMinutes         int        `json:"target_minutes"`
	ActualMinutes         int        `json:"actual_minutes"`
	CreditedMinutes       int        `json:"credited_minutes"`
	AdjustmentMinutes     int        `json:"adjustment_minutes"`
	ClosedAt              time.Time  `json:"closed_at"`
	ClosedBy              ident.ID   `json:"closed_by"`
	ClosedByAccountID     int64      `json:"-"`
	CloseReason           string     `json:"close_reason,omitempty"`
	Source                string     `json:"source"`
	ReopenedAt            *time.Time `json:"reopened_at,omitempty"`
	ReopenedBy            *ident.ID  `json:"reopened_by,omitempty"`
	ReopenedByAccountID   *int64     `json:"-"`
	ReopenReason          string     `json:"reopen_reason,omitempty"`
	// PayrollRules is the JSON of the wage types, rules and absence type
	// mapping in force at the close (#4807); nil books with the current ones.
	PayrollRules []byte `json:"-"`
}

// MonthCloseResult reports what a school-wide close did.
type MonthCloseResult struct {
	Year         int                          `json:"year"`
	Month        int                          `json:"month"`
	ClosedStaff  int                          `json:"closed_staff"`
	SkippedStaff int                          `json:"skipped_staff"`
	Snapshots    []*StaffMonthBalanceSnapshot `json:"snapshots"`
}

// MonthClosing is the Monatsabschluss.
type MonthClosing interface {
	CloseMonth(ctx context.Context, closedBy int64, year, month int, reason string) (*MonthCloseResult, error)
	ReopenMonth(ctx context.Context, staffID, reopenedBy int64, year, month int, reason string) error
	ListMonthStatus(ctx context.Context, year, month int) ([]*StaffMonthBalanceSnapshot, error)
	// TraegerMonthStaff lists the staff a contract of the Träger covers in
	// the month: the Träger closes them, not the school (#4711).
	TraegerMonthStaff(ctx context.Context, year, month int) ([]int64, error)
}

// StaffOverview serves the tenant-wide time-tracking views.
type StaffOverview interface {
	DashboardSummary(ctx context.Context, period string) (*DashboardSummary, error)
	TimeTrackingOverview(ctx context.Context, filters OverviewFilters) (*TimeTrackingOverview, error)
	// TargetCoverage counts the active staff without a Soll in a month (#6890).
	// Year and month both zero mean the current month.
	TargetCoverage(ctx context.Context, year, month int) (*TargetCoverage, error)
}

// TimeTrackingAuditLog serves the cross-staff audit feed.
type TimeTrackingAuditLog interface {
	ListAuditLog(ctx context.Context, request AuditLogListRequest) (*AuditLogPage, error)
}

// PublicHoliday is one public holiday of the tenant's federal state.
type PublicHoliday struct {
	Date string `json:"date"`
	Name string `json:"name"`
}

// ClosingPeriod is one closure period of the school.
type ClosingPeriod struct {
	StartDate string
	EndDate   string
	Reason    string
}

// PlanningCalendar is the tenant-global calendar the time-tracking views mark:
// public holidays and closure periods overlapping a range of days.
type PlanningCalendar interface {
	HolidaysInRange(ctx context.Context, from, to string) ([]PublicHoliday, error)
	ClosingDaysInRange(ctx context.Context, from, to string) ([]ClosingPeriod, error)
}

// StaffTimeExport renders the cross-staff export.
type StaffTimeExport interface {
	ExportStaffTime(ctx context.Context, request TimeExportRequest, actorAccountID int64, actorRole string) (*ExportFile, error)
	DatevReport(ctx context.Context, request TimeExportRequest) (*DatevExportReport, error)
}

// VacationQuotaChange is a reasoned change of one staff member's yearly
// vacation entitlement (#3256).
type VacationQuotaChange struct {
	StaffID       int64
	Year          int
	EntitledDays  float64
	CarryoverDays float64
	Reason        string
	ChangedBy     int64
	// ExpectedVersion is the Version of the summary the form was read from
	// (ADR 0311); a claim changed since is not overwritten.
	ExpectedVersion string
}

// MonthCloseStaff is one staff member a school-wide month close may cover.
// ExternalCaregiver marks an external caregiver (#3823), who records no
// working time.
type MonthCloseStaff struct {
	ID                int64
	ExternalCaregiver bool
}
