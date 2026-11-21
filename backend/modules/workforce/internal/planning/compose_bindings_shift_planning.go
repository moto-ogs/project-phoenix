package planning

import (
	"context"

	"github.com/moto-ogs/project-phoenix/realtime"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ShiftOptions binds the shift service's optional collaborators: the series
// exceptions and sick reports the Workforce records serve (#1889, #6302), the
// broadcaster, the calendar-day clock and the staff row batch lock (#7683).
func ShiftOptions(records Records, broadcaster realtime.Broadcaster, today func() calendar.Date, lockStaffRows func(context.Context, []int64) error) []StaffShiftOption {
	return []StaffShiftOption{
		WithStaffShiftSeriesExceptions(records),
		WithStaffShiftBroadcaster(broadcaster),
		WithStaffShiftSickReports(records),
		WithStaffShiftToday(today),
		WithStaffShiftStaffRowLocks(lockStaffRows),
	}
}

// seriesOptions binds the series service's optional collaborators. A nil
// calendar is left unbound, so the service sees no typed-nil reader.
func SeriesOptions(broadcaster realtime.Broadcaster, today func() calendar.Date, nonWorkingDays SeriesCalendarReads, sickReports SickReportReader) []StaffShiftSeriesOption {
	options := []StaffShiftSeriesOption{
		WithStaffShiftSeriesBroadcaster(broadcaster),
		WithStaffShiftSeriesToday(today),
		WithStaffShiftSeriesSickReports(sickReports),
	}
	if nonWorkingDays != nil {
		options = append(options, WithStaffShiftSeriesNonWorkingDays(SchoolCalendarNonWorkingDays(nonWorkingDays)))
	}
	return options
}
