package groups

import (
	"context"
	"maps"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/schoolstructure"
	"github.com/moto-ogs/project-phoenix/modules/schoolstructure/contract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// EditGroup applies an edit of a group in the caller's tenant unit (ADR
// 0311): it locks the group row and then its teacher assignments, which
// offboarding removes without the group row, refuses the edit with
// readstate.ErrChanged unless the group, its room and its teachers are
// stored as the editor read them, and writes the name and, where the edit
// names them, the room and the teachers. The lock, the check and the writes
// commit or roll back with that unit.
func (s *service) EditGroup(ctx context.Context, edit schoolstructure.GroupEdit) error {
	existing, err := s.groupRepo.FindByIDForUpdate(ctx, edit.ID)
	if err != nil {
		return &EducationError{Op: "EditGroup", Err: ErrGroupNotFound}
	}
	assignments, err := s.groupTeacherRepo.TeacherAssignmentIDs(ctx, edit.ID)
	if err != nil {
		return &EducationError{Op: "EditGroup", Err: err}
	}
	teachers, err := s.assignedTeachers(ctx, assignments)
	if err != nil {
		return err
	}
	if err := readstate.Check(edit.ExpectedVersion, contract.GroupVersion(PublicGroup(existing), teacherIDs(teachers))); err != nil {
		return err
	}
	updated := *existing
	updated.Name = edit.Name
	if edit.SetRoom {
		updated.RoomID = (*ident.ID)(edit.RoomID)
	}
	if err := s.UpdateGroup(ctx, &updated); err != nil {
		return err
	}
	if !edit.ReplaceTeachers {
		return nil
	}
	// The group row and its assignments stay locked since the check, so
	// the locked set is the one to replace.
	changed, err := s.replaceGroupTeachers(ctx, edit.ID, assignments, edit.TeacherIDs)
	if err == nil && changed {
		s.announceGroupAccessChanged(ctx, "group_teachers")
	}
	return err
}

// assignedTeachers are the teachers of the locked assignments, read like
// GetGroupTeachers so the check compares the token the read returned.
func (s *service) assignedTeachers(ctx context.Context, assignments map[int64]int64) ([]*Teacher, error) {
	if len(assignments) == 0 {
		return []*Teacher{}, nil
	}
	teachers, err := s.teachers.ListTeachers(ctx, slices.Collect(maps.Keys(assignments)))
	if err != nil {
		return nil, &EducationError{Op: "EditGroup", Err: err}
	}
	return teachers, nil
}

// teacherIDs are the IDs of the teachers.
func teacherIDs(teachers []*Teacher) []int64 {
	ids := make([]int64, 0, len(teachers))
	for _, teacher := range teachers {
		if teacher != nil {
			ids = append(ids, int64(teacher.ID))
		}
	}
	return ids
}
