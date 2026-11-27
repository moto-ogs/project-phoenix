package presence

import (
	"context"
	"errors"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// GetStudentCurrentVisit Tests (refactored implementation)
// =============================================================================

func TestGetStudentCurrentVisit_Success(t *testing.T) {
	t.Parallel()

	testStudentID := int64(42)
	visitRepo := &mockVisitRepository{
		getCurrentByStudentIDFunc: func(ctx context.Context, studentID int64) (*studentpresence.Visit, error) {
			return &studentpresence.Visit{
				ID:        100,
				StudentID: studentID,
			}, nil
		},
	}

	svc := &service{ServiceDependencies: ServiceDependencies{Now: presenceTestNow, PrincipalReader: testAttendancePrincipal, SchoolPresence: visitRepo}}
	visit, err := svc.GetStudentCurrentVisit(context.Background(), testStudentID)

	require.NoError(t, err)
	require.NotNil(t, visit)
	assert.Equal(t, int64(100), visit.ID)
	assert.Equal(t, testStudentID, visit.StudentID)
}

func TestGetStudentCurrentVisit_NotFound(t *testing.T) {
	t.Parallel()

	visitRepo := &mockVisitRepository{
		getCurrentByStudentIDFunc: func(ctx context.Context, studentID int64) (*studentpresence.Visit, error) {
			return nil, &DatabaseError{Op: "get current", Err: ErrNotFound}
		},
	}

	svc := &service{ServiceDependencies: ServiceDependencies{Now: presenceTestNow, PrincipalReader: testAttendancePrincipal, SchoolPresence: visitRepo}}
	visit, err := svc.GetStudentCurrentVisit(context.Background(), 1)

	require.Error(t, err)
	assert.Nil(t, visit)
	assert.Contains(t, err.Error(), "GetStudentCurrentVisit")
}

func TestGetStudentCurrentVisit_DatabaseError(t *testing.T) {
	t.Parallel()

	visitRepo := &mockVisitRepository{
		getCurrentByStudentIDFunc: func(ctx context.Context, studentID int64) (*studentpresence.Visit, error) {
			return nil, errors.New("connection refused")
		},
	}

	svc := &service{ServiceDependencies: ServiceDependencies{Now: presenceTestNow, PrincipalReader: testAttendancePrincipal, SchoolPresence: visitRepo}}
	visit, err := svc.GetStudentCurrentVisit(context.Background(), 1)

	require.Error(t, err)
	assert.Nil(t, visit)
	assert.Contains(t, err.Error(), "GetStudentCurrentVisit")
}

func TestGetStudentCurrentVisit_NilVisit(t *testing.T) {
	t.Parallel()

	visitRepo := &mockVisitRepository{
		getCurrentByStudentIDFunc: func(ctx context.Context, studentID int64) (*studentpresence.Visit, error) {
			return nil, nil
		},
	}

	svc := &service{ServiceDependencies: ServiceDependencies{Now: presenceTestNow, PrincipalReader: testAttendancePrincipal, SchoolPresence: visitRepo}}
	visit, err := svc.GetStudentCurrentVisit(context.Background(), 1)

	require.Error(t, err)
	assert.Nil(t, visit)
}

// =============================================================================
// ListStudentsPresentInRoom Tests (#1323)
//
// Service-level wrapper around repo.ListActiveStudentIDsByRoomID. Behavior we
// pin: passes through the room ID, returns IDs verbatim on success, wraps
// errors with the service-error envelope so the handler layer can map them.
// =============================================================================

func TestListStudentsPresentInRoom_InvalidRoomDoesNotQueryWholeSchool(t *testing.T) {
	t.Parallel()
	svc := &service{ServiceDependencies: ServiceDependencies{Now: presenceTestNow}}
	for _, roomID := range []int64{0, -1} {
		ids, err := svc.ListStudentsPresentInRoom(context.Background(), roomID)
		require.NoError(t, err)
		assert.Empty(t, ids)
	}
}

func TestListStudentsPresentInRoom_ReturnsIDsFromRepo(t *testing.T) {
	t.Parallel()

	expected := []int64{11, 22, 33}
	var receivedRoom int64
	visitRepo := &mockVisitRepository{
		listActiveStudentIDsByRoomIDFunc: func(_ context.Context, roomID int64) ([]int64, error) {
			receivedRoom = roomID
			return expected, nil
		},
	}

	svc := &service{ServiceDependencies: ServiceDependencies{Now: presenceTestNow, PrincipalReader: testAttendancePrincipal, SchoolPresence: visitRepo}}
	ids, err := svc.ListStudentsPresentInRoom(context.Background(), 42)

	require.NoError(t, err)
	assert.Equal(t, int64(42), receivedRoom, "service must pass through the room ID without mutation")
	assert.Equal(t, expected, ids)
}

func TestListStudentsPresentInRoom_EmptyResult(t *testing.T) {
	t.Parallel()

	visitRepo := &mockVisitRepository{
		listActiveStudentIDsByRoomIDFunc: func(_ context.Context, _ int64) ([]int64, error) {
			return nil, nil
		},
	}

	svc := &service{ServiceDependencies: ServiceDependencies{Now: presenceTestNow, PrincipalReader: testAttendancePrincipal, SchoolPresence: visitRepo}}
	ids, err := svc.ListStudentsPresentInRoom(context.Background(), 1)

	require.NoError(t, err)
	assert.Empty(t, ids)
}

func TestListStudentsPresentInRoom_WrapsRepoError(t *testing.T) {
	t.Parallel()

	repoErr := errors.New("db unavailable")
	visitRepo := &mockVisitRepository{
		listActiveStudentIDsByRoomIDFunc: func(_ context.Context, _ int64) ([]int64, error) {
			return nil, repoErr
		},
	}

	svc := &service{ServiceDependencies: ServiceDependencies{Now: presenceTestNow, PrincipalReader: testAttendancePrincipal, SchoolPresence: visitRepo}}
	ids, err := svc.ListStudentsPresentInRoom(context.Background(), 1)

	require.Error(t, err)
	assert.Nil(t, ids)
	assert.Contains(t, err.Error(), "ListStudentsPresentInRoom",
		"error envelope must name the service operation so handler-side mapping has a clear surface")
	assert.Contains(t, err.Error(), "db unavailable",
		"underlying repo error must remain wrapped (errors.Is/Unwrap chain)")
}
