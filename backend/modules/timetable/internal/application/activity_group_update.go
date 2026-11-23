package application

import (
	"context"

	activityContract "github.com/moto-ogs/project-phoenix/modules/timetable/activitycontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// UpdateGroupWithDetails applies an edit of an activity as one unit: the
// group's core fields always, the supervisor set and the schedules only
// when the edit names them. Every failure aborts the whole update and
// propagates — callers run this inside a tenant transaction, so a
// supervisor or schedule failure rolls back the group update too.
//
// Behavior change (issue #575 B10, deliberate): the historical handler
// orchestration logged supervisor/schedule failures at Warn and COMMITTED
// the partial state, returning HTTP 200 — a rename could land while the
// schedule replacement half-failed (old rows deleted, new rows missing).
// Clients now get the error and unchanged state instead of a silent
// partial write.
//
// The group row comes first, then, for a new supervisor set, the staff rows
// of the current and requested supervisors (the canonical lock order,
// #6702); under them the edit is refused with readstate.ErrChanged unless
// the activity is still stored as its editor read it (ADR 0311).
func (s *ActivityService) UpdateGroupWithDetails(ctx context.Context, edit activityContract.GroupEdit, requestingStaffID int64, hasManagePermission bool) (*activityContract.Group, error) {
	group, err := s.lockedGroupForEdit(ctx, edit, requestingStaffID, hasManagePermission)
	if err != nil {
		return nil, err
	}
	applyGroupEdit(group, edit)
	updatedGroup, err := s.UpdateGroup(ctx, group, requestingStaffID, hasManagePermission)
	if err != nil {
		return nil, err
	}

	if edit.ReplaceSupervisors {
		if err := s.UpdateGroupSupervisors(ctx, updatedGroup.ID, edit.SupervisorIDs); err != nil {
			return nil, err
		}
	}
	if edit.ReplaceSchedules {
		if err := s.replaceGroupSchedules(ctx, updatedGroup.ID, edit.Schedules); err != nil {
			return nil, err
		}
	}
	return updatedGroup, nil
}

// lockedGroupForEdit takes the locks of an edit, checks that the caller may
// change the activity and that it is stored as read, and returns it.
func (s *ActivityService) lockedGroupForEdit(ctx context.Context, edit activityContract.GroupEdit, requestingStaffID int64, hasManagePermission bool) (*activityContract.Group, error) {
	if _, err := findLegacyGroupForUpdate(ctx, s.timetable, edit.ID); err != nil {
		if isRepositoryNotFound(err) {
			return nil, &activityContract.ActivityError{Op: "update group", Err: activityContract.ErrGroupNotFound}
		}
		return nil, &activityContract.ActivityError{Op: "update group", Err: err}
	}
	if edit.ReplaceSupervisors {
		// The supervisor writers hold these rows; the check below then
		// reads supervisors no other writer is changing.
		if err := s.lockActivitySupervisorStaff(ctx, edit.ID, edit.SupervisorIDs...); err != nil {
			return nil, err
		}
	}
	canModify, err := s.CanModifyActivity(ctx, edit.ID, requestingStaffID, hasManagePermission)
	if err != nil {
		return nil, &activityContract.ActivityError{Op: opCheckPermissions, Err: err}
	}
	if !canModify {
		return nil, &activityContract.ActivityError{Op: "update group", Err: activityContract.ErrNotOwner}
	}
	group, supervisors, schedules, err := s.GetGroupWithDetails(ctx, edit.ID)
	if err != nil {
		return nil, err
	}
	if err := readstate.Check(edit.ExpectedVersion, activityContract.GroupVersion(group, supervisors, schedules)); err != nil {
		return nil, err
	}
	return group, nil
}

// applyGroupEdit writes the parts of the edit onto the stored group.
func applyGroupEdit(group *activityContract.Group, edit activityContract.GroupEdit) {
	group.Name = edit.Name
	group.MaxParticipants = edit.MaxParticipants
	group.CategoryID = edit.CategoryID
	if edit.IsOpen != nil {
		group.IsOpen = *edit.IsOpen
	}
	if edit.SetPlannedRoom {
		group.PlannedRoomID = edit.PlannedRoomID
	}
}

// replaceGroupSchedules deletes the group's schedules and adds the given ones.
func (s *ActivityService) replaceGroupSchedules(ctx context.Context, groupID int64, schedules []*activityContract.Schedule) error {
	existingSchedules, err := s.GetGroupSchedules(ctx, groupID)
	if err != nil {
		return err
	}
	for _, schedule := range existingSchedules {
		if err := s.DeleteSchedule(ctx, schedule.ID); err != nil {
			return err
		}
	}
	for _, schedule := range schedules {
		if _, err := s.AddSchedule(ctx, groupID, schedule); err != nil {
			return err
		}
	}
	return nil
}
