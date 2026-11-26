package api

import (
	"context"
	"log/slog"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	enrollmentOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	schoolCalendarHTTP "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/http"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	timetableHTTP "github.com/moto-ogs/project-phoenix/modules/timetable/http"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	holidayClosureHTTP "github.com/moto-ogs/project-phoenix/workflows/holidayclosurenotification/http"
)

// mountTraegerClosingDayRoutes serves the closing days of a Träger (#4702) at
// /traeger/closing-days: reading behind "Übersicht sehen", planning behind
// "Einstellungen verwalten". A saved closing day tells the parents of the
// holiday bookings it affects (#6434); /traeger/holiday-closures previews
// them and lists the closed days nobody told yet, behind the planning right.
// It returns the Träger's closing days it mounted.
func mountTraegerClosingDayRoutes(root chi.Router, schools traegercalendar.Schools, organizations HolidayOrganizations,
	mail owners.HolidayClosureMail, holidayCalendar enrollmentOwner.HolidaySchoolCalendar, holidays owners.HolidayClosureHolidays, staffing schoolCalendarHTTP.StaffingChangeQueue, now func() time.Time,
) traegercalendar.ClosingDays {
	closures := newHolidayClosures(organizations, mail, holidayCalendar, holidays, now)
	requireManage := common.RequiresPermission(identityaccess.TraegerRightSettingsManage)
	closingDays := schoolCalendarCompose.NewTraegerClosingDays(schools, owners.NewTraegerClosingDayHolidayNotices(closures))
	resource := schoolCalendarHTTP.NewTraegerClosingDayResource(closingDays, traegerListRenderer(NewSimpleListRenderer()),
		common.RequiresPermission(identityaccess.TraegerRightOverviewRead), requireManage, staffing)
	root.Mount("/traeger/closing-days", resource.TraegerRouter(ProtectedTraegerRoutes))
	root.Mount("/traeger/holiday-closures", enrollmentAPI.NewHolidayClosureResource(closures, requireManage).TraegerRouter(ProtectedTraegerRoutes))
	// The same closing days read the closings of the schools for "Heute
	// anders" (#7672).
	return closingDays
}

// newTraegerClosingDayStaffingQueue binds the Träger closing-day routes to
// the same after-commit staffing signal queue as the school timetable routes.
func newTraegerClosingDayStaffingQueue(staffing timetableHTTP.StaffingAnnouncer, logger *slog.Logger) schoolCalendarHTTP.StaffingChangeQueue {
	return func(ctx context.Context, tenantID int64, source string) {
		timetableHTTP.QueueStaffingChangeAfterCommit(ctx, tenantID, source, staffing, logger)
	}
}

// newHolidayClosures builds Enrollment's closing day notices over the
// Träger directory, the outbox and the host schools' calendar on the root's
// clock now.
func newHolidayClosures(organizations HolidayOrganizations, mail owners.HolidayClosureMail, holidayCalendar enrollmentOwner.HolidaySchoolCalendar,
	holidays owners.HolidayClosureHolidays, now func() time.Time,
) enrollmentOwner.HolidayClosures {
	return owners.NewHolidayClosures(holidayCalendar, holidays, newHolidayOfficeTraeger(organizations), mail, now)
}

// mountHolidayClosureNotificationRoutes serves the notices after a school
// closing day changed (#6442, #6457, ADR 0196): the school's proposals and
// click at /api/holiday-closure-notices behind the rights that change
// closing days, and the Träger-Büro's list "Eltern noch nicht informiert"
// at /traeger/holiday-closures/pending behind "Einstellungen verwalten".
func mountHolidayClosureNotificationRoutes(root, tenant chi.Router, organizations HolidayOrganizations,
	mail owners.HolidayClosureMail, holidayCalendar enrollmentOwner.HolidaySchoolCalendar, holidays owners.HolidayClosureHolidays, logger *slog.Logger, now func() time.Time,
) {
	notices := owners.NewHolidayClosureNotifications(newHolidayClosures(organizations, mail, holidayCalendar, holidays, now), organizations, mail,
		logger.With("workflow", "holiday-closure-notification"), calendar.CalendarDateClock(now))
	resource := holidayClosureHTTP.NewResource(notices, common.RequiresPermission(permissions.SchedulesUpdate),
		common.RequiresPermission(permissions.SchedulesUpdate), common.RequiresPermission(identityaccess.TraegerRightSettingsManage))
	tenant.Mount("/holiday-closure-notices", resource.SchoolRouter(ProtectedTenantRoutes))
	root.Mount("/traeger/holiday-closures/pending", resource.TraegerRouter(ProtectedTraegerRoutes))
}

// newHolidayOfficeTraeger names the Träger and its host schools in a mail
// the Träger-Büro triggers: the notice of a closing day (#6434) and the mail
// that a booking moved up the waiting list after a cancellation, a rebooking
// or a higher capacity (#4699, #6437).
func newHolidayOfficeTraeger(organizations HolidayOrganizations) enrollmentOwner.HolidayTraegerDirectory {
	return owners.NewHolidayOfficeTraeger(organizations)
}
