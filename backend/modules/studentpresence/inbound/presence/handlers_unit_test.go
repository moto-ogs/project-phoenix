package presence

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/render"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/internal/ptrtest"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
)

// =============================================================================
// CONVERTER TESTS - Testing record-to-response conversion functions
// =============================================================================

func TestNewPresenceLiveGroupResponse_BasicFields(t *testing.T) {
	t.Parallel()

	now := time.Now()
	endTime := now.Add(time.Hour)

	group := studentpresence.LiveGroup{
		ID: 1, CreatedAt: now, UpdatedAt: now,
		ActivityGroupID: ptrtest.Ptr(int64(100)),
		RoomID:          200,
		StartTime:       now,
		EndTime:         &endTime,
	}

	response := newPresenceLiveGroupResponse(group)

	assert.Equal(t, int64(1), response.ID)
	if assert.NotNil(t, response.GroupID) {
		assert.Equal(t, int64(100), *response.GroupID)
	}
	assert.Equal(t, int64(200), response.RoomID)
	assert.Equal(t, now, response.StartTime)
	assert.Equal(t, &endTime, response.EndTime)
	assert.False(t, response.IsActive) // Has end time so not active
	assert.Equal(t, 0, response.VisitCount)
	assert.Equal(t, 0, response.SupervisorCount)
	assert.Nil(t, response.Room)
}

func TestLoadActiveGroupRelations_KeepsActiveSupervisorsAndRooms(t *testing.T) {
	t.Parallel()

	today := calendar.TodayDate()
	yesterday := today.AddDays(-1).String()
	groups := []studentpresence.LiveGroup{{ID: 1, ActivityGroupID: ptrtest.Ptr(int64(100)), RoomID: 200, StartTime: time.Now()}}
	responses := []ActiveGroupResponse{newPresenceLiveGroupResponse(groups[0])}
	rs := resourceForTest(Resource{
		Presence: supervisionQueryStub{query: func(_ context.Context, _ studentpresence.GroupSupervisionFilter) ([]studentpresence.GroupSupervision, error) {
			return []studentpresence.GroupSupervision{
				{ID: 1, GroupID: 1, StaffID: 10, Role: "Teacher", StartDate: today.String()},                     // Active
				{ID: 2, GroupID: 1, StaffID: 20, Role: "Helper", StartDate: today.String(), EndDate: &yesterday}, // Inactive (ended)
				{ID: 3, GroupID: 1, StaffID: 30, Role: "Supervisor", StartDate: today.String()},                  // Active
			}, nil
		}},
		Operations: &stubPresenceOperations{sessionRooms: func(_ context.Context, ids []int64) ([]studentpresence.SessionRoomSummary, error) {
			assert.Equal(t, []int64{200}, ids)
			return []studentpresence.SessionRoomSummary{{ID: 200, Name: "Test Room"}}, nil
		}},
	})

	rs.loadActiveGroupRelations(context.Background(), groups, responses)

	response := responses[0]
	assert.Equal(t, 2, response.SupervisorCount) // Only 2 active supervisors
	assert.Len(t, response.Supervisors, 2)
	assert.Equal(t, int64(10), response.Supervisors[0].StaffID)
	assert.Equal(t, "Teacher", response.Supervisors[0].Role)
	assert.Equal(t, int64(30), response.Supervisors[1].StaffID)
	if assert.NotNil(t, response.Room) {
		assert.Equal(t, int64(200), response.Room.ID)
		assert.Equal(t, "Test Room", response.Room.Name)
	}
}

func TestNewPresenceVisitResponse_BasicFields(t *testing.T) {
	t.Parallel()

	now := time.Now()
	exitTime := now.Add(time.Hour)

	visit := studentpresence.Visit{
		ID: 1, CreatedAt: now, UpdatedAt: now,
		StudentID:     100,
		ActiveGroupID: 200,
		EntryTime:     now,
		ExitTime:      &exitTime,
	}

	response := newPresenceVisitResponse(visit)

	assert.Equal(t, int64(1), response.ID)
	assert.Equal(t, int64(100), response.StudentID)
	assert.Equal(t, int64(200), response.ActiveGroupID)
	assert.Equal(t, now, response.CheckInTime)
	assert.Equal(t, &exitTime, response.CheckOutTime)
	assert.False(t, response.IsActive) // Has exit time
	assert.Empty(t, response.StudentName)
	assert.Empty(t, response.ActiveGroupName)
}

func TestNewPresenceVisitResponse_ActiveVisit(t *testing.T) {
	t.Parallel()

	now := time.Now()

	visit := studentpresence.Visit{
		ID:            1,
		StudentID:     100,
		ActiveGroupID: 200,
		EntryTime:     now,
		ExitTime:      nil, // Active visit
	}

	response := newPresenceVisitResponse(visit)

	assert.True(t, response.IsActive)
	assert.Nil(t, response.CheckOutTime)
}

// =============================================================================
// REQUEST BINDING TESTS - Testing request validation
// =============================================================================

// =============================================================================
// EXPORTED HANDLER TESTS - Testing exported handler wrappers
// =============================================================================

func TestExportedHandlers_NotNil(t *testing.T) {
	t.Parallel()

	rs := resourceForTest(Resource{})

	// Active Group Handlers
	assert.NotNil(t, rs.listActiveGroups)

	// Visit Handlers
	assert.NotNil(t, rs.listVisits)

	// Supervisor Handlers
	assert.NotNil(t, rs.endSupervision)
	assert.NotNil(t, rs.getStaffActiveSupervisions)

	// Analytics Handlers
	assert.NotNil(t, rs.getDashboardAnalytics)
	// Group by filters Handlers
	assert.NotNil(t, rs.getActiveGroupSupervisors)

	// Unclaimed Group Handlers
	assert.NotNil(t, rs.claimGroup)

	// Checkout Handler
	assert.NotNil(t, rs.checkoutStudent)
}

// =============================================================================
// ERROR RENDERER TESTS - Testing error response functions
// =============================================================================

func TestErrorRenderer_ActiveGroupNotFound(t *testing.T) {
	t.Parallel()

	err := studentpresence.ErrGroupNotFound
	renderer := ErrorRenderer(err)

	errResp, ok := renderer.(*common.ErrResponse)
	assert.True(t, ok)
	assert.Equal(t, 404, errResp.HTTPStatusCode)
	assertEnvelope(t, errResp, "general.input")
}

func TestErrorRenderer_VisitNotFound(t *testing.T) {
	t.Parallel()

	err := studentpresence.ErrVisitNotFound
	renderer := ErrorRenderer(err)

	errResp, ok := renderer.(*common.ErrResponse)
	assert.True(t, ok)
	assert.Equal(t, 404, errResp.HTTPStatusCode)
	assertEnvelope(t, errResp, "general.input")
}

func TestErrorRenderer_GroupSupervisorNotFound(t *testing.T) {
	t.Parallel()

	err := studentpresence.ErrGroupSupervisorNotFound
	renderer := ErrorRenderer(err)

	errResp, ok := renderer.(*common.ErrResponse)
	assert.True(t, ok)
	assert.Equal(t, 404, errResp.HTTPStatusCode)
	assertEnvelope(t, errResp, "general.input")
}

func TestErrorRenderer_InvalidData(t *testing.T) {
	t.Parallel()

	err := studentpresence.ErrInvalidData
	renderer := ErrorRenderer(err)

	errResp, ok := renderer.(*common.ErrResponse)
	assert.True(t, ok)
	assert.Equal(t, 400, errResp.HTTPStatusCode)
	assertEnvelope(t, errResp, "general.input")
}

func TestErrorRenderer_ActiveGroupAlreadyEnded(t *testing.T) {
	t.Parallel()

	err := studentpresence.ErrGroupAlreadyEnded
	renderer := ErrorRenderer(err)

	errResp, ok := renderer.(*common.ErrResponse)
	assert.True(t, ok)
	assert.Equal(t, 400, errResp.HTTPStatusCode)
	assertEnvelope(t, errResp, "general.input")
}

func TestErrorRenderer_VisitAlreadyEnded(t *testing.T) {
	t.Parallel()

	err := studentpresence.ErrVisitAlreadyEnded
	renderer := ErrorRenderer(err)

	errResp, ok := renderer.(*common.ErrResponse)
	assert.True(t, ok)
	assert.Equal(t, 400, errResp.HTTPStatusCode)
	assertEnvelope(t, errResp, "general.input")
}

func TestErrorRenderer_SupervisionAlreadyEnded(t *testing.T) {
	t.Parallel()

	err := studentpresence.ErrSupervisionAlreadyEnded
	renderer := ErrorRenderer(err)

	errResp, ok := renderer.(*common.ErrResponse)
	assert.True(t, ok)
	assert.Equal(t, 400, errResp.HTTPStatusCode)
	assertEnvelope(t, errResp, "general.input")
}

func TestErrorRenderer_StudentAlreadyInGroup(t *testing.T) {
	t.Parallel()

	err := studentpresence.ErrStudentAlreadyInGroup
	renderer := ErrorRenderer(err)

	errResp, ok := renderer.(*common.ErrResponse)
	assert.True(t, ok)
	assert.Equal(t, 400, errResp.HTTPStatusCode)
	assertEnvelope(t, errResp, "general.input")
}

func TestErrorRenderer_StudentAlreadyActive(t *testing.T) {
	t.Parallel()

	// 409 Conflict, not 400 Bad Request: the duplicate-active-visit
	// translation introduced for Issue #844 means this error now
	// surfaces from the DB-level unique index on every CreateVisit
	// caller, not just the IoT checkin flow. Mapping it to 400 would
	// contradict both the IoT path (which already returns 409) and
	// the HTTP semantics — a duplicate visit is a state conflict,
	// not a malformed request.
	err := studentpresence.ErrStudentAlreadyActive
	renderer := ErrorRenderer(err)

	errResp, ok := renderer.(*common.ErrResponse)
	assert.True(t, ok)
	assert.Equal(t, testutil.StatusConflict, errResp.HTTPStatusCode)
	assertEnvelope(t, errResp, "general.business_rejection")
}

func TestErrorRenderer_StaffAlreadySupervising(t *testing.T) {
	t.Parallel()

	err := studentpresence.ErrStaffAlreadySupervising
	renderer := ErrorRenderer(err)

	errResp, ok := renderer.(*common.ErrResponse)
	assert.True(t, ok)
	assert.Equal(t, 400, errResp.HTTPStatusCode)
	assertEnvelope(t, errResp, "general.input")
}

func TestErrorRenderer_CannotDeleteActiveGroup(t *testing.T) {
	t.Parallel()

	err := studentpresence.ErrCannotDeleteActiveGroup
	renderer := ErrorRenderer(err)

	errResp, ok := renderer.(*common.ErrResponse)
	assert.True(t, ok)
	assert.Equal(t, 400, errResp.HTTPStatusCode)
	assertEnvelope(t, errResp, "general.input")
}

func TestErrorRenderer_InvalidTimeRange(t *testing.T) {
	t.Parallel()

	err := studentpresence.ErrInvalidTimeRange
	renderer := ErrorRenderer(err)

	errResp, ok := renderer.(*common.ErrResponse)
	assert.True(t, ok)
	assert.Equal(t, 400, errResp.HTTPStatusCode)
	assertEnvelope(t, errResp, "general.input")
}

func TestErrorRenderer_RoomConflict(t *testing.T) {
	t.Parallel()

	err := studentpresence.ErrRoomConflict
	renderer := ErrorRenderer(err)

	errResp, ok := renderer.(*common.ErrResponse)
	assert.True(t, ok)
	assert.Equal(t, 409, errResp.HTTPStatusCode)
	assertEnvelope(t, errResp, "general.business_rejection")
}

func TestErrorRenderer_UnknownError(t *testing.T) {
	t.Parallel()

	err := errors.New("unknown error")
	renderer := ErrorRenderer(err)

	errResp, ok := renderer.(*common.ErrResponse)
	assert.True(t, ok)
	assert.Equal(t, 500, errResp.HTTPStatusCode)
	assertEnvelope(t, errResp, "general.server")
	assert.Equal(t, "unknown error", errResp.Detail)
}

// assertEnvelope renders resp and checks the wire envelope: the status
// member is the HTTP status number and the code is the expected one.
func assertEnvelope(t *testing.T, resp *common.ErrResponse, wantCode string) {
	t.Helper()
	recorder := httptest.NewRecorder()
	require.NoError(t, render.Render(recorder, httptest.NewRequest(http.MethodGet, "/", nil), resp))
	var body struct {
		Status int    `json:"status"`
		Code   string `json:"code"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	assert.Equal(t, resp.HTTPStatusCode, body.Status)
	assert.Equal(t, wantCode, body.Code)
}
