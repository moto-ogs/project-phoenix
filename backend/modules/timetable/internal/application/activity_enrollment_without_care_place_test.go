package application

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	activityContract "github.com/moto-ogs/project-phoenix/modules/timetable/activitycontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestEnrollmentRefusesChildrenWithoutCarePlace keeps a child of the class
// without an OGS place (#4803) out of every AG and care offering write.
func TestEnrollmentRefusesChildrenWithoutCarePlace(t *testing.T) {
	t.Parallel()
	today := calendar.Date("2026-09-09")
	locked := map[int64]*timetable.OperationStudent{
		1: {LifecycleStudent: timetable.LifecycleStudent{ID: 1}},
		2: {LifecycleStudent: timetable.LifecycleStudent{ID: 2, WithoutCarePlace: true}},
	}

	require.NoError(t, rejectAlumniFrom(locked, []int64{1}, today))
	assert.ErrorIs(t, rejectAlumniFrom(locked, []int64{1, 2}, today), activityContract.ErrStudentWithoutCarePlace)
}

// TestNoOGSCareForChildrenWithoutCarePlace answers every timetable gate that
// asks for running care (instance rosters, available groups, roster reads)
// with "no care" for a child without an OGS place (#4803 review).
func TestNoOGSCareForChildrenWithoutCarePlace(t *testing.T) {
	t.Parallel()
	day := calendar.Date("2026-09-09")
	assert.True(t, (&timetable.LifecycleStudent{WithoutCarePlace: true}).CareEndedOn(day))
	assert.False(t, (&timetable.LifecycleStudent{}).CareEndedOn(day))
}
