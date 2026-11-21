package presence

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/ports"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// Visit operations

func (s *service) CreateVisit(ctx context.Context, visit *studentpresence.Visit) error {
	return s.runInSessionTx(ctx, func(txCtx context.Context) error {
		return s.createVisit(txCtx, visit)
	})
}

func (s *service) createVisit(ctx context.Context, visit *studentpresence.Visit) error {
	return s.createVisitWithAdmission(ctx, visit, s.ensureStudentCheckinAllowed)
}

func (s *service) createVisitWithAdmission(ctx context.Context, visit *studentpresence.Visit, admission func(context.Context, int64) (*StudentRecord, error)) error {
	if !validPresenceVisit(visit) {
		return &ActiveError{Op: "CreateVisit", Err: ErrInvalidData}
	}

	// Validate the student exists and is not a graduated alumnus before INSERT
	// (prevents FK errors in logs and, via the FOR UPDATE lock, closes the race
	// against a concurrent grade-transition apply — see the helper doc, #405).
	// Runs BEFORE the binary-mode short-circuit: binary-mode check-ins reach
	// CreateVisit via the timetable path and would otherwise mark a departed
	// alumnus present without ever hitting this guard.
	student, err := admission(ctx, visit.StudentID)
	if err != nil {
		return &ActiveError{Op: "CreateVisit", Err: err}
	}

	// Binary-mode tenants don't track room visits — attendance is the only
	// surface. Short-circuit here so every caller (IoT, web, scheduler) stays
	// consistent without having to resolve the mode at each call site.
	mode, err := s.GetPresenceMode(ctx)
	if err != nil {
		return &ActiveError{Op: "CreateVisit", Err: errors.Join(ErrDatabaseOperation, err)}
	}
	if mode == PresenceModeBinary {
		return nil
	}

	// Only membership routing is stable under the guard's existing row lock.
	// Copy it before status clears; do not reuse the record's live flags.
	var educationGroupID *int64
	if student != nil && student.GroupID != nil {
		groupID := *student.GroupID
		educationGroupID = &groupID
	}
	if err := s.prepareVisitCheckIn(ctx, visit); err != nil {
		return err
	}
	return s.recordCheckedInVisit(ctx, visit, educationGroupID, student != nil)
}

// prepareVisitCheckIn runs the checks and attendance writes that precede a
// visit insert: the locked open target session, no other open visit, room
// capacity, the day's attendance and the flags a check-in clears.
func (s *service) prepareVisitCheckIn(ctx context.Context, visit *studentpresence.Visit) error {
	// Lock and re-check the target immediately before the visit-side writes.
	// The lock serializes check-ins with session absorption/end paths, which
	// take the same active.groups row lock before closing the session.
	targetGroup, err := s.lockActiveGroupOpenForUpdate(ctx, visit.ActiveGroupID)
	if err != nil {
		return &ActiveError{Op: "CreateVisit", Err: err}
	}

	deviceID, staffID := s.extractContextIDs(ctx)

	// Ensure no existing active visit for this student
	occupancy, err := s.visitAdmissionOccupancy(ctx, visit.StudentID, targetGroup.ID.Int64())
	if err != nil {
		return createVisitError(err)
	}
	if visit.ExitTime == nil {
		if err := s.ensureRoomCapacity(ctx, targetGroup.RoomID.Int64(), 1); err != nil {
			return err
		}
		if err := s.ensureActivityParticipantLimit(ctx, targetGroup, 1, occupancy); err != nil {
			return err
		}
	}

	// Handle attendance (create new or update on re-entry)
	if err := s.ensureOrUpdateAttendance(ctx, visit, staffID, deviceID); err != nil {
		return createVisitError(err)
	}

	// Auto-clear sickness / excused flags when student checks in
	// (only triggers when the tenant's clear_mode setting is "next_checkin").
	return s.autoClearCheckinStatuses(ctx, visit.StudentID, "CreateVisit")
}

// createVisitError keeps an operation error and hides any other failure
// behind the database sentinel.
func createVisitError(err error) error {
	if activeErr, ok := err.(*ActiveError); ok {
		return activeErr
	}
	return &ActiveError{Op: "CreateVisit", Err: ErrDatabaseOperation}
}

// recordCheckedInVisit inserts the visit, mirrors it into its timetable slot
// and queues the success event.
func (s *service) recordCheckedInVisit(ctx context.Context, visit *studentpresence.Visit, educationGroupID *int64, groupKnown bool) error {
	// Create the visit record
	visit.TenantID = tenant.FromContext(ctx)
	stored, err := s.SchoolPresence.RecordVisit(ctx, studentpresence.Visit{
		ID: visit.ID, TenantID: visit.TenantID, CreatedAt: visit.CreatedAt, UpdatedAt: visit.UpdatedAt,
		StudentID: visit.StudentID, ActiveGroupID: visit.ActiveGroupID,
		EntryTime: visit.EntryTime, ExitTime: visit.ExitTime,
	})
	if err != nil {
		// The partial unique index uniq_active_visits_open_per_student is the
		// race-safety net behind ensureStudentHasNoActiveVisit above. When
		// two concurrent requests both pass the read-then-write check, the
		// loser hits 23505 here. Translate to ErrStudentAlreadyActive so the
		// IoT handler maps it to 409 Conflict instead of 500.
		if isDuplicateActiveVisitViolation(err) {
			return &ActiveError{Op: "CreateVisit", Err: ErrStudentAlreadyActive}
		}
		return &ActiveError{Op: "CreateVisit", Err: ErrDatabaseOperation}
	}
	visit.ID, visit.CreatedAt, visit.UpdatedAt = stored.ID, stored.CreatedAt, stored.UpdatedAt

	// Mirror the visit into its timetable instance in the same transaction.
	// Missing assignments are valid; failures must precede any success event.
	var snapshot *AttendanceSnapshot
	if s.AttendanceSyncer != nil {
		snapshot, err = s.AttendanceSyncer.MirrorCheckInForVisit(ctx, presenceVisitSnapshot(visit))
		if err != nil {
			return &ActiveError{Op: "CreateVisit", Err: errors.Join(ErrDatabaseOperation, err)}
		}
	}

	// Queue the success event for commit.
	if groupKnown {
		s.broadcastVisitCreated(ctx, visit, snapshot, educationGroupID)
	} else {
		s.broadcastVisitCreated(ctx, visit, snapshot)
	}

	return nil
}

// isDuplicateActiveVisitViolation returns true when the store refused the
// visit on the partial unique index uniq_active_visits_open_per_student,
// defined in migration 1.15.47 on active.visits (tenant_id, student_id) WHERE
// exit_time IS NULL. The Postgres adapter matches the constraint name rather
// than just the error code, so a future unrelated unique index on
// active.visits doesn't accidentally translate into ErrStudentAlreadyActive.
func isDuplicateActiveVisitViolation(err error) bool {
	return errors.Is(err, ports.ErrOpenVisitExists)
}

// LockStudent takes the child's row lock in the caller's transaction. A
// presence write that holds a child locks it before any of the child's
// visits, as the bulk move and the check-in guard do (#5278); a caller that
// ends the child's visit and opens the next one locks the child before it
// reads that visit.
func (s *service) LockStudent(ctx context.Context, studentID int64) error {
	_, err := s.lockVisitStudent(ctx, studentID)
	return err
}

func (s *service) lockVisitStudent(ctx context.Context, studentID int64) (*StudentRecord, error) {
	if err := tenant.RequireTransaction(ctx); err != nil {
		return nil, &ActiveError{Op: "LockStudent", Err: err}
	}
	if studentID <= 0 {
		return nil, &ActiveError{Op: "LockStudent", Err: ErrStudentNotFound}
	}
	if s.StudentRepo == nil {
		return nil, nil
	}
	student, err := s.StudentRepo.FindByIDForUpdate(ctx, studentID)
	if err != nil {
		if IsNoRows(err) {
			return nil, &ActiveError{Op: "LockStudent", Err: ErrStudentNotFound}
		}
		return nil, &ActiveError{Op: "LockStudent", Err: errors.Join(ErrDatabaseOperation, err)}
	}
	return student, nil
}

func (s *service) EndVisit(ctx context.Context, id int64) error {
	return s.runInSessionTx(ctx, func(txCtx context.Context) error {
		return s.endVisit(txCtx, id)
	})
}

func (s *service) endVisit(ctx context.Context, id int64) error {
	// Binary-mode tenants don't keep visit rows, so there's nothing to end.
	// Callers that hold a stale visit ID from before a mode switch hit this
	// no-op path instead of a missing-row error.
	mode, err := s.GetPresenceMode(ctx)
	if err != nil {
		return &ActiveError{Op: "EndVisit", Err: errors.Join(ErrDatabaseOperation, err)}
	}
	if mode == PresenceModeBinary {
		return nil
	}

	endedVisit, snapshot, err := s.endVisitWithAttendanceSync(ctx, id)
	if err != nil {
		if activeErr, ok := err.(*ActiveError); ok {
			return activeErr
		}
		return &ActiveError{Op: "EndVisit", Err: ErrDatabaseOperation}
	}

	s.broadcastVisitCheckout(ctx, endedVisit, snapshot)
	return nil
}

// endVisitWithAttendanceSync closes one visit and mirrors its exact persisted
// checkout timestamp into slot attendance. Session-end and timeout paths use
// this helper too. The one visit-ending path that bypasses it — the nightly
// bulk close in EndDailySessions — mirrors its checkouts via the scheduler's
// session-end bridge (CloseOpenCheckoutsByActiveGroupIDs).
// A missing bridge returns no snapshot. Sync failures abort the visit close.
func (s *service) endVisitWithAttendanceSync(
	ctx context.Context, id int64,
) (*studentpresence.Visit, *AttendanceSnapshot, error) {
	endedVisit, err := s.endVisitRecord(ctx, id)
	if err != nil {
		return nil, nil, err
	}

	var snapshot *AttendanceSnapshot
	if s.AttendanceSyncer != nil {
		snapshot, err = s.AttendanceSyncer.MirrorCheckOutForVisit(ctx, presenceVisitSnapshot(endedVisit))
		if err != nil {
			return nil, nil, &ActiveError{Op: "EndVisit", Err: errors.Join(ErrDatabaseOperation, err)}
		}
	}
	s.wakeGuardiansAfterCommit(ctx, endedVisit.StudentID)
	return endedVisit, snapshot, nil
}

// endVisitRecord ends the visit record and returns the updated visit. The
// close only touches an open visit; a close that ends nothing reads the visit
// to tell a missing visit from an ended one.
func (s *service) endVisitRecord(ctx context.Context, id int64) (*studentpresence.Visit, error) {
	closed, err := s.SchoolPresence.CloseVisits(ctx, []int64{id}, s.now())
	if err != nil {
		return nil, &ActiveError{Op: "EndVisit", Err: errors.Join(ErrDatabaseOperation, err)}
	}
	if len(closed) > 0 {
		return &closed[0], nil
	}
	visit, err := s.SchoolPresence.FindVisit(ctx, id)
	if err != nil {
		if errors.Is(err, studentpresence.ErrVisitNotFound) {
			return nil, &ActiveError{Op: "EndVisit", Err: ErrVisitNotFound}
		}
		return nil, &ActiveError{Op: "EndVisit", Err: errors.Join(ErrDatabaseOperation, err)}
	}
	if visit == nil {
		return nil, &ActiveError{Op: "EndVisit", Err: ErrVisitNotFound}
	}
	return nil, &ActiveError{Op: "EndVisit", Err: ErrVisitAlreadyEnded}
}

// visitSSEData holds data needed for SSE broadcasts after a visit is ended
type visitSSEData struct {
	StudentID        int64
	EducationGroupID *int64
}
