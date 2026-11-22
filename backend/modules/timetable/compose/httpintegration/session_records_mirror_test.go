package httpintegration_test

import (
	"context"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	fixtures "github.com/moto-ogs/project-phoenix/modules/timetable/fixturetest"
	timetablePorts "github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// mirrorCreateRecorder records the plan the mirror inserts and the session
// it starts; every other method stays nil and panics if called.
type mirrorCreateRecorder struct {
	timetable.ActivityInstanceCapability
	timetablePorts.InstanceSessions
	created *timetable.ActivityInstanceInput
	started *studentpresence.ActivitySessionStart
}

func (r *mirrorCreateRecorder) CreateActivityInstance(_ context.Context, input timetable.ActivityInstanceInput) (timetable.ActivityInstance, error) {
	r.created = &input
	return timetable.ActivityInstance{ID: 91}, nil
}

func (r *mirrorCreateRecorder) StartActivitySession(_ context.Context, start studentpresence.ActivitySessionStart) (studentpresence.ActivitySession, error) {
	r.started = &start
	return studentpresence.ActivitySession{}, nil
}

// FindByID answers the reload after the insert.
func (r *mirrorCreateRecorder) FindByID(context.Context, int64) (*fixtures.ActivityInstance, error) {
	return fixtures.NewActivityInstance(nil), nil
}

func TestCreateMirroredSessionInstanceOwnsTheSpontaneousActiveDefaults(t *testing.T) {
	t.Parallel()
	recorder := &mirrorCreateRecorder{}
	records := compose.Repositories{
		ActivityInstance: timetablePorts.InstanceRows{Plans: recorder, Sessions: recorder, Reads: fixtures.InstanceReadsOf(recorder),
			// The session starts on the mirrored day; the input names no instant.
			Now: func() time.Time { return time.Date(2026, time.April, 20, 14, 5, 0, 0, calendar.Berlin) }},
	}.NativeRecords()
	sessionID := int64(77)

	_, err := records.CreateMirroredSessionInstance(context.Background(), timetable.ScheduledInstance{
		Title: "Kiosk-Sitzung", Status: timetable.InstanceStatusPlanned, IsSpontaneous: false,
		Date: calendar.NewDate(2026, time.April, 20), RoomID: 5, ActiveGroupID: (*ident.ID)(&sessionID),
		StartTime: time.Date(2000, time.January, 1, 14, 0, 0, 0, time.UTC), EndTime: time.Date(2000, time.January, 1, 15, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("create mirrored session: %v", err)
	}
	if recorder.created == nil {
		t.Fatal("the mirror must insert one instance row")
	}
	if !recorder.created.IsSpontaneous || recorder.started == nil {
		t.Errorf("mirrored session = spontaneous %v, started %v; want spontaneous and active", recorder.created.IsSpontaneous, recorder.started != nil)
	}
}

func TestCreateMirroredSessionInstanceRejectsMissingRoom(t *testing.T) {
	t.Parallel()
	recorder := &mirrorCreateRecorder{}
	records := compose.Repositories{ActivityInstance: timetablePorts.InstanceRows{Plans: recorder, Sessions: recorder}}.NativeRecords()
	sessionID := int64(77)
	_, err := records.CreateMirroredSessionInstance(t.Context(), timetable.ScheduledInstance{
		Title: "Kiosk", Date: calendar.NewDate(2026, time.November, 2), ActiveGroupID: (*ident.ID)(&sessionID),
		StartTime: time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC), EndTime: time.Date(2000, 1, 1, 1, 0, 0, 0, time.UTC),
	})
	if err == nil || err.Error() != "room_id is required" {
		t.Fatalf("missing room: got %v", err)
	}
	if recorder.created != nil || recorder.started != nil {
		t.Fatal("missing room must reject before any plan/session write")
	}
}

// mirrorClockPlans and mirrorClockPresence serve the recorder as the owner
// capability and the Student Presence owner NewRepositories composes.
type mirrorClockPlans struct {
	timetable.Capability
	recorder *mirrorCreateRecorder
}

func (p mirrorClockPlans) CreateActivityInstance(ctx context.Context, input timetable.ActivityInstanceInput) (timetable.ActivityInstance, error) {
	return p.recorder.CreateActivityInstance(ctx, input)
}

type mirrorClockPresence struct {
	studentpresence.Owner
	recorder *mirrorCreateRecorder
}

func (p mirrorClockPresence) StartActivitySession(ctx context.Context, start studentpresence.ActivitySessionStart) (studentpresence.ActivitySession, error) {
	return p.recorder.StartActivitySession(ctx, start)
}

// mirrorClockReads answers the reload from the recorder: the shallower
// embedded instance reads win over the unused joined reads.
type mirrorClockReads struct {
	timetablePorts.LegacyInstanceReads
	mirrorUnusedReads
}

type mirrorUnusedReads struct{ compose.PresenceReads }

// A row created running without its start instant starts its session on the
// clock the repositories were composed with (ADR 0263), not on the real one.
func TestRepositoriesStartRunningRowsOnTheirClock(t *testing.T) {
	t.Parallel()
	at := time.Date(2030, time.August, 26, 10, 15, 0, 0, calendar.Berlin)
	recorder := &mirrorCreateRecorder{}
	repos := compose.NewRepositories(compose.RepositoryDependencies{
		Timetable: mirrorClockPlans{recorder: recorder}, Presence: mirrorClockPresence{recorder: recorder},
		Now: func() time.Time { return at },
	}, mirrorClockReads{LegacyInstanceReads: fixtures.InstanceReadsOf(recorder)})
	sessionID := int64(77)

	_, err := repos.NativeRecords().CreateMirroredSessionInstance(context.Background(), timetable.ScheduledInstance{
		Title: "Kiosk-Sitzung", Date: calendar.NewDate(2030, time.August, 26), RoomID: 5, ActiveGroupID: (*ident.ID)(&sessionID),
		StartTime: time.Date(2000, time.January, 1, 10, 0, 0, 0, time.UTC), EndTime: time.Date(2000, time.January, 1, 11, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("create mirrored session: %v", err)
	}
	if recorder.started == nil {
		t.Fatal("the running row must start its session")
	}
	if !recorder.started.StartedAt.Equal(at) {
		t.Errorf("session started at %v, want the composed clock's %v", recorder.started.StartedAt, at)
	}
}
