package timetable

import (
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// InstanceEditState is what the edit of one planned block shows and saves
// back whole (PUT /instances/{id}, POST /instances/{id}/convert-to-series):
// the block's planning columns and its roster. The roster lives in rows of
// its own, and activity_instances.updated_at has no trigger, so the block's
// read-state token is a fingerprint over all of it (ADR 0311).
type InstanceEditState struct {
	Date            calendar.Date
	StartTime       time.Time
	EndTime         time.Time
	Title           string
	Description     *string
	Notes           *string
	RoomID          int64
	ActivityGroupID *int64
	ListKind        *string
	RequiredStaff   *int
	Status          string
	StaffIDs        []int64
	StudentIDs      []int64
}

// instanceEditFingerprint is the canonical form of an InstanceEditState:
// clock times as wall-clock text, people sorted and unique.
type instanceEditFingerprint struct {
	Date            string  `json:"date"`
	StartTime       string  `json:"start_time"`
	EndTime         string  `json:"end_time"`
	Title           string  `json:"title"`
	Description     *string `json:"description"`
	Notes           *string `json:"notes"`
	RoomID          int64   `json:"room_id"`
	ActivityGroupID *int64  `json:"activity_group_id"`
	ListKind        *string `json:"list_kind"`
	RequiredStaff   *int    `json:"required_staff"`
	Status          string  `json:"status"`
	StaffIDs        []int64 `json:"staff_ids"`
	StudentIDs      []int64 `json:"student_ids"`
}

// InstanceVersion is the read-state token of a block as its edit form shows
// it. The planner's read and the edit's check under its locks both build it
// from the stored block, so they agree exactly when nothing changed.
func InstanceVersion(state InstanceEditState) string {
	return readstate.Fingerprint(instanceEditFingerprint{
		Date:            state.Date.String(),
		StartTime:       state.StartTime.Format("15:04:05"),
		EndTime:         state.EndTime.Format("15:04:05"),
		Title:           state.Title,
		Description:     state.Description,
		Notes:           state.Notes,
		RoomID:          state.RoomID,
		ActivityGroupID: state.ActivityGroupID,
		ListKind:        state.ListKind,
		RequiredStaff:   state.RequiredStaff,
		Status:          state.Status,
		StaffIDs:        sortedUniqueIDs(state.StaffIDs),
		StudentIDs:      sortedUniqueIDs(state.StudentIDs),
	})
}

// ScheduledInstanceVersion is InstanceVersion over the planner's read of a
// block: the scheduled instance with its staff and participant rows.
func ScheduledInstanceVersion(inst ScheduledInstance, staffRows []InstanceStaff, studentRows []ScheduledParticipant) string {
	staffIDs := make([]int64, 0, len(staffRows))
	for _, row := range staffRows {
		staffIDs = append(staffIDs, row.StaffID)
	}
	studentIDs := make([]int64, 0, len(studentRows))
	for _, row := range studentRows {
		studentIDs = append(studentIDs, row.StudentID)
	}
	return InstanceVersion(InstanceEditState{
		Date: inst.Date, StartTime: inst.StartTime, EndTime: inst.EndTime, Title: inst.Title,
		Description: inst.Description, Notes: inst.Notes, RoomID: inst.RoomID.Int64(),
		ActivityGroupID: (*int64)(inst.ActivityGroupID), ListKind: inst.ListKind, RequiredStaff: inst.RequiredStaff,
		Status: inst.Status, StaffIDs: staffIDs, StudentIDs: studentIDs,
	})
}

func sortedUniqueIDs(ids []int64) []int64 {
	out := slices.Clone(ids)
	slices.Sort(out)
	out = slices.Compact(out)
	if out == nil {
		return []int64{}
	}
	return out
}
