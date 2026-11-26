package supervisiondashboard

import (
	"context"
	"errors"
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type plannedActivityReader struct {
	activities []SupervisionPlannedActivity
	err        error
	asked      [][]int64
	dates      []Date
}

func (r *plannedActivityReader) PlannedActivities(_ context.Context, ids []int64, date Date) ([]SupervisionPlannedActivity, error) {
	r.asked = append(r.asked, ids)
	r.dates = append(r.dates, date)
	return r.activities, r.err
}

func cardActivities(enabled bool) func(context.Context) (bool, error) {
	return func(context.Context) (bool, error) { return enabled, nil }
}

// TestLoadPlannedActivitiesSharesPlanningGate pins the offerings on the child
// cards of "Aktuelle Aufsicht" (#8194): they share the gate of the planning
// times (users:read and full access) and follow the school's setting.
func TestLoadPlannedActivitiesSharesPlanningGate(t *testing.T) {
	t.Parallel()
	const date Date = "2026-08-19"
	activity := SupervisionPlannedActivity{StudentID: 42, Title: "Töpfer-AG", StartTime: "14:00", EndTime: "15:00"}
	reading := Caller{CanReadStudents: true}

	reader := &plannedActivityReader{activities: []SupervisionPlannedActivity{activity}}
	svc := newService(&fakes{cardActivitiesEnabled: cardActivities(true)})
	svc.deps.PlannedActivities = reader
	projection := emptyProjection()
	require.NoError(t, svc.loadPlannedActivities(context.Background(), projection, reading, []int64{42, 43}, true, date))
	assert.Equal(t, []SupervisionPlannedActivity{activity}, projection.PlannedActivities)
	assert.Equal(t, [][]int64{{42, 43}}, reader.asked)
	assert.Equal(t, []Date{date}, reader.dates)

	for name, gate := range map[string]struct {
		caller     Caller
		fullAccess bool
		enabled    bool
	}{
		"without users:read":  {Caller{}, true, true},
		"without full access": {reading, false, true},
		"switched off":        {reading, true, false},
	} {
		reader := &plannedActivityReader{activities: []SupervisionPlannedActivity{activity}}
		svc := newService(&fakes{cardActivitiesEnabled: cardActivities(gate.enabled)})
		svc.deps.PlannedActivities = reader
		projection := emptyProjection()
		require.NoError(t, svc.loadPlannedActivities(context.Background(), projection, gate.caller, []int64{42}, gate.fullAccess, date), name)
		assert.Empty(t, projection.PlannedActivities, name)
		assert.Empty(t, reader.asked, name)
	}

	failure := errors.New("timetable unavailable")
	svc = newService(&fakes{cardActivitiesEnabled: cardActivities(true)})
	svc.deps.PlannedActivities = &plannedActivityReader{err: failure}
	require.ErrorIs(t, svc.loadPlannedActivities(context.Background(), emptyProjection(), reading, []int64{42}, true, date), failure)

	settingFailure := errors.New("settings unavailable")
	svc = newService(&fakes{cardActivitiesEnabled: func(context.Context) (bool, error) { return false, settingFailure }})
	svc.deps.PlannedActivities = &plannedActivityReader{}
	require.ErrorIs(t, svc.loadPlannedActivities(context.Background(), emptyProjection(), reading, []int64{42}, true, date), settingFailure)
}

// TestDashboardAttachesPlannedActivities pins that the dashboard itself loads
// the offerings for the children it shows, and that a projection without
// them carries an empty list, never null.
func TestDashboardAttachesPlannedActivities(t *testing.T) {
	t.Parallel()
	yardGroupID := int64(30)
	activity := SupervisionPlannedActivity{StudentID: 1, Title: "Handball", StartTime: "15:15", EndTime: "16:00"}
	reader := &plannedActivityReader{activities: []SupervisionPlannedActivity{activity}}
	svc := newService(&fakes{
		currentStaffID:        func(context.Context) (*int64, error) { return int64Ptr(77), nil },
		caller:                func(context.Context) (Caller, error) { return Caller{CanReadStudents: true}, nil },
		fullStudentAccess:     func(context.Context) (bool, error) { return true, nil },
		cardActivitiesEnabled: cardActivities(true),
		supervised:            func(context.Context) ([]Session, error) { return []Session{{ID: 10, RoomName: "Adler"}}, nil },
		yard: func(context.Context, int64) (*SchulhofStatus, error) {
			return &SchulhofStatus{Exists: true, IsUserSupervising: true, ActiveGroupID: (*ident.ID)(&yardGroupID)}, nil
		},
		groupVisits: func(_ context.Context, activeGroupID int64) ([]VisitRecord, error) {
			return []VisitRecord{{StudentID: 1, ActiveGroupID: activeGroupID, FirstName: "Erika", LastName: "Muster"}}, nil
		},
	})
	svc.deps.PlannedActivities = reader

	projection, err := svc.Dashboard(context.Background(), yardGroupID)

	require.NoError(t, err)
	assert.Equal(t, []SupervisionPlannedActivity{activity}, projection.PlannedActivities)
	assert.Equal(t, [][]int64{{1}}, reader.asked)
	assert.NotNil(t, emptyProjection().PlannedActivities)
}
