package owners

import (
	"context"
	"testing"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/stretchr/testify/require"
)

type staffingNoticeGroupTeachers struct{}

func (staffingNoticeGroupTeachers) ListGroupAssignments(context.Context, schoolmembership.GroupAssignmentFilter) ([]schoolmembership.GroupAssignment, error) {
	return nil, nil
}

func (staffingNoticeGroupTeachers) ListTeachers(context.Context, schoolmembership.TeacherFilter) ([]schoolmembership.Teacher, error) {
	return nil, nil
}

type staffingNoticeGroups struct{}

func (staffingNoticeGroups) BlockEducationGroups(context.Context, []int64) (map[int64][]int64, error) {
	return nil, nil
}

func TestNewTimetableStaffingNoticeDependenciesDisablesStaffingWithoutWorkforce(t *testing.T) {
	t.Parallel()

	notices := newTimetableStaffingNoticeDependencies(
		staffPushRouterFunc(func(context.Context, deliveryCompose.NotificationEvent) error { return nil }),
		staffPushPreferencesFunc(func(_ context.Context, _ string, ids []int64) ([]int64, error) { return ids, nil }),
		staffingNoticeGroupTeachers{}, staffingNoticeGroups{}, nil,
	)

	require.Nil(t, notices.Notices)
	require.Nil(t, notices.Groups)
	require.Nil(t, notices.Teachers)
	require.Nil(t, notices.Handovers)
}
