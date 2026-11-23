package compose

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// TestGroupsOfTeacherStaffReadTheTeamInOneList proves the filter of "Heute
// anders" (#7666): the assignments of the staff member's own groups, widened
// by the listed covered groups, with every teacher's staff record.
func TestGroupsOfTeacherStaffReadTheTeamInOneList(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	module := buildModule(t, db)
	ctx := testpkg.Ctx(t)
	self := testpkg.CreateTestTeacher(t, db, "Team", "Selbst")
	colleague := testpkg.CreateTestTeacher(t, db, "Team", "Kollegin")
	coverColleague := testpkg.CreateTestTeacher(t, db, "Team", "Vertretung")
	outsider := testpkg.CreateTestTeacher(t, db, "Team", "Fremd")
	own := testpkg.CreateTestEducationGroup(t, db, "Team eigene Gruppe")
	covered := testpkg.CreateTestEducationGroup(t, db, "Team vertretene Gruppe")
	other := testpkg.CreateTestEducationGroup(t, db, "Team andere Gruppe")
	for _, assignment := range []schoolmembership.CreateGroupAssignment{
		{GroupID: own.ID, TeacherID: self.ID},
		{GroupID: own.ID, TeacherID: colleague.ID},
		{GroupID: covered.ID, TeacherID: coverColleague.ID},
		{GroupID: other.ID, TeacherID: outsider.ID},
	} {
		_, err := module.CreateGroupAssignment(ctx, assignment)
		require.NoError(t, err)
	}
	teams := func(filter schoolmembership.GroupAssignmentFilter) map[int64][]int64 {
		t.Helper()
		filter.WithTeacherStaff = true
		assignments, err := module.ListGroupAssignments(ctx, filter)
		require.NoError(t, err)
		result := map[int64][]int64{}
		for _, assignment := range assignments {
			result[assignment.GroupID] = append(result[assignment.GroupID], assignment.TeacherStaffID)
		}
		return result
	}

	assert.Equal(t, map[int64][]int64{
		own.ID: {self.StaffID, colleague.StaffID},
	}, teams(schoolmembership.GroupAssignmentFilter{GroupsOfTeacherStaffIDs: []int64{self.StaffID}}))
	assert.Equal(t, map[int64][]int64{
		own.ID:     {self.StaffID, colleague.StaffID},
		covered.ID: {coverColleague.StaffID},
	}, teams(schoolmembership.GroupAssignmentFilter{GroupsOfTeacherStaffIDs: []int64{self.StaffID}, GroupIDs: []int64{covered.ID}}))
	assert.Equal(t, map[int64][]int64{
		covered.ID: {coverColleague.StaffID},
	}, teams(schoolmembership.GroupAssignmentFilter{GroupsOfTeacherStaffIDs: []int64{staffWithoutGroups(t, db)}, GroupIDs: []int64{covered.ID}}),
		"a staff member without a teacher profile adds no group")
	assert.Empty(t, teams(schoolmembership.GroupAssignmentFilter{GroupsOfTeacherStaffIDs: []int64{}}), "an empty list matches nothing")
}

func staffWithoutGroups(t *testing.T, db *bun.DB) int64 {
	t.Helper()
	return testpkg.CreateTestStaff(t, db, "Team", "Ohne").ID
}
