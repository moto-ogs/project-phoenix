package timetracking

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// MonthSnapshot is the frozen carry balance consumed by month-close and overview.
type MonthSnapshot struct {
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

func (s *MonthSnapshot) IsActive() bool { return s.ReopenedAt == nil }

const (
	SnapshotSourceAdmin = "admin"
	// SnapshotSourceTraeger marks a close of the Träger (#4711).
	SnapshotSourceTraeger = "traeger"
)

// MonthSnapshots is the consumer-owned port for frozen balances.
type MonthSnapshots interface {
	LatestClosedMonth(context.Context, int64, int, int) (*MonthSnapshot, error)
	ClosedMonthSnapshots(context.Context, int, int) ([]*MonthSnapshot, error)
	ClosedMonthSnapshotsForStaff(context.Context, []int64) ([]*MonthSnapshot, error)
	RecordClosedMonth(context.Context, MonthSnapshot) (MonthSnapshot, error)
	ReopenMonthSnapshot(context.Context, int64, int64, time.Time, string) (int64, error)
	LockStaffBalanceWrites(context.Context, int64) error
}

// absenceMonthSnapshotReader supplies the active closes for a rebooking's staff.
type absenceMonthSnapshotReader interface {
	ClosedMonthSnapshotsForStaff(context.Context, []int64) ([]*MonthSnapshot, error)
}
