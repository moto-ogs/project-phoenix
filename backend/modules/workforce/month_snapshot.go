package workforce

import (
	"context"
	"time"
)

const (
	SnapshotSourceAdmin     = "admin"
	SnapshotSourceScheduler = "scheduler"
	SnapshotSourceMigration = "migration"
	// SnapshotSourceTraeger is a close of the Personalverwaltung of the
	// Träger (#4711); only the Träger reopens it.
	SnapshotSourceTraeger = "traeger"
)

// MonthSnapshots stores frozen carry balances and their reopening history.
// Reads exclude reopened snapshots. Writes join the caller's tenant transaction.
type MonthSnapshots interface {
	MonthSnapshotQuery
	MonthSnapshotCommand
	LockStaffBalanceWrites(context.Context, int64) error
}

type MonthSnapshotQuery interface {
	ClosedMonthSnapshotsForStaff(context.Context, []int64) ([]*StaffMonthBalanceSnapshot, error)
	LatestClosedMonth(context.Context, int64, int, int) (*StaffMonthBalanceSnapshot, error)
	ClosedMonthSnapshots(context.Context, int, int) ([]*StaffMonthBalanceSnapshot, error)
}

type MonthSnapshotCommand interface {
	RecordClosedMonth(context.Context, StaffMonthBalanceSnapshot) (StaffMonthBalanceSnapshot, error)
	ReopenMonthSnapshot(context.Context, int64, int64, time.Time, string) (int64, error)
}

func (s *StaffMonthBalanceSnapshot) IsActive() bool { return s.ReopenedAt == nil }
