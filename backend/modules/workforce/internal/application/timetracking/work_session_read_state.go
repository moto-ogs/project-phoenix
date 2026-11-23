package timetracking

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// sessionVersion is the token of a work block as the history shows it: its
// recorded times, status, note and every break (ADR 0311). Breaks live in
// their own rows and no trigger bumps the block's updated_at, so the token
// is a fingerprint, not the change time.
func sessionVersion(session *WorkSession, breaks []*WorkSessionBreak) string {
	type breakState struct {
		ID       int64      `json:"id"`
		Started  time.Time  `json:"started"`
		Ended    *time.Time `json:"ended"`
		Duration int        `json:"duration"`
	}
	state := struct {
		Date     string       `json:"date"`
		Status   string       `json:"status"`
		CheckIn  time.Time    `json:"check_in"`
		CheckOut *time.Time   `json:"check_out"`
		Breaks   int          `json:"break_minutes"`
		Notes    string       `json:"notes"`
		Pauses   []breakState `json:"breaks"`
	}{
		Date: session.Date.String(), Status: session.Status, CheckIn: session.CheckInTime.UTC(), CheckOut: utcOrNil(session.CheckOutTime),
		Breaks: session.BreakMinutes, Notes: session.Notes, Pauses: make([]breakState, 0, len(breaks)),
	}
	for _, pause := range breaks {
		state.Pauses = append(state.Pauses, breakState{ID: pause.ID, Started: pause.StartedAt.UTC(), Ended: utcOrNil(pause.EndedAt), Duration: pause.DurationMinutes})
	}
	return readstate.Fingerprint(state)
}

func utcOrNil(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	utc := value.UTC()
	return &utc
}

// checkSessionVersion refuses a correction over a block that changed since
// the form read it. It runs after the staff balance lock, which every
// writer of the block and its breaks takes. Nil is a write that showed no
// history row.
func (s *workSessionService) checkSessionVersion(ctx context.Context, session *WorkSession, expected *string) error {
	if expected == nil {
		return nil
	}
	records, err := s.breakRepo.ListWorkSessionBreaks(ctx, workforce.WorkSessionBreakFilter{SessionID: session.ID})
	if err != nil {
		return fmt.Errorf("failed to load session breaks: %w", err)
	}
	return readstate.Check(*expected, sessionVersion(session, workSessionBreaksToRecords(records)))
}
