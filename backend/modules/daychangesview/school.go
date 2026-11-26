package daychangesview

import (
	"context"
	"log/slog"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// LinkSchoolClass is a class page of moto schule (#7670); the class is the
// entry's Class.Name.
const LinkSchoolClass LinkTarget = "school_class"

// LinkSchoolCalendar is the calendar of moto schule with the closing days
// (#7670).
const LinkSchoolCalendar LinkTarget = "school_calendar"

// LinkSchoolSupervisions is the Aufsichten page of moto schule (#8148).
const LinkSchoolSupervisions LinkTarget = "school_supervisions"

// SourceSupervisions is Aufsichten in moto schule (#8148): a cover on a block
// of the caller's own Aufsichten, taken over by the caller or for the caller.
const SourceSupervisions Source = "supervisions"

// SupervisionChanges is the Aufsichten port of moto schule (#8148). It
// names no colleague and no reason: only the caller is a person of an
// entry.
type SupervisionChanges interface {
	SupervisionChanges(ctx context.Context, day calendar.Date) ([]SourceEntry, error)
}

// SchoolDependencies are the ports of the school portal's overview (#7670,
// ADR 0299 addendum). A Lehrkraft sees the changes of her own classes and
// the school-wide ones; the children of a class stay in the class-day view
// (class-day-view), which the frontend already loads. Every port is
// required except Logger.
type SchoolDependencies struct {
	Today     func() calendar.Date
	Isolation Isolation
	// Closing is the closing days as the school-portal account may see them.
	Closing ClosingDays
	// Classes is the changed Unterrichtsschluss of the caller's classes.
	Classes ClassChanges
	// Supervisions is the covers on the caller's own Aufsichten (#8148).
	Supervisions SupervisionChanges
	// Appointments is today's exceptions of the caller's appointments, as
	// the calendar of moto schule shows them (#8155).
	Appointments AppointmentChanges
	Logger       *slog.Logger
}

// NewSchool builds the overview of moto schule. It is the same projection
// as New with the sources of the school portal: the same savepoints, status
// per source and sort order.
func NewSchool(deps SchoolDependencies) (Query, error) {
	if deps.Today == nil || deps.Isolation == nil || deps.Closing == nil || deps.Classes == nil || deps.Supervisions == nil || deps.Appointments == nil {
		return nil, ErrDependencies
	}
	logger := deps.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &view{
		today:     deps.Today,
		isolation: deps.Isolation,
		logger:    logger,
		sources: []sourceRead{
			{source: SourceClosingDays, read: deps.Closing.ClosingDays},
			{source: SourceClasses, read: deps.Classes.ClassChanges},
			{source: SourceSupervisions, read: deps.Supervisions.SupervisionChanges},
			{source: SourceAppointments, read: deps.Appointments.AppointmentChanges},
		},
	}, nil
}
