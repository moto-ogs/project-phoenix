//go:build testhooks

package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/go-chi/chi/v5"

	dayChangesHTTP "github.com/moto-ogs/project-phoenix/modules/daychangesview/http"
	mealplanCompose "github.com/moto-ogs/project-phoenix/modules/mealplan/compose"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	timetableCompose "github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	timetableAPI "github.com/moto-ogs/project-phoenix/modules/timetable/http"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/realtime"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewDayChangesTestResource binds "Heute anders" (#7659) over the same
// owners as production, with the day pinned to today.
func NewDayChangesTestResource(db transactionruntime.Database, unit tenant.UnitOfWork, today calendar.Date) (*dayChangesHTTP.Resource, error) {
	caller, err := NewUserContextTestModule(db, unit)
	if err != nil {
		return nil, err
	}
	membership, err := owners.NewSchoolMembership(db)
	if err != nil {
		return nil, err
	}
	people, err := NewRFIDTestPeople(db)
	if err != nil {
		return nil, err
	}
	// The Kinder reads take the day as a filter; Care Plan's clock stamps
	// writes only. A shared clock adds no closure to its effect bindings.
	carePlan, err := NewClockedCarePlanForTests(db, time.Now)
	if err != nil {
		return nil, err
	}
	// The operational day of the active graph; its read takes the day.
	day, _ := NewActiveTestTimetable(db, unit)
	blocks, err := timetable.BlockDayChangesOf(day.TimetableOperations)
	if err != nil {
		return nil, err
	}
	blockStaff, err := timetable.BlockStaffChangesOf(day.TimetableOperations)
	if err != nil {
		return nil, err
	}
	calendarAppointments, err := NewAppointments(db)
	if err != nil {
		return nil, err
	}
	classArrivals, err := owners.BuildClassArrivals(db, slog.Default())
	if err != nil {
		return nil, err
	}
	view, err := NewDayChanges(DayChangesSources{
		Assignments: membership, ClassArrivals: classArrivals,
		Caller: caller, Workforce: owners.MustNewWorkforce(db),
		CarePlan: carePlan, Students: owners.MustNewPeopleDirectory(db), Blocks: blocks, BlockStaff: blockStaff,
		Names: newDayChangesStaffNames(people), Groups: owners.NewSchoolStructureSuiteRepositories(db).Group,
		// Without calendar periods every notice applies in every week; the
		// weekdays and the validity still decide.
		Notices: timetableCompose.NewStaffNotices(timetableCompose.StaffNoticeDependencies{
			DB: db.Pool(), Now: func() time.Time { return today.BerlinMidnight().Add(12 * time.Hour) },
		}),
		ClosingDays:  owners.NewSchoolClosingDayReads(),
		MealPlan:     mealplanCompose.NewMenuChanges(),
		Appointments: calendarAppointments,
		Today:        func() calendar.Date { return today }, Logger: slog.Default(),
	})
	if err != nil {
		return nil, err
	}
	return dayChangesHTTP.NewResource(view), nil
}

// NewDayChangesNoticeTestRouter serves Timetable's routes of the Hinweise
// der Leitung (#7667) under /api/staff-notices, the write path the overview
// reuses, with the day pinned. The change signal goes through a realtime hub
// with one staff connection of the school; signals drains what reached it:
// the sources of the staff_notices_changed events and whether any carried
// more than its source.
func NewDayChangesNoticeTestRouter(db transactionruntime.Database, tenantID int64, today calendar.Date) (router chi.Router, signals func() (sources []string, content bool)) {
	hub := realtime.NewHub(slog.Default())
	connection := &realtime.Client{Channel: make(chan realtime.Event, 64), SubscribedGroups: map[string]bool{}}
	hub.Register(connection, tenantID, nil)
	service := timetableCompose.NewStaffNotices(timetableCompose.StaffNoticeDependencies{
		DB: db.Pool(), Changes: owners.NewStaffNoticeAnnouncer(hub),
		Now: func() time.Time { return today.BerlinMidnight().Add(12 * time.Hour) },
	})
	resource := timetableAPI.NewStaffNoticeResource(service, func(ctx context.Context) int64 { return timeTrackingIdentity(ctx).AccountID }, func() calendar.Date { return today })
	router = chi.NewRouter()
	router.Use(RequestIdentityCacheMiddleware)
	router.Mount("/api/staff-notices", resource.Router(ProtectedTenantRoutes))
	return router, func() ([]string, bool) {
		sources, content := []string{}, false
		for {
			select {
			case event := <-connection.Channel:
				if event.Type != realtime.EventStaffNoticesChanged {
					continue
				}
				if event.Data.Source != nil {
					sources = append(sources, *event.Data.Source)
				}
				event.Data.Source = nil
				raw, err := json.Marshal(event.Data)
				content = content || err != nil || string(raw) != "{}"
			default:
				return sources, content
			}
		}
	}
}

// DayChangesClassDismissal writes a class-wide arrival exception of one
// day ("15:04") through Timetable, the fixture of the class source of
// "Heute anders" (#7681).
type DayChangesClassDismissal func(ctx context.Context, class string, day calendar.Date, hhmm, reason string) error

// NewDayChangesClassDismissalForTests binds the fixture to Timetable's class
// arrivals over db.
func NewDayChangesClassDismissalForTests(db transactionruntime.Database) (DayChangesClassDismissal, error) {
	arrivals, err := owners.BuildClassArrivals(db, slog.Default())
	if err != nil {
		return nil, err
	}
	return func(ctx context.Context, class string, day calendar.Date, hhmm, reason string) error {
		at, err := time.Parse("15:04", hhmm)
		if err != nil {
			return err
		}
		_, err = arrivals.UpsertClassArrivalException(ctx, timetable.ClassArrivalExceptionInput{
			SchoolClass: class, Date: day.String(), ArrivalTime: at, Reason: &reason,
		})
		return err
	}, nil
}
