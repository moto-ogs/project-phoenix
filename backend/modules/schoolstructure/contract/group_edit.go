package contract

import (
	"slices"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// GroupEdit is an edit of a group through PUT /api/groups/{id}. Name is
// always written; the room and the teachers only when the edit names them,
// so a caller that changes the teachers alone keeps the group's room.
// ExpectedVersion is the GroupVersion its editor read (ADR 0311).
type GroupEdit struct {
	ID   int64
	Name string
	// SetRoom writes RoomID, nil clearing the room; false keeps it.
	SetRoom bool
	RoomID  *int64
	// ReplaceTeachers writes TeacherIDs; false keeps the teachers.
	ReplaceTeachers bool
	TeacherIDs      []int64
	ExpectedVersion string
}

// groupState is the canonical form of what a group edit can change.
type groupState struct {
	Name       string  `json:"name"`
	RoomID     *int64  `json:"room_id"`
	TeacherIDs []int64 `json:"teacher_ids"`
}

// GroupVersion is the read-state token of a group as its detail read shows
// it (ADR 0311): its name, its room and the IDs of its teachers in any
// order. The teacher assignments live in rows of their own whose writes do
// not touch the group's updated_at, so the token is a fingerprint.
func GroupVersion(group *Group, teacherIDs []int64) string {
	state := groupState{TeacherIDs: slices.Sorted(slices.Values(teacherIDs))}
	if state.TeacherIDs == nil {
		state.TeacherIDs = []int64{}
	}
	if group != nil {
		state.Name, state.RoomID = group.Name, group.RoomID
	}
	return readstate.Fingerprint(state)
}
