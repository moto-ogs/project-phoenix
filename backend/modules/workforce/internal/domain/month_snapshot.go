package domain

import (
	"errors"
	"slices"
	"time"
)

// SnapshotSourceTraeger marks a close the Personalverwaltung of the Träger
// wrote for a person with an Arbeitsvertrag (#4711). Only the Träger reopens it.
const SnapshotSourceTraeger = "traeger"

type StaffMonthBalanceSnapshot struct {
	ID                    int64
	CreatedAt             time.Time
	UpdatedAt             time.Time
	TenantID              int64
	StaffID               int64
	Year                  int
	Month                 int
	ClosingBalanceMinutes int
	CarryInMinutes        int
	TargetMinutes         int
	ActualMinutes         int
	CreditedMinutes       int
	AdjustmentMinutes     int
	ClosedAt              time.Time
	ClosedBy              int64
	// ClosedByAccountID is the Personalverwaltung of the Träger that closed
	// the month (source traeger, #4711); ClosedBy is then zero.
	ClosedByAccountID   int64
	CloseReason         string
	Source              string
	ReopenedAt          *time.Time
	ReopenedBy          *int64
	ReopenedByAccountID *int64
	ReopenReason        string
	PayrollRules        []byte
}

func (s StaffMonthBalanceSnapshot) Validate() error {
	if s.StaffID <= 0 {
		return errors.New("staff ID is required")
	}
	if s.Month < 1 || s.Month > 12 {
		return errors.New("month must be between 1 and 12")
	}
	if s.Year < 2000 || s.Year > 2100 {
		return errors.New("year must be between 2000 and 2100")
	}
	if !slices.Contains([]string{"admin", "scheduler", "migration", SnapshotSourceTraeger}, s.Source) {
		return errors.New("invalid snapshot source")
	}
	if s.Source == SnapshotSourceTraeger {
		if s.ClosedByAccountID <= 0 || s.ClosedBy != 0 {
			return errors.New("a close of the traeger names its account and no staff member")
		}
	} else if s.ClosedBy <= 0 || s.ClosedByAccountID != 0 {
		return errors.New("closed_by is required")
	}
	return nil
}
