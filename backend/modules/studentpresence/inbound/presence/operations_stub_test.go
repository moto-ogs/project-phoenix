package presence

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
)

// stubPresenceOperations is the func-field double for the presence
// operations port. A nil field answers with zero values, so a test wires only
// the operations its handler exercises.
type stubPresenceOperations struct {
	endSupervision           func(context.Context, int64) error
	claimSupervision         func(context.Context, int64, int64, string) (studentpresence.ClaimedSupervision, error)
	studentAttendanceStatus  func(context.Context, int64) (*studentpresence.AttendanceStatus, error)
	assignTransitStudents    func(context.Context, []int64, int64, studentpresence.StudentMoveAuthorization) (studentpresence.TransitAssignResult, error)
	moveStudentsToSession    func(context.Context, []int64, int64, studentpresence.StudentMoveAuthorization) (studentpresence.StudentMoveResult, error)
	checkInStudentsToSession func(context.Context, []int64, int64, int64, studentpresence.StudentMoveAuthorization, bool) (*studentpresence.StudentMoveResult, error)
	sessionRooms             func(context.Context, []int64) ([]studentpresence.SessionRoomSummary, error)
	dashboardAnalytics       func(context.Context) (studentpresence.DashboardAnalytics, error)
	crossTenantStudents      func(context.Context, int64) ([]studentpresence.CrossTenantStudent, error)
	trackingIndicators       func(context.Context, []int64, []string) (map[int64][]bool, error)
}

func (s *stubPresenceOperations) EndSupervision(ctx context.Context, id int64) error {
	if s.endSupervision != nil {
		return s.endSupervision(ctx, id)
	}
	return nil
}

func (s *stubPresenceOperations) ClaimSupervision(ctx context.Context, groupID, staffID int64, role string) (studentpresence.ClaimedSupervision, error) {
	if s.claimSupervision != nil {
		return s.claimSupervision(ctx, groupID, staffID, role)
	}
	return studentpresence.ClaimedSupervision{}, nil
}

func (s *stubPresenceOperations) StudentAttendanceStatus(ctx context.Context, studentID int64) (*studentpresence.AttendanceStatus, error) {
	if s.studentAttendanceStatus != nil {
		return s.studentAttendanceStatus(ctx, studentID)
	}
	return nil, nil
}

func (s *stubPresenceOperations) AssignTransitStudents(ctx context.Context, studentIDs []int64, activeGroupID int64, auth studentpresence.StudentMoveAuthorization) (studentpresence.TransitAssignResult, error) {
	if s.assignTransitStudents != nil {
		return s.assignTransitStudents(ctx, studentIDs, activeGroupID, auth)
	}
	return studentpresence.TransitAssignResult{}, nil
}

func (s *stubPresenceOperations) MoveStudentsToSession(ctx context.Context, studentIDs []int64, activeGroupID int64, auth studentpresence.StudentMoveAuthorization) (studentpresence.StudentMoveResult, error) {
	if s.moveStudentsToSession != nil {
		return s.moveStudentsToSession(ctx, studentIDs, activeGroupID, auth)
	}
	return studentpresence.StudentMoveResult{}, nil
}

func (s *stubPresenceOperations) SessionRooms(ctx context.Context, ids []int64) ([]studentpresence.SessionRoomSummary, error) {
	if s.sessionRooms != nil {
		return s.sessionRooms(ctx, ids)
	}
	return nil, nil
}

func (s *stubPresenceOperations) DashboardAnalytics(ctx context.Context) (studentpresence.DashboardAnalytics, error) {
	if s.dashboardAnalytics != nil {
		return s.dashboardAnalytics(ctx)
	}
	return studentpresence.DashboardAnalytics{}, nil
}

func (s *stubPresenceOperations) GetTrackingIndicators(ctx context.Context, studentIDs []int64, labels []string) (map[int64][]bool, error) {
	if s.trackingIndicators != nil {
		return s.trackingIndicators(ctx, studentIDs, labels)
	}
	return map[int64][]bool{}, nil
}

// operationError wraps a presence sentinel the way the retained service does,
// so error-classification tests exercise the unwrap path.
func operationError(op string, err error) error {
	return &presenceError{Op: op, Err: err}
}

func (s *stubPresenceOperations) CheckInStudentsToSessionAuthorized(ctx context.Context, studentIDs []int64, activeGroupID, staffID int64, auth studentpresence.StudentMoveAuthorization, keepPresent bool) (*studentpresence.StudentMoveResult, error) {
	if s.checkInStudentsToSession != nil {
		return s.checkInStudentsToSession(ctx, studentIDs, activeGroupID, staffID, auth, keepPresent)
	}
	return &studentpresence.StudentMoveResult{}, nil
}

func (s *stubPresenceOperations) CrossTenantStudents(ctx context.Context, hostingTenantID int64) ([]studentpresence.CrossTenantStudent, error) {
	if s.crossTenantStudents != nil {
		return s.crossTenantStudents(ctx, hostingTenantID)
	}
	return nil, nil
}
