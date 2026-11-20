package presence

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
)

// PresenceOperations is the consumer-owned port for the retained presence
// commands and reads these routes still delegate. The root composition binds
// it to the retained active service; every value and error it exchanges is
// the Student Presence owner's public contract, so this package classifies
// outcomes without the retained service.
type PresenceOperations interface {
	// Supervision
	EndSupervision(context.Context, int64) error
	ClaimSupervision(context.Context, int64, int64, string) (studentpresence.ClaimedSupervision, error)

	// Attendance
	StudentAttendanceStatus(context.Context, int64) (*studentpresence.AttendanceStatus, error)
	CheckOutStudent(context.Context, int64, int64) (studentpresence.CheckoutOutcome, error)

	// Moves
	AssignTransitStudents(context.Context, []int64, int64, studentpresence.StudentMoveAuthorization) (studentpresence.TransitAssignResult, error)
	MoveStudentsToSession(context.Context, []int64, int64, studentpresence.StudentMoveAuthorization) (studentpresence.StudentMoveResult, error)
	// CheckInStudentsToSessionAuthorized checks children in and places them
	// in a running session in one unit (#6953).
	CheckInStudentsToSessionAuthorized(ctx context.Context, studentIDs []int64, activeGroupID, staffID int64, auth studentpresence.StudentMoveAuthorization, keepPresent bool) (*studentpresence.StudentMoveResult, error)

	// Reads
	SessionRooms(context.Context, []int64) ([]studentpresence.SessionRoomSummary, error)
	DashboardAnalytics(context.Context) (studentpresence.DashboardAnalytics, error)
	CrossTenantStudents(context.Context, int64) ([]studentpresence.CrossTenantStudent, error)
	GetTrackingIndicators(context.Context, []int64, []string) (map[int64][]bool, error)
}

// presenceError names the failed presence read together with its cause. Its
// message keeps the historical "active: <op>: <cause>" wire text.
type presenceError struct {
	Op  string
	Err error
}

func (e *presenceError) Error() string {
	if e.Err == nil {
		return fmt.Sprintf("active: %s: unknown error", e.Op)
	}
	return fmt.Sprintf("active: %s: %v", e.Op, e.Err)
}

func (e *presenceError) Unwrap() error { return e.Err }
