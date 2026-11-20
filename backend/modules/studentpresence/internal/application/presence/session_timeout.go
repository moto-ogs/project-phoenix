package presence

import (
	"context"
	"maps"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/ports"
)

// collectActiveVisitsForSSE gathers visit and student data needed for SSE broadcasts
func (s *service) collectActiveVisitsForSSE(ctx context.Context, sessionID int64) ([]visitSSEData, error) {
	visits, err := s.SchoolPresence.ListVisits(ctx, studentpresence.VisitFilter{ActiveGroupIDs: []int64{sessionID}})
	if err != nil {
		return nil, err
	}

	// Filter active visits and collect unique student IDs
	var activeVisits []studentpresence.Visit
	studentIDSet := make(map[int64]struct{})
	for _, visit := range visits {
		if visit.ExitTime != nil {
			continue
		}
		activeVisits = append(activeVisits, visit)
		studentIDSet[visit.StudentID] = struct{}{}
	}

	if len(activeVisits) == 0 {
		return nil, nil
	}

	// Resolve educational-group routing in one batch.
	studentIDs := slices.Collect(maps.Keys(studentIDSet))
	studentGroups, err := s.EducationGroupRepo.StudentGroupIDs(ctx, studentIDs)
	if err != nil {
		studentGroups = nil
	}

	// Build result using map lookups (O(1) per visit)
	result := make([]visitSSEData, 0, len(activeVisits))
	for _, visit := range activeVisits {
		data := visitSSEData{
			StudentID: visit.StudentID,
		}
		if groupID, ok := studentGroups[visit.StudentID]; ok {
			data.EducationGroupID = &groupID
		}
		result = append(result, data)
	}

	return result, nil
}

// sessionTimeoutCheck judges the locked, still open session before the
// timeout writes anything. A non-nil error skips the timeout.
type sessionTimeoutCheck func(context.Context, *ports.ActiveGroup) error

// ProcessSessionTimeoutByID handles session timeout by session ID directly.
// It verifies under the session lock that the session is still active before
// ending it. A nil check ends it unconditionally; the abandoned-session sweep
// passes one that re-judges inactivity under the same lock (#6502).
func (s *service) ProcessSessionTimeoutByID(ctx context.Context, sessionID int64, check sessionTimeoutCheck) (*TimeoutResult, error) {
	// Collect visit data BEFORE transaction for SSE broadcasts
	visitsToNotify, err := s.collectActiveVisitsForSSE(ctx, sessionID)
	if err != nil {
		// Non-fatal: continue without SSE data
		visitsToNotify = nil
	}

	// Every write below runs in ONE transaction (#1747 review). The abandoned-
	// session sweep calls this straight from the scheduler, with no request
	// middleware around it: without a transaction of its own the bridge would
	// commit a completed timetable instance and a later failure would leave the
	// session open beside it — a split that the next sweep cannot repair,
	// because it only ever sees the still-active session and would re-bridge an
	// instance that is already completed. RunInTx joins the caller's
	// transaction when there is one.
	var result *TimeoutResult
	var endData activityEndSSEData
	if err := s.runInSessionTx(ctx, func(txCtx context.Context) error {
		res, end, err := s.processSessionTimeoutTx(txCtx, sessionID, check)
		if err != nil {
			return err
		}
		result, endData = res, end
		return nil
	}); err != nil {
		if activeErr, ok := err.(*ActiveError); ok {
			return nil, activeErr
		}
		return nil, &ActiveError{Op: "ProcessSessionTimeoutByID", Err: err}
	}

	// The SSE events go out after the commit; the payload was read inside the
	// transaction, so the hook needs no database access (#2951).
	s.queueActivitySessionEndBroadcasts(ctx, sessionID, sessionEndSSEData{Visits: visitsToNotify, End: endData})

	return result, nil
}

// processSessionTimeoutTx holds every write of a session timeout. It runs
// inside one transaction and announces nothing — the SSE events belong to the
// caller, after the commit. The returned activityEndSSEData is that event's
// payload, resolved while the transaction still holds the tenant role.
func (s *service) processSessionTimeoutTx(ctx context.Context, sessionID int64, check sessionTimeoutCheck) (*TimeoutResult, activityEndSSEData, error) {
	if err := s.SchoolPresence.PrepareVisitWrites(ctx, studentpresence.VisitWriteScope{GroupIDs: []int64{sessionID}}); err != nil {
		return nil, activityEndSSEData{}, err
	}
	session, err := s.GroupRepo.FindByIDForUpdate(ctx, sessionID)
	if err != nil || session == nil {
		return nil, activityEndSSEData{}, &ActiveError{Op: "ProcessSessionTimeoutByID", Err: ErrActiveGroupNotFound}
	}
	if !session.IsActive() {
		return nil, activityEndSSEData{}, &ActiveError{Op: "ProcessSessionTimeoutByID", Err: ErrActiveGroupAlreadyEnded}
	}
	if check != nil {
		if err := check(ctx, session); err != nil {
			return nil, activityEndSSEData{}, &ActiveError{Op: "ProcessSessionTimeoutByID", Err: err}
		}
	}

	// The timetable side closes FIRST, before anything is announced (#1747
	// review). A timed-out session is still a session end: without the bridge
	// the mirrored instance stays active indefinitely and its expected rows are
	// never finalized. Running it ahead of the checkouts and the session end
	// keeps the failure-prone half in front of the SSE events the caller fires,
	// so a bridge error never announces an end that the transaction rolls back.
	if err := s.completeTimetableMirrorsForEndedSessions(ctx, []int64{sessionID}); err != nil {
		return nil, activityEndSSEData{}, &ActiveError{Op: "ProcessSessionTimeoutByID", Err: err}
	}

	ended, err := s.closeGroupSession(ctx, "ProcessSessionTimeoutByID", sessionID)
	if err != nil {
		return nil, activityEndSSEData{}, err
	}

	endData, err := s.collectActivityEndSSE(ctx, session)
	if err != nil {
		return nil, activityEndSSEData{}, &ActiveError{Op: "ProcessSessionTimeoutByID", Err: err}
	}

	return &TimeoutResult{
		SessionID:          sessionID,
		ActivityID:         session.GroupID,
		StudentsCheckedOut: len(ended.ClosedVisits),
		TimeoutAt:          ended.EndedAt,
	}, endData, nil
}
