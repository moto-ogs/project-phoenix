package activitycontract

import (
	"slices"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// GroupEdit is an edit of an activity through PUT /api/activities/{id}.
// Name, MaxParticipants and CategoryID are always written. The other parts
// are written only when the edit names them, so a form that shows only the
// master data keeps the stored opening, room, supervisors and schedules
// instead of clearing them. ExpectedVersion is the GroupVersion its editor
// read (ADR 0311).
type GroupEdit struct {
	ID              int64
	Name            string
	MaxParticipants int
	CategoryID      int64
	// IsOpen nil keeps the stored opening.
	IsOpen *bool
	// SetPlannedRoom writes PlannedRoomID, nil clearing the room; false
	// keeps the stored room.
	SetPlannedRoom bool
	PlannedRoomID  *int64
	// ReplaceSupervisors writes SupervisorIDs, the first one as the primary
	// supervisor; false keeps the stored supervisors.
	ReplaceSupervisors bool
	SupervisorIDs      []int64
	// ReplaceSchedules writes Schedules; false keeps the stored ones.
	ReplaceSchedules bool
	Schedules        []*Schedule
	ExpectedVersion  string
}

// groupState is the canonical form of what an activity edit can change.
type groupState struct {
	Name            string            `json:"name"`
	MaxParticipants int               `json:"max_participants"`
	IsOpen          bool              `json:"is_open"`
	CategoryID      int64             `json:"category_id"`
	PlannedRoomID   *int64            `json:"planned_room_id"`
	Supervisors     []supervisorState `json:"supervisors"`
	Schedules       []scheduleState   `json:"schedules"`
}

type supervisorState struct {
	StaffID   int64 `json:"staff_id"`
	IsPrimary bool  `json:"is_primary"`
}

type scheduleState struct {
	Weekday     int    `json:"weekday"`
	TimeframeID *int64 `json:"timeframe_id"`
}

// GroupVersion is the read-state token of an activity as its detail read
// shows it (ADR 0311): its master data, its supervisors and its schedules.
// Supervisors and schedules live in rows of their own whose writes do not
// touch the activity's updated_at, so the token is a fingerprint over all
// of them, sorted.
func GroupVersion(group *Group, supervisors []*SupervisorPlanned, schedules []*Schedule) string {
	if group == nil {
		return readstate.Fingerprint(nil)
	}
	state := groupState{
		Name: group.Name, MaxParticipants: group.MaxParticipants, IsOpen: group.IsOpen,
		CategoryID: group.CategoryID, PlannedRoomID: group.PlannedRoomID,
		Supervisors: make([]supervisorState, 0, len(supervisors)),
		Schedules:   make([]scheduleState, 0, len(schedules)),
	}
	for _, supervisor := range supervisors {
		if supervisor != nil {
			state.Supervisors = append(state.Supervisors, supervisorState{StaffID: supervisor.StaffID, IsPrimary: supervisor.IsPrimary})
		}
	}
	slices.SortFunc(state.Supervisors, func(a, b supervisorState) int {
		if c := compareID(a.StaffID, b.StaffID); c != 0 {
			return c
		}
		return compareBool(a.IsPrimary, b.IsPrimary)
	})
	for _, schedule := range schedules {
		if schedule != nil {
			state.Schedules = append(state.Schedules, scheduleState{Weekday: schedule.Weekday, TimeframeID: schedule.TimeframeID})
		}
	}
	slices.SortFunc(state.Schedules, func(a, b scheduleState) int {
		if c := compareID(int64(a.Weekday), int64(b.Weekday)); c != 0 {
			return c
		}
		return compareID(optionalID(a.TimeframeID), optionalID(b.TimeframeID))
	})
	return readstate.Fingerprint(state)
}

func compareID(a, b int64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	default:
		return 0
	}
}

func compareBool(a, b bool) int {
	switch {
	case a == b:
		return 0
	case a:
		return 1
	default:
		return -1
	}
}

func optionalID(id *int64) int64 {
	if id == nil {
		return 0
	}
	return *id
}
