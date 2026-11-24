// Package activities internal tests for pure helper functions.
// These tests verify logic that doesn't require database access.
package httpadapter_test

import (
	"encoding/json"
	"testing"
	"time"

	activityContract "github.com/moto-ogs/project-phoenix/modules/timetable/activitycontract"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	httpadapter "github.com/moto-ogs/project-phoenix/modules/timetable/http/activities"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// =============================================================================
// Request Type Tests
// =============================================================================

func TestQuickActivityRequest_Fields(t *testing.T) {
	t.Parallel()

	roomID := int64(10)
	req := httpadapter.QuickActivityRequest{
		Name:            "Test Activity",
		CategoryID:      5,
		RoomID:          (*ident.ID)(&roomID),
		MaxParticipants: new(20),
	}

	assert.Equal(t, "Test Activity", req.Name)
	assert.Equal(t, ident.ID(int64(5)), req.CategoryID)
	assert.Equal(t, ident.ID(int64(10)), *req.RoomID)
	assert.Equal(t, 20, *req.MaxParticipants)
}

func TestQuickActivityRequest_NilRoomID(t *testing.T) {
	t.Parallel()

	req := httpadapter.QuickActivityRequest{
		Name:            "Test Activity",
		CategoryID:      5,
		RoomID:          nil,
		MaxParticipants: new(15),
	}

	assert.Equal(t, "Test Activity", req.Name)
	assert.Nil(t, req.RoomID)
}

func TestActivityRequest_Fields(t *testing.T) {
	t.Parallel()

	roomID := int64(20)
	req := httpadapter.ActivityRequest{
		Name:            "Test Activity",
		MaxParticipants: new(30),
		IsOpen:          true,
		CategoryID:      10,
		PlannedRoomID:   (*ident.ID)(&roomID),
		SupervisorIDs:   []ident.ID{1, 2},
	}

	assert.Equal(t, "Test Activity", req.Name)
	assert.Equal(t, 30, *req.MaxParticipants)
	assert.True(t, req.IsOpen)
	assert.Equal(t, ident.ID(int64(10)), req.CategoryID)
	assert.Equal(t, ident.ID(int64(20)), *req.PlannedRoomID)
	assert.Len(t, req.SupervisorIDs, 2)
}

func TestScheduleRequest_Fields(t *testing.T) {
	t.Parallel()

	timeframeID := int64(5)
	req := httpadapter.ScheduleRequest{
		Weekday:     1, // Monday
		TimeframeID: (*ident.ID)(&timeframeID),
	}

	assert.Equal(t, 1, req.Weekday)
	assert.Equal(t, ident.ID(int64(5)), *req.TimeframeID)
}

func TestScheduleRequest_NilTimeframeID(t *testing.T) {
	t.Parallel()

	req := httpadapter.ScheduleRequest{
		Weekday:     2, // Tuesday
		TimeframeID: nil,
	}

	assert.Equal(t, 2, req.Weekday)
	assert.Nil(t, req.TimeframeID)
}

func TestBatchEnrollmentRequest_Fields(t *testing.T) {
	t.Parallel()

	req := httpadapter.BatchEnrollmentRequest{
		StudentIDs: []ident.ID{1, 2, 3},
	}

	assert.Len(t, req.StudentIDs, 3)
	assert.Equal(t, int64(1), req.StudentIDs[0].Int64())
}

func TestBatchEnrollmentRequest_EmptyList(t *testing.T) {
	t.Parallel()

	req := httpadapter.BatchEnrollmentRequest{
		StudentIDs: []ident.ID{},
	}

	assert.Empty(t, req.StudentIDs)
}

// =============================================================================
// AddSupervisorsToResponseForTest Tests
// =============================================================================

func TestAddSupervisorsToResponse_EmptyList(t *testing.T) {
	t.Parallel()

	response := &httpadapter.ActivityResponse{}
	httpadapter.AddSupervisorsToResponseForTest(response, []*activityContract.SupervisorPlanned{})
	assert.Nil(t, response.SupervisorIDs)
	assert.Nil(t, response.Supervisors)
}

func TestAddSupervisorsToResponse_NilList(t *testing.T) {
	t.Parallel()

	response := &httpadapter.ActivityResponse{}
	httpadapter.AddSupervisorsToResponseForTest(response, nil)
	assert.Nil(t, response.SupervisorIDs)
	assert.Nil(t, response.Supervisors)
}

func TestAddSupervisorsToResponse_WithNilSupervisorInList(t *testing.T) {
	t.Parallel()

	response := &httpadapter.ActivityResponse{}
	sup := &activityContract.SupervisorPlanned{
		ID:        1,
		StaffID:   1,
		IsPrimary: false,
	}
	supervisors := []*activityContract.SupervisorPlanned{
		nil,
		sup,
		nil,
	}
	httpadapter.AddSupervisorsToResponseForTest(response, supervisors)
	assert.Len(t, response.SupervisorIDs, 1)
	assert.Equal(t, ident.ID(int64(1)), response.SupervisorIDs[0])
}

func TestAddSupervisorsToResponse_WithPrimarySupervisor(t *testing.T) {
	t.Parallel()

	response := &httpadapter.ActivityResponse{}
	supervisors := []*activityContract.SupervisorPlanned{
		{ID: 1, StaffID: 1, IsPrimary: false},
		{ID: 2, StaffID: 2, IsPrimary: true},
		{ID: 3, StaffID: 3, IsPrimary: false},
	}
	httpadapter.AddSupervisorsToResponseForTest(response, supervisors)
	assert.Len(t, response.SupervisorIDs, 3)
	assert.NotNil(t, response.SupervisorID)
	assert.Equal(t, ident.ID(int64(2)), *response.SupervisorID)
}

func TestAddSupervisorsToResponse_NoPrimarySupervisor(t *testing.T) {
	t.Parallel()

	response := &httpadapter.ActivityResponse{}
	supervisors := []*activityContract.SupervisorPlanned{
		{ID: 1, StaffID: 1, IsPrimary: false},
		{ID: 2, StaffID: 2, IsPrimary: false},
	}
	httpadapter.AddSupervisorsToResponseForTest(response, supervisors)
	assert.Len(t, response.SupervisorIDs, 2)
	assert.Nil(t, response.SupervisorID)
}

// =============================================================================
// AddSchedulesToResponseForTest Tests
// =============================================================================

func TestAddSchedulesToResponse_EmptyList(t *testing.T) {
	t.Parallel()

	response := &httpadapter.ActivityResponse{Schedules: []httpadapter.ActivityScheduleResponse{}}
	httpadapter.AddSchedulesToResponseForTest(response, []*activityContract.Schedule{})
	assert.Empty(t, response.Schedules)
}

func TestAddSchedulesToResponse_NilList(t *testing.T) {
	t.Parallel()

	response := &httpadapter.ActivityResponse{Schedules: []httpadapter.ActivityScheduleResponse{}}
	httpadapter.AddSchedulesToResponseForTest(response, nil)
	assert.Empty(t, response.Schedules)
}

func TestAddSchedulesToResponse_WithNilScheduleInList(t *testing.T) {
	t.Parallel()

	response := &httpadapter.ActivityResponse{Schedules: []httpadapter.ActivityScheduleResponse{}}
	sch := &activityContract.Schedule{
		ID:      1,
		Weekday: 1,
	}
	schedules := []*activityContract.Schedule{
		nil,
		sch,
		nil,
	}
	httpadapter.AddSchedulesToResponseForTest(response, schedules)
	assert.Len(t, response.Schedules, 1)
	assert.Equal(t, ident.ID(int64(1)), response.Schedules[0].ID)
}

func TestAddSchedulesToResponse_WithMultipleSchedules(t *testing.T) {
	t.Parallel()

	response := &httpadapter.ActivityResponse{Schedules: []httpadapter.ActivityScheduleResponse{}}
	timeframeID := int64(5)
	schedules := []*activityContract.Schedule{
		{ID: 1, Weekday: 1, TimeframeID: &timeframeID},
		{ID: 2, Weekday: 3, TimeframeID: nil},
	}
	httpadapter.AddSchedulesToResponseForTest(response, schedules)
	assert.Len(t, response.Schedules, 2)
}

// =============================================================================
// AddCategoryToResponseForTest Tests
// =============================================================================

func TestAddCategoryToResponse_NilCategory(t *testing.T) {
	t.Parallel()

	response := &httpadapter.ActivityResponse{}
	group := &activityContract.Group{Category: nil}
	httpadapter.AddCategoryToResponseForTest(response, group)
	assert.Nil(t, response.Category)
}

func TestAddCategoryToResponse_WithCategory(t *testing.T) {
	t.Parallel()

	response := &httpadapter.ActivityResponse{}
	group := &activityContract.Group{
		Category: &activityContract.Category{
			ID:   1,
			Name: "Test Category",
		},
	}
	httpadapter.AddCategoryToResponseForTest(response, group)
	assert.NotNil(t, response.Category)
	assert.Equal(t, ident.ID(int64(1)), response.Category.ID)
	assert.Equal(t, "Test Category", response.Category.Name)
}

// =============================================================================
// BuildBaseActivityResponseForTest Tests
// =============================================================================

func TestBuildBaseActivityResponse_BasicFields(t *testing.T) {
	t.Parallel()

	roomID := int64(10)
	now := time.Now()
	group := &activityContract.Group{
		ID: 1, CreatedAt: now, UpdatedAt: now,
		Name:            "Test Activity",
		MaxParticipants: 20,
		IsOpen:          true,
		CategoryID:      5,
		PlannedRoomID:   &roomID,
	}

	response := httpadapter.BuildBaseActivityResponseForTest(group, 15)

	assert.Equal(t, ident.ID(int64(1)), response.ID)
	assert.Equal(t, "Test Activity", response.Name)
	assert.NotNil(t, response.MaxParticipants)
	assert.Equal(t, 20, *response.MaxParticipants)
	assert.True(t, response.IsOpen)
	assert.Equal(t, ident.ID(int64(5)), response.CategoryID)
	assert.Equal(t, ident.ID(int64(10)), *response.PlannedRoomID)
	assert.Equal(t, 15, response.EnrollmentCount)
	assert.Empty(t, response.Schedules)
}

func TestBuildBaseActivityResponse_UnlimitedCapacity(t *testing.T) {
	t.Parallel()

	group := &activityContract.Group{
		Name:            "Open Sports Hall",
		MaxParticipants: 0,
		CategoryID:      5,
	}

	response := httpadapter.BuildBaseActivityResponseForTest(group, 75)

	assert.Nil(t, response.MaxParticipants)
}

func TestBuildBaseActivityResponse_NilRoomID(t *testing.T) {
	t.Parallel()

	group := &activityContract.Group{
		ID:            1,
		Name:          "Test Activity",
		PlannedRoomID: nil,
	}

	response := httpadapter.BuildBaseActivityResponseForTest(group, 0)
	assert.Nil(t, response.PlannedRoomID)
}

// =============================================================================
// GroupEditForTest Tests
// =============================================================================

// decodeActivityUpdate reads a PUT /api/activities/{id} body as the route
// does.
func decodeActivityUpdate(t *testing.T, body string) *httpadapter.ActivityUpdateRequest {
	t.Helper()
	req := &httpadapter.ActivityUpdateRequest{}
	require.NoError(t, json.Unmarshal([]byte(body), req))
	return req
}

func TestGroupEdit_AllFields(t *testing.T) {
	t.Parallel()

	req := decodeActivityUpdate(t, `{"name":"Updated Name","max_participants":50,"is_open":true,"category_id":"10","planned_room_id":"25","schedules":[{"weekday":2}],"supervisor_ids":["7","8"],"expected_version":"v1"}`)
	edit := httpadapter.GroupEditForTest(req, 3)

	assert.Equal(t, int64(3), edit.ID)
	assert.Equal(t, "Updated Name", edit.Name)
	assert.Equal(t, 50, edit.MaxParticipants)
	require.NotNil(t, edit.IsOpen)
	assert.True(t, *edit.IsOpen)
	assert.Equal(t, int64(10), edit.CategoryID)
	assert.True(t, edit.SetPlannedRoom)
	require.NotNil(t, edit.PlannedRoomID)
	assert.Equal(t, int64(25), *edit.PlannedRoomID)
	assert.True(t, edit.ReplaceSupervisors)
	assert.Equal(t, []int64{7, 8}, edit.SupervisorIDs)
	assert.True(t, edit.ReplaceSchedules)
	require.Len(t, edit.Schedules, 1)
	assert.Equal(t, 2, edit.Schedules[0].Weekday)
	assert.Equal(t, "v1", edit.ExpectedVersion)
}

// A body that names only the master data, as the database form sends it,
// keeps the opening, the room, the schedules and the supervisors.
func TestGroupEdit_OmittedPartsKeepStoredState(t *testing.T) {
	t.Parallel()

	req := decodeActivityUpdate(t, `{"name":"Test","max_participants":null,"category_id":"10","expected_version":"v1"}`)
	edit := httpadapter.GroupEditForTest(req, 3)

	assert.Nil(t, edit.IsOpen)
	assert.False(t, edit.SetPlannedRoom)
	assert.False(t, edit.ReplaceSupervisors)
	assert.False(t, edit.ReplaceSchedules)
}

func TestGroupEdit_NullRoomClearsRoom(t *testing.T) {
	t.Parallel()

	req := decodeActivityUpdate(t, `{"name":"Test","category_id":"10","planned_room_id":null,"schedules":[],"supervisor_ids":[]}`)
	edit := httpadapter.GroupEditForTest(req, 3)

	assert.True(t, edit.SetPlannedRoom)
	assert.Nil(t, edit.PlannedRoomID)
	assert.True(t, edit.ReplaceSchedules)
	assert.Empty(t, edit.Schedules)
	assert.True(t, edit.ReplaceSupervisors)
	assert.Empty(t, edit.SupervisorIDs)
}

// =============================================================================
// NewCategoryResponseForTest Tests
// =============================================================================

func TestNewCategoryResponse_FullCategory(t *testing.T) {
	t.Parallel()

	category := &activityContract.Category{
		ID:          1,
		Name:        "Sports",
		Description: "Sports activities",
		Color:       "#FF0000",
	}

	response := httpadapter.NewCategoryResponseForTest(category)

	assert.Equal(t, ident.ID(int64(1)), response.ID)
	assert.Equal(t, "Sports", response.Name)
	assert.Equal(t, "Sports activities", response.Description)
	assert.Equal(t, "#FF0000", response.Color)
}

func TestNewCategoryResponse_MinimalCategory(t *testing.T) {
	t.Parallel()

	category := &activityContract.Category{
		ID:   1,
		Name: "Minimal",
	}

	response := httpadapter.NewCategoryResponseForTest(category)

	assert.Equal(t, ident.ID(int64(1)), response.ID)
	assert.Equal(t, "Minimal", response.Name)
	assert.Empty(t, response.Description)
	assert.Empty(t, response.Color)
}

func TestNewCategoryResponse_NilCategory(t *testing.T) {
	t.Parallel()

	response := httpadapter.NewCategoryResponseForTest(nil)
	assert.Equal(t, "Unknown Category", response.Name)
}

// =============================================================================
// NewScheduleResponseForTest Tests
// =============================================================================

func TestNewScheduleResponse_Basic(t *testing.T) {
	t.Parallel()

	schedule := &activityContract.Schedule{
		ID:      1,
		Weekday: 1,
	}

	response := httpadapter.NewScheduleResponseForTest(schedule)

	assert.Equal(t, ident.ID(int64(1)), response.ID)
	assert.Equal(t, 1, response.Weekday)
}

func TestNewScheduleResponse_WithTimeframeID(t *testing.T) {
	t.Parallel()

	timeframeID := int64(5)
	schedule := &activityContract.Schedule{
		ID:          1,
		Weekday:     1,
		TimeframeID: &timeframeID,
	}

	response := httpadapter.NewScheduleResponseForTest(schedule)

	assert.Equal(t, ident.ID(int64(1)), response.ID)
	assert.NotNil(t, response.TimeframeID)
	assert.Equal(t, ident.ID(int64(5)), *response.TimeframeID)
}

func TestNewScheduleResponse_NilSchedule(t *testing.T) {
	t.Parallel()

	response := httpadapter.NewScheduleResponseForTest(nil)
	assert.Equal(t, ident.ID(int64(0)), response.ID)
}

// =============================================================================
// NewSupervisorResponseForTest Tests
// =============================================================================

func TestNewSupervisorResponse_Complete(t *testing.T) {
	t.Parallel()

	supervisor := &activityContract.SupervisorPlanned{
		ID:        1,
		StaffID:   10,
		IsPrimary: true,
		FirstName: "John",
		LastName:  "Doe",
	}

	response := httpadapter.NewSupervisorResponseForTest(supervisor)

	assert.Equal(t, ident.ID(int64(1)), response.ID)
	assert.Equal(t, ident.ID(int64(10)), response.StaffID)
	assert.True(t, response.IsPrimary)
	assert.Equal(t, "John", response.FirstName)
	assert.Equal(t, "Doe", response.LastName)
}

func TestNewSupervisorResponse_NilStaff(t *testing.T) {
	t.Parallel()

	supervisor := &activityContract.SupervisorPlanned{
		ID:        1,
		StaffID:   10,
		IsPrimary: false,
	}

	response := httpadapter.NewSupervisorResponseForTest(supervisor)

	assert.Equal(t, ident.ID(int64(1)), response.ID)
	assert.Equal(t, ident.ID(int64(10)), response.StaffID)
	assert.False(t, response.IsPrimary)
	assert.Empty(t, response.FirstName)
	assert.Empty(t, response.LastName)
}

func TestNewSupervisorResponse_StaffWithNilPerson(t *testing.T) {
	t.Parallel()

	supervisor := &activityContract.SupervisorPlanned{
		ID:        1,
		StaffID:   10,
		IsPrimary: false,
	}

	response := httpadapter.NewSupervisorResponseForTest(supervisor)

	assert.Equal(t, ident.ID(int64(1)), response.ID)
	assert.Empty(t, response.FirstName)
	assert.Empty(t, response.LastName)
}

func TestNewSupervisorResponse_NilSupervisor(t *testing.T) {
	t.Parallel()

	response := httpadapter.NewSupervisorResponseForTest(nil)
	assert.Equal(t, ident.ID(int64(0)), response.ID)
}

// =============================================================================
// Response Type Tests
// =============================================================================

func TestActivityResponse_DefaultSchedules(t *testing.T) {
	t.Parallel()

	response := httpadapter.ActivityResponse{}
	assert.Nil(t, response.Schedules)

	// After init with empty slice
	response.Schedules = []httpadapter.ActivityScheduleResponse{}
	assert.NotNil(t, response.Schedules)
	assert.Empty(t, response.Schedules)
}

func TestCategoryResponse_Fields(t *testing.T) {
	t.Parallel()

	response := httpadapter.ActivityCategoryResponse{
		ID:          1,
		Name:        "Test",
		Description: "Description",
		Color:       "#000000",
	}

	assert.Equal(t, ident.ID(int64(1)), response.ID)
	assert.Equal(t, "Test", response.Name)
	assert.Equal(t, "Description", response.Description)
	assert.Equal(t, "#000000", response.Color)
}
