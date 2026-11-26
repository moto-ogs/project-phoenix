package api

// One Timetable read serves the day's planned offerings (#6487) on every
// child card: "Gruppen", "Alle Kinder" and "Aktuelle Aufsicht" (#8194). It
// is three set reads: the planned participants of the day's blocks, the
// blocks themselves and their block types. The statement count does not grow
// with the number of children. Each view owns its wire type; its binding
// only translates the rows.

import (
	"context"
	"slices"

	projectionStudentsHTTP "github.com/moto-ogs/project-phoenix/modules/presenceprojection/http"
	settingsplatform "github.com/moto-ogs/project-phoenix/modules/settings"
	"github.com/moto-ogs/project-phoenix/modules/supervisiondashboard"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// plannedOfferingTimetable is the Timetable read of the planned participants
// and their blocks.
type plannedOfferingTimetable interface {
	ListPlannedInstanceStudents(ctx context.Context, filter timetable.InstanceStudentFilter) ([]timetable.PlannedInstanceStudent, error)
	ListActivityInstances(ctx context.Context, filter timetable.ActivityInstanceFilter) ([]timetable.ActivityInstance, error)
}

// plannedOfferingBlockTypes is the Timetable read of each block's display
// data; the card reads only the block type from it.
type plannedOfferingBlockTypes interface {
	ListBlockDisplayMetadata(ctx context.Context, instanceIDs []int64) (map[int64]timetable.BlockDisplayMetadata, error)
}

// plannedOffering is one offering of a child's day with its wall-clock times
// (HH:MM).
type plannedOffering struct {
	Title     string
	StartTime string
	EndTime   string
}

// plannedOfferings reads the day's offerings of many children.
type plannedOfferings struct {
	timetable  plannedOfferingTimetable
	blockTypes plannedOfferingBlockTypes
}

// byStudent lists, per child, the day's offerings it is planned for, without
// cancelled ones and without care or duty blocks, by start time.
func (p plannedOfferings) byStudent(ctx context.Context, studentIDs []int64, day string) (map[int64][]plannedOffering, error) {
	result := map[int64][]plannedOffering{}
	if len(studentIDs) == 0 {
		return result, nil
	}
	participants, err := p.timetable.ListPlannedInstanceStudents(ctx, timetable.InstanceStudentFilter{
		StudentIDs: studentIDs, Date: &day, ExcludeCancelled: true,
	})
	if err != nil || len(participants) == 0 {
		return result, err
	}
	instanceIDs := make([]int64, 0, len(participants))
	for _, participant := range participants {
		instanceIDs = append(instanceIDs, participant.InstanceID)
	}
	slices.Sort(instanceIDs)
	instances, err := p.timetable.ListActivityInstances(ctx, timetable.ActivityInstanceFilter{
		IDs: slices.Compact(instanceIDs), Status: timetable.InstanceStatusPlanned, OrderByDateAndTime: true,
	})
	if err != nil || len(instances) == 0 {
		return result, err
	}
	instances, err = p.offeringsOnly(ctx, instances)
	if err != nil {
		return nil, err
	}
	studentsByInstance := make(map[int64][]int64, len(instances))
	for _, participant := range participants {
		studentsByInstance[participant.InstanceID] = append(studentsByInstance[participant.InstanceID], participant.StudentID)
	}
	for _, instance := range instances {
		offering := plannedOffering{
			Title: instance.Title, StartTime: wallClockMinutes(instance.StartTime), EndTime: wallClockMinutes(instance.EndTime),
		}
		for _, studentID := range studentsByInstance[instance.ID] {
			result[studentID] = append(result[studentID], offering)
		}
	}
	return result, nil
}

// offeringsOnly keeps the blocks whose type is an offering, in their order.
func (p plannedOfferings) offeringsOnly(ctx context.Context, instances []timetable.ActivityInstance) ([]timetable.ActivityInstance, error) {
	ids := make([]int64, 0, len(instances))
	for _, instance := range instances {
		ids = append(ids, instance.ID)
	}
	metadata, err := p.blockTypes.ListBlockDisplayMetadata(ctx, ids)
	if err != nil {
		return nil, err
	}
	return slices.DeleteFunc(instances, func(instance timetable.ActivityInstance) bool {
		return !timetable.IsOfferingType(metadata[instance.ID].ActivityType)
	}), nil
}

// wallClockMinutes cuts a TIME text ("14:00:00") to the card's "14:00".
func wallClockMinutes(clock string) string {
	if len(clock) > len("15:04") {
		return clock[:len("15:04")]
	}
	return clock
}

// studentListPlannedActivities binds the offerings to the cards of "Alle
// Kinder" (#8194).
type studentListPlannedActivities struct{ offerings plannedOfferings }

func (b studentListPlannedActivities) PlannedActivities(ctx context.Context, studentIDs []int64, day calendar.Date) (map[int64][]projectionStudentsHTTP.StudentListPlannedActivity, error) {
	rows, err := b.offerings.byStudent(ctx, studentIDs, day.String())
	if err != nil {
		return nil, err
	}
	result := make(map[int64][]projectionStudentsHTTP.StudentListPlannedActivity, len(rows))
	for studentID, offerings := range rows {
		for _, offering := range offerings {
			result[studentID] = append(result[studentID], projectionStudentsHTTP.StudentListPlannedActivity(offering))
		}
	}
	return result, nil
}

// supervisionPlannedActivities binds the offerings to the cards of "Aktuelle
// Aufsicht" (#8194), in the order of the requested children.
type supervisionPlannedActivities struct{ offerings plannedOfferings }

func (b supervisionPlannedActivities) PlannedActivities(ctx context.Context, studentIDs []int64, date supervisiondashboard.Date) ([]supervisiondashboard.SupervisionPlannedActivity, error) {
	rows, err := b.offerings.byStudent(ctx, studentIDs, string(date))
	if err != nil {
		return nil, err
	}
	result := make([]supervisiondashboard.SupervisionPlannedActivity, 0, len(rows))
	for _, studentID := range studentIDs {
		for _, offering := range rows[studentID] {
			result = append(result, supervisiondashboard.SupervisionPlannedActivity{
				StudentID: ident.ID(studentID), Title: offering.Title, StartTime: offering.StartTime, EndTime: offering.EndTime,
			})
		}
	}
	return result, nil
}

// StudentCardActivitiesEnabled reports whether the school shows the offerings
// on its child cards (#6487).
func (s supervisionSettings) StudentCardActivitiesEnabled(ctx context.Context) (bool, error) {
	return s.settings.ResolveBool(ctx, settingsplatform.KeyStudentCardActivitiesEnabled)
}
