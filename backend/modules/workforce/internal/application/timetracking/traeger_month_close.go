package timetracking

import (
	"context"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The Monatsabschluss of the Träger (#4711, ADR 0240): a contract of the
// Träger with a Soll at the school makes the Personalverwaltung close the
// person's month in every school of the Personalakte. The close is the
// school's own snapshot with source traeger, so every lock and the frozen
// Übertrag of the school apply unchanged; the school leaves the person out
// of its own close and may not reopen it.

// TraegerMonthStaff names, for each month of first..last keyed by its first
// day, the staff members of the school a contract of the Träger covers, in
// one read. It joins the caller's tenant transaction.
type TraegerMonthStaff interface {
	TraegerKeptStaffByMonth(ctx context.Context, staffIDs []int64, first, last calendar.Date) (map[calendar.Date][]int64, error)
}

// TraegerMonthClosing is the month of one staff member as the Träger reads,
// closes and reopens it, in the school's tenant transaction.
type TraegerMonthClosing interface {
	TraegerMonthState(ctx context.Context, staffID int64, year, month int) (*TraegerMonthState, error)
	// CloseMonthForTraeger reports false when the month was closed already.
	CloseMonthForTraeger(ctx context.Context, staffID, accountID int64, year, month int, reason string) (bool, error)
	ReopenMonthForTraeger(ctx context.Context, staffID, accountID int64, year, month int, reason string) error
}

// TraegerMonthState is what the Träger needs besides the Monatskarte of one
// staff member's month at the school.
type TraegerMonthState struct {
	// Kept is true when a contract of the Träger covers the month.
	Kept bool
	// Ended is true once the month is over and may be closed.
	Ended bool
	// LaterClosed names the latest closed month after this one, if any.
	LaterClosed *monthKey
}

// monthCloser names who writes a close: a staff member of the school or the
// Träger account.
type monthCloser struct {
	staffID   int64
	accountID int64
	source    string
}

// withoutTraegerStaff drops the staff members the Träger closes in key and
// counts them.
func (s *staffMonthCloseService) withoutTraegerStaff(ctx context.Context, staffIDs []int64, key monthKey) ([]int64, int, error) {
	kept, err := s.traegerKept(ctx, staffIDs, key)
	if err != nil || len(kept) == 0 {
		return staffIDs, 0, err
	}
	remaining := slices.DeleteFunc(slices.Clone(staffIDs), func(id int64) bool { return slices.Contains(kept, id) })
	return remaining, len(staffIDs) - len(remaining), nil
}

func (s *staffMonthCloseService) traegerKept(ctx context.Context, staffIDs []int64, key monthKey) ([]int64, error) {
	if s.traeger == nil || len(staffIDs) == 0 {
		return nil, nil
	}
	kept, err := s.traeger.TraegerKeptStaffByMonth(ctx, staffIDs, key.firstDay(), key.lastDay())
	if err != nil {
		return nil, fmt.Errorf("failed to read the staff the traeger closes: %w", err)
	}
	return kept[key.firstDay()], nil
}

// monthCloseStaffIDs lists the staff a month close covers. External
// caregivers (#3823) record no working time to close.
func (s *staffMonthCloseService) monthCloseStaffIDs(ctx context.Context) ([]int64, error) {
	staffMembers, err := s.staffLister.ListMonthCloseStaff(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list staff for month close: %w", err)
	}
	staffIDs := make([]int64, 0, len(staffMembers))
	for _, member := range staffMembers {
		if !member.ExternalCaregiver {
			staffIDs = append(staffIDs, member.ID)
		}
	}
	return staffIDs, nil
}

func (s *staffMonthCloseService) TraegerMonthStaff(ctx context.Context, year, month int) ([]int64, error) {
	if err := validateMonth(year, month); err != nil {
		return nil, fmt.Errorf("%w: %s", ErrMonthCloseInvalid, err.Error())
	}
	staffIDs, err := s.monthCloseStaffIDs(ctx)
	if err != nil {
		return nil, err
	}
	kept, err := s.traegerKept(ctx, staffIDs, monthKey{Year: year, Month: month})
	if err != nil {
		return nil, err
	}
	kept = slices.Clone(kept)
	slices.Sort(kept)
	if kept == nil {
		kept = []int64{}
	}
	return kept, nil
}

func (s *staffMonthCloseService) TraegerMonthState(ctx context.Context, staffID int64, year, month int) (*TraegerMonthState, error) {
	if err := validateMonth(year, month); err != nil {
		return nil, fmt.Errorf("%w: %s", ErrMonthCloseInvalid, err.Error())
	}
	key := monthKey{Year: year, Month: month}
	kept, err := s.traegerKept(ctx, []int64{staffID}, key)
	if err != nil {
		return nil, err
	}
	closed, err := s.closedMonthsByStaff(ctx, []int64{staffID}, key)
	if err != nil {
		return nil, err
	}
	account := &TraegerMonthState{Kept: len(kept) > 0, Ended: calendarMonthHasEnded(key, calendar.DateFromTime(s.now()))}
	if latest := closed[staffID].latest; latest != nil && key.before(*latest) {
		account.LaterClosed = latest
	}
	return account, nil
}

func (s *staffMonthCloseService) CloseMonthForTraeger(ctx context.Context, staffID, accountID int64, year, month int, reason string) (bool, error) {
	if staffID <= 0 || accountID <= 0 {
		return false, fmt.Errorf("%w: staff id and account are required", ErrMonthCloseInvalid)
	}
	key, trimmedReason, err := s.validateCloseRequest(ctx, year, month, reason)
	if err != nil {
		return false, err
	}
	payrollRules, err := s.frozenPayrollRules(ctx)
	if err != nil {
		return false, err
	}
	closedMonths, err := s.lockAndReadClosedMonths(ctx, []int64{staffID}, key)
	if err != nil {
		return false, err
	}
	// Under the balance lock: the contract may have changed since the read.
	kept, err := s.traegerKept(ctx, []int64{staffID}, key)
	if err != nil {
		return false, err
	}
	if len(kept) == 0 {
		return false, fmt.Errorf("%w: %04d-%02d for staff %d", ErrMonthNotKeptByTraeger, year, month, staffID)
	}
	closer := monthCloser{accountID: accountID, source: SnapshotSourceTraeger}
	_, alreadyClosed, err := s.closeStaffMonth(ctx, staffID, closer, key, trimmedReason, s.now(), payrollRules, closedMonths[staffID])
	if err != nil || alreadyClosed {
		return false, err
	}
	s.getLogger().Info("month balance closed by traeger",
		"staff_id", staffID,
		"year", year,
		"month", month,
		"account_id", accountID,
	)
	s.broadcastTimeTrackingChanged(ctx)
	return true, nil
}

func (s *staffMonthCloseService) ReopenMonthForTraeger(ctx context.Context, staffID, accountID int64, year, month int, reason string) error {
	return s.reopenStaffMonth(ctx, staffID, accountID, true, year, month, reason)
}

// reopenerMayReopen keeps a close with its author: the Träger reopens its
// own closes, the school the ones it wrote itself.
func reopenerMayReopen(snapshot MonthSnapshot, byTraeger bool) error {
	switch byTraeger {
	case snapshot.Source == SnapshotSourceTraeger:
		return nil
	case true:
		return fmt.Errorf("%w: %04d-%02d", ErrMonthClosedBySchool, snapshot.Year, snapshot.Month)
	default:
		return fmt.Errorf("%w: %04d-%02d", ErrMonthClosedByTraeger, snapshot.Year, snapshot.Month)
	}
}
