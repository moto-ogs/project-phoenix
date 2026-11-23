package httpintegration_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	timetableCompose "github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	"github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// countGroupRows lists one group beside the enrollment rows.
type countGroupRows struct {
	countEnrollmentRows
	groups []timetable.Group
}

func (s countGroupRows) ListGroups(context.Context, timetable.GroupFilter) ([]timetable.Group, error) {
	return s.groups, nil
}

// A child can hold several roster rows on one group: a dated switch splits
// its row, and a booking that ends early leaves one row per stretch (#7908).
// The staff reads list and count the child once.
func TestEnrolledStudentsListEachChildOnce(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	groupID := testpkg.CreateTestActivityGroup(t, db, "Mehrere Zeilen").ID
	split := testpkg.CreateTestStudent(t, db, "Geteilt", "Kind", "2a").ID
	single := testpkg.CreateTestStudent(t, db, "Eine", "Zeile", "2a").ID
	february := "2027-02-01"
	rows := countGroupRows{
		countEnrollmentRows: countEnrollmentRows{rows: []timetable.StudentEnrollment{
			{ActivityGroupID: groupID, StudentID: split, ValidFrom: "2026-09-01", ValidUntil: &february, SelectedWeekdays: []int{1, 2}},
			{ActivityGroupID: groupID, StudentID: split, ValidFrom: february, SelectedWeekdays: []int{2}},
			{ActivityGroupID: groupID, StudentID: single, ValidFrom: "2026-09-01"},
		}},
		groups: []timetable.Group{{ID: groupID, Name: "Liste"}},
	}
	directories := ports.RepositoryDirectories{
		StudentAlumni: func(context.Context, []int64) (map[int64]bool, error) { return nil, nil },
		StudentNames:  func(context.Context, []int64) (map[int64]ports.PersonName, error) { return nil, nil },
	}
	students := countStudentReader{read: func([]int64) (map[int64]*timetable.OperationStudent, error) {
		return map[int64]*timetable.OperationStudent{
			split:  {LifecycleStudent: timetable.LifecycleStudent{ID: split}},
			single: {LifecycleStudent: timetable.LifecycleStudent{ID: single}},
		}, nil
	}}
	service, err := timetableCompose.NewService(rows, nil, directories, nil, nil, students, func() calendar.Date { return calendar.NewDate(2026, 11, 23) })
	require.NoError(t, err)
	ctx := testpkg.Ctx(t)

	enrolled, err := service.GetEnrolledStudents(ctx, groupID)
	require.NoError(t, err)
	ids := make([]int64, 0, len(enrolled))
	for _, student := range enrolled {
		ids = append(ids, student.ID)
	}
	assert.ElementsMatch(t, []int64{split, single}, ids, "the roster lists each child once")

	counts, err := service.GetEnrollmentCounts(ctx, []int64{groupID})
	require.NoError(t, err)
	assert.Equal(t, 2, counts[groupID], "the batched count counts children, not rows")

	_, listCounts, err := service.GetGroupsWithEnrollmentCounts(ctx)
	require.NoError(t, err)
	assert.Equal(t, 2, listCounts[groupID], "the activity list counts children, not rows")
}
