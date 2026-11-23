package httpintegration_test

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ADR 0311: an edit of a block saves back the block its editor read. A
// child added to the roster after the read (by another editor or a roster
// write) makes the old version stale: the edit is refused and writes
// nothing, also without a version. The version read after it saves.
func TestInstance_UpdatePlannedRefusesABlockChangedSinceItsRead(t *testing.T) {
	t.Parallel()

	s := buildLifecycle(t)
	instance := seedInstance(t, s, true, true)
	read := plannerVersion(t, s.ctx, s.timetableData.Data, instance.ID)
	edit := timetable.UpdateInstanceInput{
		Date: calendar.Date(instance.Date), StartTime: instance.StartTime, EndTime: instance.EndTime,
		Title: "Überschrieben", RoomID: s.roomID, StaffIDs: []int64{s.staffID}, StudentIDs: []int64{s.student1},
	}

	late := testpkg.CreateTestStudent(t, s.db, "LC-Late", "Kind", "3a")
	testpkg.CreateTestInstanceStudent(t, s.db, instance.ID, late.ID, timetable.SlotAttendanceExpected)

	for name, version := range map[string]string{"stale": read, "none": ""} {
		edit.ExpectedVersion = version
		_, err := s.svc.UpdatePlanned(s.ctx, instance.ID, edit, nil)
		require.ErrorIs(t, err, readstate.ErrChanged, name)
	}
	stored := reloadInstance(t, s, instance.ID)
	assert.Equal(t, instance.Title, stored.Title, "a refused edit writes nothing")
	assert.NotEqual(t, read, plannerVersion(t, s.ctx, s.timetableData.Data, instance.ID))

	edit.ExpectedVersion = plannerVersion(t, s.ctx, s.timetableData.Data, instance.ID)
	updated, err := s.svc.UpdatePlanned(s.ctx, instance.ID, edit, nil)
	require.NoError(t, err)
	assert.Equal(t, "Überschrieben", updated.Title)
}
