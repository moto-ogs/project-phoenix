package api

import (
	"context"
	"errors"
	"testing"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/schoolsearchview"
	"github.com/stretchr/testify/require"
)

// noteAudienceCaller is a member of staff with their own groups, activities
// and classes, as the note card's routes read them.
type noteAudienceCaller struct {
	groups, led, activities []int64
	classes                 []string
	err                     error
}

func (noteAudienceCaller) HasCurrentStaff(context.Context) (bool, error) { return true, nil }
func (c noteAudienceCaller) MyGroupIDs(context.Context) ([]int64, error) { return c.groups, c.err }
func (c noteAudienceCaller) MyTeacherGroupIDs(context.Context) ([]int64, error) {
	return c.led, nil
}
func (c noteAudienceCaller) MyActivityGroupIDs(context.Context) ([]int64, error) {
	return c.activities, nil
}
func (c noteAudienceCaller) MySchoolClasses(context.Context) ([]string, error) { return c.classes, nil }

func noteAudienceContext(granted ...string) context.Context {
	return context.WithValue(context.Background(), sessiontoken.CtxPermissions, granted)
}

// TestSchoolSearchNoteAudienceAsksTheCardsRule binds the search's note
// audience to the note card's rule (ADR 0234): the child's OGS group, its
// class written any way, or an activity of the caller puts the caller in the
// care team; nothing else does. An administrator is in every care team.
func TestSchoolSearchNoteAudienceAsksTheCardsRule(t *testing.T) {
	t.Parallel()
	group, other, activity := int64(11), int64(12), int64(21)
	audience := schoolSearchNoteAudience{caller: noteAudienceCaller{
		groups: []int64{group}, led: []int64{group}, activities: []int64{activity}, classes: []string{" 3A "},
	}}
	reader, err := audience.NoteReader(noteAudienceContext(permissions.UsersRead))
	require.NoError(t, err)
	require.False(t, reader.Admin)
	require.Equal(t, []int64{group}, reader.LedEducationGroupIDs)
	require.Equal(t, []int64{activity}, reader.LedActivityGroupIDs, "an activity's supervisor leads it for the note card")

	require.True(t, reader.HasChild(schoolsearchview.NoteChild{GroupID: &group}), "own OGS group")
	require.True(t, reader.HasChild(schoolsearchview.NoteChild{GroupID: &other, SchoolClass: "3a"}), "own class, any spelling")
	require.True(t, reader.HasChild(schoolsearchview.NoteChild{GroupID: &other, ActivityGroupIDs: []int64{activity}}), "own activity")
	require.False(t, reader.HasChild(schoolsearchview.NoteChild{GroupID: &other, SchoolClass: "4b", ActivityGroupIDs: []int64{99}}),
		"a child of somebody else's group, class and activity")

	admin, err := schoolSearchNoteAudience{caller: noteAudienceCaller{}}.NoteReader(noteAudienceContext(permissions.AdminWildcard))
	require.NoError(t, err)
	require.True(t, admin.Admin)
	require.True(t, admin.HasChild(schoolsearchview.NoteChild{}))

	_, err = schoolSearchNoteAudience{caller: noteAudienceCaller{err: errors.New("lookup failed")}}.NoteReader(noteAudienceContext(permissions.UsersRead))
	require.Error(t, err, "an unknown reach never becomes an audience")
}
