package api

// "Heute anders" in moto schule (#7670, ADR 0299 addendum). A Lehrkraft sees
// what is different today for her own classes and for the whole school:
// a changed Unterrichtsschluss of her classes (Timetable's class-wide
// arrival exceptions) and the closing days (School Calendar). The children
// of her classes stay in the class-day view: the start page already loads
// its class summaries, and the overview reads nothing of them twice.
//
// The rules of the school portal stand on their own; they do not come from
// the staff portal's: the route needs class_day:read, a class counts only
// when it is one of the caller's (education.class_teachers) or the caller
// reaches every class (class_day:all_classes), and the closing days need
// calendar:school, the right of the school calendar that shows them. No
// reason and no person leaves this file.

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	dayChangesHTTP "github.com/moto-ogs/project-phoenix/modules/daychangesview/http"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// schoolDayChangesCaller is Identity & Access's read of the caller's person;
// the request memoizes it.
type schoolDayChangesCaller interface {
	Person(ctx context.Context) (identityaccess.CallerPerson, error)
}

// SchoolDayChangesSources are the owner reads of the school portal's
// overview; all required except Logger. Staff is School Membership's read of
// the caller's staff record and classes in one statement (#8155): it saves
// the statement the appointments of the Lehrkraft need.
type SchoolDayChangesSources struct {
	Caller        schoolDayChangesCaller
	Staff         schoolmembership.StaffClassReads
	ClassArrivals timetable.ClassArrivalQuery
	ClosingDays   dayChangesClosingDayReads
	Appointments  dayChangesAppointmentReads
	Today         func() calendar.Date
	Logger        *slog.Logger
}

// NewSchoolDayChanges binds the sources to the projection's ports.
func NewSchoolDayChanges(sources SchoolDayChangesSources) (*dayChangesHTTP.SchoolResource, error) {
	if sources.Caller == nil || sources.Staff == nil || sources.ClassArrivals == nil || sources.ClosingDays == nil || sources.Appointments == nil {
		return nil, fmt.Errorf("%w: school sources", daychangesview.ErrDependencies)
	}
	schoolDay, err := timetable.SchoolDayChangesOf(sources.ClassArrivals)
	if err != nil {
		return nil, err
	}
	day := schoolDayChangesRead{caller: schoolDayCallerRead{person: sources.Caller, staff: sources.Staff}, query: schoolDay}
	view, err := daychangesview.NewSchool(daychangesview.SchoolDependencies{
		Today:        sources.Today,
		Isolation:    schoolDayChangesSavepoints{},
		Closing:      schoolDayChangesClosingDays{reads: sources.ClosingDays},
		Classes:      schoolDayChangesClasses{day: day},
		Supervisions: schoolDayChangesSupervisions{day: day},
		Appointments: schoolDayChangesAppointments{caller: day.caller, reads: sources.Appointments},
		Logger:       sources.Logger,
	})
	if err != nil {
		return nil, err
	}
	return dayChangesHTTP.NewSchoolResource(view, permissions.ClassDayRead), nil
}

// schoolDayChangesClasses is the changed Unterrichtsschluss of the caller's
// classes. A caller reaching every class (Schulverwaltung) sees every class
// under "Schule"; a Lehrkraft only her own, under "Betrifft dich".
type schoolDayChangesClasses struct {
	day schoolDayChangesRead
}

func (s schoolDayChangesClasses) ClassChanges(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	changes, caller, err := s.day.read(ctx, day)
	if err != nil {
		return nil, err
	}
	rows := changes.Classes
	if len(rows) == 0 {
		return nil, nil
	}
	everyClass := securityruntime.HasPermission(permissions.ClassDayAllClasses, sessiontoken.PermissionsFromCtx(ctx))
	mine := map[string]bool{}
	for _, class := range caller.classes {
		mine[classKey(class)] = true
	}
	entries := []daychangesview.SourceEntry{}
	for _, row := range rows {
		// A caller reaching every class sees them under "Schule", her own
		// assignments too (#7670).
		own := !everyClass && mine[classKey(row.SchoolClass)]
		if !own && !everyClass {
			continue
		}
		// The TIME column holds the wall clock itself; no zone applies.
		at := calendar.NormalizeWallClock(row.ArrivalTime).Format("15:04")
		entries = append(entries, daychangesview.SourceEntry{
			Kind: daychangesview.KindClassDismissalChanged, Involved: own,
			Class: &daychangesview.DayClass{Name: strings.TrimSpace(row.SchoolClass), Time: &at},
			Link:  &daychangesview.Link{Target: daychangesview.LinkSchoolClass},
		})
	}
	return entries, nil
}

// schoolDayChangesClosingDays is the closing days of moto schule.
type schoolDayChangesClosingDays struct{ reads dayChangesClosingDayReads }

func (s schoolDayChangesClosingDays) ClosingDays(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	granted := sessiontoken.PermissionsFromCtx(ctx)
	if !securityruntime.HasAdminWildcard(granted) && !securityruntime.HasPermission(permissions.CalendarSchool, granted) {
		// The account does not read the school calendar: no entries, not a failure.
		return nil, nil
	}
	days, err := s.reads.ListClosingDays(ctx, schoolcalendar.ClosingDayFilter{OverlappingFrom: day.String(), OverlappingTo: day.String()})
	if err != nil {
		return nil, fmt.Errorf("list closing days: %w", err)
	}
	entries := make([]daychangesview.SourceEntry, 0, len(days))
	for _, closing := range days {
		since, until := closingDaySpan(closing, day)
		entries = append(entries, daychangesview.SourceEntry{
			Kind: daychangesview.KindClosingDay, Since: since, Until: until,
			Link:    &daychangesview.Link{Target: daychangesview.LinkSchoolCalendar},
			Closing: &daychangesview.DayClosing{Name: closing.Reason, Traeger: closing.Traeger},
		})
	}
	return entries, nil
}
