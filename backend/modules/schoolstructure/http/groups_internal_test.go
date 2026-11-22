// Package schoolstructurehttp internal tests for pure helper functions.
// These tests verify logic that doesn't require database access.
package schoolstructurehttp

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// =============================================================================
// Request Type Tests
// =============================================================================

func TestGroupRequest_Fields(t *testing.T) {
	t.Parallel()

	roomID := int64(5)
	req := GroupRequest{
		Name:       "Test Group",
		RoomID:     (*ident.ID)(&roomID),
		TeacherIDs: []ident.ID{10, 20},
	}

	assert.Equal(t, "Test Group", req.Name)
	assert.Equal(t, ident.ID(int64(5)), *req.RoomID)
	assert.Len(t, req.TeacherIDs, 2)
}

func TestGroupRequest_Bind_Valid(t *testing.T) {
	t.Parallel()

	req := GroupRequest{Name: "Valid Group"}
	err := req.Bind(nil)
	assert.NoError(t, err)
}

func TestGroupRequest_Bind_EmptyName(t *testing.T) {
	t.Parallel()

	req := GroupRequest{Name: ""}
	err := req.Bind(nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "name is required")
}

// =============================================================================
// Response Type Tests
// =============================================================================

func TestGroupResponse_Fields(t *testing.T) {
	t.Parallel()

	roomID := int64(100)
	repID := int64(200)
	now := time.Now()

	resp := GroupResponse{
		ID:               1,
		Name:             "Response Group",
		RoomID:           (*ident.ID)(&roomID),
		RepresentativeID: (*ident.ID)(&repID),
		StudentCount:     25,
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	assert.Equal(t, ident.ID(int64(1)), resp.ID)
	assert.Equal(t, "Response Group", resp.Name)
	assert.Equal(t, ident.ID(int64(100)), *resp.RoomID)
	assert.Equal(t, ident.ID(int64(200)), *resp.RepresentativeID)
	assert.Equal(t, 25, resp.StudentCount)
}

func TestTeacherResponse_Fields(t *testing.T) {
	t.Parallel()

	resp := TeacherResponse{
		ID:             1,
		StaffID:        2,
		FirstName:      "John",
		LastName:       "Doe",
		Specialization: "Math",
		Role:           "lead",
		FullName:       "John Doe",
	}

	assert.Equal(t, ident.ID(int64(1)), resp.ID)
	assert.Equal(t, ident.ID(int64(2)), resp.StaffID)
	assert.Equal(t, "John", resp.FirstName)
	assert.Equal(t, "Doe", resp.LastName)
	assert.Equal(t, "Math", resp.Specialization)
	assert.Equal(t, "lead", resp.Role)
}
