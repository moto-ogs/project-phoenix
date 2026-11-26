//go:build testhooks

package api

import (
	"log/slog"
	"time"

	"github.com/go-chi/chi/v5"

	mealplanModule "github.com/moto-ogs/project-phoenix/modules/mealplan"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	portalCompose "github.com/moto-ogs/project-phoenix/workflows/parentportal/compose"
	parentHTTP "github.com/moto-ogs/project-phoenix/workflows/parentportal/http"
)

// NewChildDayChangesTestRouter serves the parents portal under /parent with
// "Heute anders" of a child (#7671) bound over the same owners as
// production, the day pinned to today and the clock to its noon.
func NewChildDayChangesTestRouter(db transactionruntime.Database, unit tenant.UnitOfWork, today calendar.Date) (chi.Router, error) {
	now := func() time.Time { return today.BerlinMidnight().Add(12 * time.Hour) }
	members := owners.MustNewMembershipTestRepositories(db)
	repos, err := NewParentRouteTestRepositories(db, members)
	if err != nil {
		return nil, err
	}
	// The child's reads take the day as a filter; Care Plan's clock stamps
	// writes only. A shared clock adds no closure to its effect bindings.
	carePlan, err := NewClockedCarePlanForTests(db, time.Now)
	if err != nil {
		return nil, err
	}
	day, _ := NewActiveTestTimetable(db, unit)
	blocks, err := timetable.ChildBlockDayChangesOf(day.TimetableOperations)
	if err != nil {
		return nil, err
	}
	classArrivals, err := owners.BuildClassArrivals(db, slog.Default())
	if err != nil {
		return nil, err
	}
	classDay, err := timetable.ClassArrivalDayOf(classArrivals)
	if err != nil {
		return nil, err
	}
	settings, err := owners.NewSettingsTestModule(db, unit)
	if err != nil {
		return nil, err
	}
	people := NewPeopleRepositorySuiteFactory(db)
	meals, err := owners.BuildMealPlanServicesAtForTests(db, settings.Settings, owners.NewStudentRootReads(people.Student), owners.MustNewPeopleDirectory(db), mealplanModule.MenuChangeNotices(nil), now)
	if err != nil {
		return nil, err
	}
	dayChanges, err := NewChildDayChanges(ChildDayChangesSources{
		CarePlan: carePlan, Students: owners.MustNewPeopleDirectory(db), ClosingDays: owners.NewSchoolClosingDayReads(), OpeningChanges: schoolCalendarCompose.NewOpeningChanges(),
		Blocks: blocks, ClassArrivals: classDay, Meals: meals.Cancellations, Today: func() calendar.Date { return today },
	})
	if err != nil {
		return nil, err
	}
	portal := portalCompose.New(portalCompose.Dependencies{
		GuardianChanges: owners.ParentGuardianChanges(), DeparturePolicy: owners.ParentDeparturePolicy(), GuardianPolicy: owners.NewParentGuardianPolicy(),
		Fingerprints: owners.SecurityFingerprints{}, Declarations: owners.ParentDeclarationPolicy(), Locales: owners.ParentPortalLocales(),
		Runtime: owners.ParentPortalRuntime{}, Logger: slog.Default(), Now: now,
		ChildRepo: repos.ParentChildReads(), CarePlanPolicy: owners.NewParentCarePlanPolicy(), DayChanges: dayChanges,
	})
	router := chi.NewRouter()
	router.Use(RequestSettingsCacheMiddleware, RequestIdentityCacheMiddleware)
	router.Mount("/parent", parentHTTP.NewResource(parentHTTP.ResourceConfig{Now: now, Parent: portal}).Router(ParentSessionChain))
	return router, nil
}
