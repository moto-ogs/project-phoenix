package owners

import (
	"log/slog"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	timetableCompose "github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	timetablePorts "github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/realtime"
)

// TimetableMaterializationDependencies binds the recurrence engine to the
// realtime hub over the template rows. careBounds is the per-date care
// filter (#2487); nonWorkingDays skips holidays and closing days (#3594);
// broadcaster announces created occurrences to the staffing caches (#1844).
// The composition root adds its database handle to the dependencies they
// bind.
func TimetableMaterializationDependencies(
	rows timetableCompose.TemplateRows, careBounds timetablePorts.CareBoundReader, nonWorkingDays timetable.NonWorkingDayCalendar,
	recurrenceLock timetable.RecurrenceWriteLock, broadcaster realtime.Broadcaster, logger *slog.Logger,
) timetablePorts.MaterializationDependencies {
	return timetablePorts.MaterializationDependencies{
		GroupRepo:      rows.Groups,
		ScheduleRepo:   rows.Schedules,
		EnrollmentRepo: rows.Enrollments,
		SupervisorRepo: rows.Supervisors,
		Directories:    rows.Directories,
		PeriodRepo:     rows.CalendarPeriods,
		InstanceRepo:   rows.Instances,
		StaffRepo:      rows.InstanceStaff,
		StudentRepo:    rows.Participants,
		ExceptionRepo:  rows.Exceptions,
		TimeframeRepo:  rows.Timeframes,
		CareBounds:     careBounds,
		NonWorkingDays: nonWorkingDays,
		RecurrenceLock: recurrenceLock,
		Staffing:       NewStaffingAnnouncer(broadcaster),
		Logger:         logger,
	}
}

// staffingAnnouncer wakes the staffing caches through the realtime hub; the
// event carries no child.
type staffingAnnouncer struct {
	broadcaster realtime.Broadcaster
}

func NewStaffingAnnouncer(broadcaster realtime.Broadcaster) timetablePorts.StaffingAnnouncer {
	if broadcaster == nil {
		return nil
	}
	return staffingAnnouncer{broadcaster: broadcaster}
}

func (a staffingAnnouncer) AnnounceStaffingChanged(tenantID int64, source string) error {
	event := realtime.NewEvent(realtime.EventStaffingDeviationChanged, "", realtime.EventData{Source: &source})
	return a.broadcaster.BroadcastToTenant(tenantID, event)
}

// NewStaffNoticeAnnouncer binds Timetable's change signal of the staff
// notices (#7667) to staff_notices_changed: it wakes the readers of the
// Hinweise der Leitung through the realtime hub and carries no notice.
func NewStaffNoticeAnnouncer(broadcaster realtime.Broadcaster) timetablePorts.StaffingAnnouncer {
	if broadcaster == nil {
		return nil
	}
	return timetablePorts.StaffingAnnouncerFunc(func(tenantID int64, source string) error {
		event := realtime.NewEvent(realtime.EventStaffNoticesChanged, "", realtime.EventData{Source: &source})
		return broadcaster.BroadcastToTenant(tenantID, event)
	})
}
