package workforce

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The Stundenkonto of a Personalakte over all schools with the Monatsabschluss
// of the Träger (#4711, ADR 0089 section 10, ADR 0243). Each school keeps the
// recorded times and computes its month as before; the Träger reads every
// school of the record in that school's tenant transaction, sums the months
// and closes them where a contract of the Träger covers the month.

// TraegerStaffViewTimeAccount is the access log view of the Stundenkonto.
const TraegerStaffViewTimeAccount = "staff_time_account"

// The states of a month of the Stundenkonto.
const (
	// TraegerMonthOpen: a contract covers the month at one school at least
	// and the Träger has not closed it everywhere.
	TraegerMonthOpen = "open"
	// TraegerMonthClosed: every school the Träger closes is closed.
	TraegerMonthClosed = "closed"
	// TraegerMonthSchool: no contract covers the month; the schools close it.
	TraegerMonthSchool = "school"
)

var (
	// ErrMonthClosedByTraeger refuses the school a reopen of a close of the
	// Personalverwaltung of the Träger.
	ErrMonthClosedByTraeger = errors.New("month was closed by the traeger")
	// ErrMonthClosedBySchool refuses the Träger a reopen of a close the
	// school wrote itself.
	ErrMonthClosedBySchool = errors.New("month was closed by the school")
	// ErrMonthNotKeptByTraeger refuses the Träger a close of a month no
	// contract of the Träger covers.
	ErrMonthNotKeptByTraeger = errors.New("no contract of the traeger covers the month")
)

// TraegerSchoolMonthError names the school a close or reopen of the Träger
// stopped at; Err is the cause.
type TraegerSchoolMonthError struct {
	SchoolID   int64
	SchoolName string
	// LaterMonth is the later closed month (YYYY-MM) that stopped it, if any.
	LaterMonth string
	Err        error
}

func (e *TraegerSchoolMonthError) Error() string {
	return fmt.Sprintf("school %d: %v", e.SchoolID, e.Err)
}

func (e *TraegerSchoolMonthError) Unwrap() error { return e.Err }

// TraegerSchoolMonth is the month of one employment as its school computes
// it.
type TraegerSchoolMonth struct {
	Summary MonthSummary
	// Kept is true when a contract of the Träger covers the month.
	Kept bool
	// Ended is true once the month is over.
	Ended bool
	// LaterClosed is the latest closed month after this one (YYYY-MM), or
	// empty.
	LaterClosed string
}

// TraegerStaffMonths reads, closes and reopens the month of one employment
// in the school of the caller's tenant transaction.
type TraegerStaffMonths interface {
	TraegerMonthAccount(ctx context.Context, staffID int64, year, month int) (TraegerSchoolMonth, error)
	// CloseMonthForTraeger reports false when the month was closed already.
	CloseMonthForTraeger(ctx context.Context, staffID, accountID int64, year, month int, reason string) (bool, error)
	ReopenMonthForTraeger(ctx context.Context, staffID, accountID int64, year, month int, reason string) error
}

// TraegerTimeAccountMinutes are the minutes of a month, at one school or
// summed over all of them.
type TraegerTimeAccountMinutes struct {
	// TargetMinutes is the Soll up to today, the whole month once it is over.
	TargetMinutes int `json:"target_minutes"`
	// ActualMinutes is the worked time; CreditedMinutes what absences count.
	ActualMinutes   int `json:"actual_minutes"`
	CreditedMinutes int `json:"credited_minutes"`
	// AdjustmentMinutes are payouts, comp time and opening balances.
	AdjustmentMinutes int `json:"adjustment_minutes"`
	// BalanceMinutes is the month's own result, ClosingBalanceMinutes the
	// account after it with the carry from before.
	BalanceMinutes        int `json:"balance_minutes"`
	CarryInMinutes        int `json:"carry_in_minutes"`
	ClosingBalanceMinutes int `json:"closing_balance_minutes"`
}

// TraegerTimeAccountSchool is one school of the record in the month.
type TraegerTimeAccountSchool struct {
	SchoolID   ident.ID `json:"school_id"`
	SchoolName string   `json:"school_name"`
	TraegerTimeAccountMinutes
	// HasTarget is false when the school keeps no Soll for the month.
	HasTarget bool `json:"has_target"`
	// ByTraeger is true when a contract of the Träger covers the month here.
	ByTraeger       bool       `json:"by_traeger"`
	Closed          bool       `json:"closed"`
	ClosedByTraeger bool       `json:"closed_by_traeger"`
	ClosedAt        *time.Time `json:"closed_at,omitempty"`
	CloseReason     string     `json:"close_reason,omitempty"`
	// DriftMinutes is what changed in the school since the close.
	DriftMinutes int `json:"drift_minutes"`
	// LaterClosed is a closed month after this one (YYYY-MM): it has to be
	// reopened before this one changes.
	LaterClosed string `json:"later_closed,omitempty"`
}

// TraegerTimeAccount is the Stundenkonto of a record in one month.
type TraegerTimeAccount struct {
	Year  int `json:"year"`
	Month int `json:"month"`
	TraegerTimeAccountMinutes
	// State is TraegerMonthOpen, TraegerMonthClosed or TraegerMonthSchool.
	State string `json:"state"`
	// Ended is true once the month is over; only then may it be closed.
	Ended   bool                       `json:"ended"`
	Schools []TraegerTimeAccountSchool `json:"schools"`
}

// TraegerMonthChange closes or reopens one month of a record, with the
// reason the schools' trail keeps.
type TraegerMonthChange struct {
	Year   int
	Month  int
	Reason string
}

// TraegerStaffTimeAccounts is the Stundenkonto of the Personalakte.
// TimeAccount reads this month when year and month are both 0.
type TraegerStaffTimeAccounts interface {
	TimeAccount(ctx context.Context, actor TraegerStaffActor, recordID int64, year, month int) (TraegerTimeAccount, error)
	CloseTimeAccountMonth(ctx context.Context, actor TraegerStaffActor, recordID int64, change TraegerMonthChange) (TraegerTimeAccount, error)
	ReopenTimeAccountMonth(ctx context.Context, actor TraegerStaffActor, recordID int64, change TraegerMonthChange) (TraegerTimeAccount, error)
}
