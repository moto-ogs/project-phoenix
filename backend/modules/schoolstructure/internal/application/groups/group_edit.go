package groups

import (
	"context"

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
	if _, err := s.groupTeacherRepo.TeacherAssignmentIDs(ctx, edit.ID); err != nil {
		return &EducationError{Op: "EditGroup", Err: err}
	}
	teachers, err := s.GetGroupTeachers(ctx, edit.ID)
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
	changed, err := s.updateGroupTeachersInTx(ctx, edit.ID, edit.TeacherIDs)
	if err == nil && changed {
		s.announceGroupAccessChanged(ctx, "group_teachers")
	}
	return err
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
