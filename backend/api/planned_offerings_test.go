package api

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/grouplive"
	projectionStudentsHTTP "github.com/moto-ogs/project-phoenix/modules/presenceprojection/http"
	"github.com/moto-ogs/project-phoenix/modules/supervisiondashboard"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// offeringTimetable answers the three set reads behind the offerings and
// counts them.
type offeringTimetable struct {
	participants []timetable.PlannedInstanceStudent
	instances    []timetable.ActivityInstance
	types        map[int64]string
	err          error
	reads        int
	filter       timetable.InstanceStudentFilter
}

func (f *offeringTimetable) ListPlannedInstanceStudents(_ context.Context, filter timetable.InstanceStudentFilter) ([]timetable.PlannedInstanceStudent, error) {
	f.reads++
	f.filter = filter
	return f.participants, f.err
}

func (f *offeringTimetable) ListActivityInstances(context.Context, timetable.ActivityInstanceFilter) ([]timetable.ActivityInstance, error) {
	f.reads++
	return f.instances, nil
}

func (f *offeringTimetable) ListBlockDisplayMetadata(context.Context, []int64) (map[int64]timetable.BlockDisplayMetadata, error) {
	f.reads++
	metadata := make(map[int64]timetable.BlockDisplayMetadata, len(f.types))
	for id, blockType := range f.types {
		metadata[id] = timetable.BlockDisplayMetadata{ActivityType: blockType}
	}
	return metadata, nil
}

// TestPlannedOfferingsServeEveryChildCard pins that "Gruppen", "Alle Kinder"
// and "Aktuelle Aufsicht" read a child's offerings from one Timetable read
// (#8194): the same blocks in the same order on each card, without care
// blocks, in three set reads however many children are asked for.
func TestPlannedOfferingsServeEveryChildCard(t *testing.T) {
	t.Parallel()
	source := &offeringTimetable{
		participants: []timetable.PlannedInstanceStudent{
			{InstanceID: 12, StudentID: 2}, {InstanceID: 11, StudentID: 1}, {InstanceID: 12, StudentID: 1}, {InstanceID: 13, StudentID: 1},
		},
		// As the owner returns them: by start time.
		instances: []timetable.ActivityInstance{
			{ID: 13, Title: "Mittagessen", StartTime: "12:00:00", EndTime: "13:00:00"},
			{ID: 11, Title: "Töpfer-AG", StartTime: "14:00:00", EndTime: "15:00:00"},
			{ID: 12, Title: "Handball", StartTime: "15:15:00", EndTime: "16:00:00"},
		},
		types: map[int64]string{11: timetable.GroupTypeActivity, 12: timetable.GroupTypeExternal, 13: "care"},
	}
	offerings := plannedOfferings{timetable: source, blockTypes: source}
	day := calendar.NewDate(2026, 8, 24)
	ctx := context.Background()

	group, err := groupLivePlanning{offerings: offerings}.PlannedActivities(ctx, []int64{1, 2, 3}, grouplive.Date(day.String()))
	require.NoError(t, err)
	assert.Equal(t, map[int64][]grouplive.PlannedActivity{
		1: {{Title: "Töpfer-AG", StartTime: "14:00", EndTime: "15:00"}, {Title: "Handball", StartTime: "15:15", EndTime: "16:00"}},
		2: {{Title: "Handball", StartTime: "15:15", EndTime: "16:00"}},
	}, group)
	assert.Equal(t, 3, source.reads, "participants, their blocks, block types")
	require.NotNil(t, source.filter.Date)
	assert.Equal(t, day.String(), *source.filter.Date)
	assert.True(t, source.filter.ExcludeCancelled)
	assert.Equal(t, []int64{1, 2, 3}, source.filter.StudentIDs)

	list, err := studentListPlannedActivities{offerings: offerings}.PlannedActivities(ctx, []int64{1, 2, 3}, day)
	require.NoError(t, err)
	assert.Equal(t, map[int64][]projectionStudentsHTTP.StudentListPlannedActivity{
		1: {{Title: "Töpfer-AG", StartTime: "14:00", EndTime: "15:00"}, {Title: "Handball", StartTime: "15:15", EndTime: "16:00"}},
		2: {{Title: "Handball", StartTime: "15:15", EndTime: "16:00"}},
	}, list)

	// The dashboard takes a flat list: in the order of the asked children,
	// each child's offerings by start time.
	dashboard, err := supervisionPlannedActivities{offerings: offerings}.PlannedActivities(ctx, []int64{2, 3, 1}, supervisiondashboard.Date(day.String()))
	require.NoError(t, err)
	assert.Equal(t, []supervisiondashboard.SupervisionPlannedActivity{
		{StudentID: 2, Title: "Handball", StartTime: "15:15", EndTime: "16:00"},
		{StudentID: 1, Title: "Töpfer-AG", StartTime: "14:00", EndTime: "15:00"},
		{StudentID: 1, Title: "Handball", StartTime: "15:15", EndTime: "16:00"},
	}, dashboard)

	idle := &offeringTimetable{}
	none, err := supervisionPlannedActivities{offerings: plannedOfferings{timetable: idle, blockTypes: idle}}.PlannedActivities(ctx, nil, supervisiondashboard.Date(day.String()))
	require.NoError(t, err)
	assert.Empty(t, none)
	assert.Zero(t, idle.reads, "no child, no read")

	failure := errors.New("timetable unavailable")
	broken := &offeringTimetable{err: failure}
	_, err = supervisionPlannedActivities{offerings: plannedOfferings{timetable: broken, blockTypes: broken}}.PlannedActivities(ctx, []int64{1}, supervisiondashboard.Date(day.String()))
	require.ErrorIs(t, err, failure)
	_, err = studentListPlannedActivities{offerings: plannedOfferings{timetable: broken, blockTypes: broken}}.PlannedActivities(ctx, []int64{1}, day)
	require.ErrorIs(t, err, failure)
}
