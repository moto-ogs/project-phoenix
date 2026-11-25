package timetracking

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Terminal-only stamping (#8024). A school can keep stamping at the NFC
// terminal: with the setting on, a staff member whose account does not hold
// the right to manage working time gets a work block only by scanning the
// own chip there. Every other way to a block or to other recorded times is
// closed for them in one place, here:
//
//   - the stamps of the app (check-in with the app channel, and the check-out
//     and break stamps that carry no terminal day),
//   - the automatic check-in a supervision or attendance action triggers,
//     from the app and from a kiosk that only authenticated the device,
//   - a self-edit that moves recorded times.
//
// The kiosk's own stamps (NFC channel, day-pinned), the leadership's
// corrections, the scheduled check-out and break sweeps and a block that is
// already running stay as they are.

// TerminalOnlyStamping reports whether the rule applies to the staff member.
// A failed read is an error, never "not restricted": the caller refuses the
// write instead of lifting the lock. Services built without settings (bare
// unit fixtures) have no rule.
func (s *workSessionService) TerminalOnlyStamping(ctx context.Context, staffID int64) (bool, error) {
	if s.settings == nil {
		return false, nil
	}
	enabled, err := s.settings.TerminalOnlyStamping(ctx)
	if err != nil {
		return false, fmt.Errorf("failed to resolve terminal-only stamping setting: %w", err)
	}
	if !enabled {
		return false, nil
	}
	if s.timeTrackingManagers == nil {
		return false, fmt.Errorf("time-tracking manager lookup not configured")
	}
	managers, err := s.timeTrackingManagers.FindTimeTrackingManagerStaffIDs(ctx, []int64{staffID})
	if err != nil {
		return false, fmt.Errorf("failed to resolve time-tracking rights of staff %d: %w", staffID, err)
	}
	return !managers[staffID], nil
}

// ensureAppStampAllowed refuses a stamp made in the app for a staff member
// who stamps at the terminal only.
func (s *workSessionService) ensureAppStampAllowed(ctx context.Context, staffID int64) error {
	restricted, err := s.TerminalOnlyStamping(ctx, staffID)
	if err != nil {
		return err
	}
	if restricted {
		return workforce.ErrTerminalOnlyStamping
	}
	return nil
}

// ensureSelfTimeEditAllowed refuses a self-edit that moves the recorded day,
// times or breaks for a staff member who stamps at the terminal only. Status
// and notes stay editable: they change no recorded time.
func (s *workSessionService) ensureSelfTimeEditAllowed(ctx context.Context, session *WorkSession, updates SessionUpdateRequest) error {
	movesDay := updates.Date != nil && calendar.DateFromTime(*updates.Date) != session.Date
	if !movesDay && !s.selfEditChangesRecordedTimes(session, updates) {
		return nil
	}
	restricted, err := s.TerminalOnlyStamping(ctx, session.StaffID)
	if err != nil {
		return err
	}
	if restricted {
		return workforce.ErrTerminalOnlyTimeEdit
	}
	return nil
}
