package application

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	scheduleModels "github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain/schedulerecords"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func TestReinstatedInstancesFollowTemplateSlotAcrossRematerialization(t *testing.T) {
	t.Parallel()

	date := calendar.NewDate(2026, time.November, 21)
	groupID, oldInstanceID, replacementID := int64(41), int64(91), int64(92)
	start := time.Date(1, 1, 1, 14, 0, 0, 0, time.UTC)
	replacement := &scheduleModels.ActivityInstance{
		Date: date, ActivityGroupID: &groupID, StartTime: start,
	}
	replacement.ID = replacementID
	cancelled := timetable.DeviationEvent{
		ID: 1, ActivityGroupID: &groupID, OccurrenceDate: date, StartTime: start,
		InstanceID: &oldInstanceID, EventType: DeviationEventCancellation,
	}

	for _, scenario := range []struct {
		name       string
		instanceID *int64
	}{
		{name: "old instance ID", instanceID: &oldInstanceID},
		{name: "no instance ID"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			events := []timetable.DeviationEvent{
				cancelled,
				{
					ID: 2, ActivityGroupID: &groupID, OccurrenceDate: date, StartTime: start,
					InstanceID: scenario.instanceID, EventType: DeviationEventReinstatement,
				},
			}

			assert.True(t, reinstatedInstances([]*scheduleModels.ActivityInstance{replacement}, events)[replacementID])
		})
	}
}
