//go:build testhooks

package owners

import (
	"time"

	mealplanModule "github.com/moto-ogs/project-phoenix/modules/mealplan"
	mealplanCompose "github.com/moto-ogs/project-phoenix/modules/mealplan/compose"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	settingsCompose "github.com/moto-ogs/project-phoenix/modules/settings/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
)

// BuildMealPlanAtForTests composes the Meal Plan like BuildServeMealPlan, over
// the school's settings and calendar, on the clock now: ordering deadlines and
// the relevance window of a menu change do not depend on when the test runs.
func BuildMealPlanAtForTests(db transactionruntime.Database, settings settingsCompose.BatchSettingsService, students StudentRootReads, names peopledirectory.Capability, notices mealplanModule.MenuChangeNotices, now func() time.Time) (mealplanModule.Capability, error) {
	plan, err := BuildMealPlanServicesAtForTests(db, settings, students, names, notices, now)
	return plan.Capability, err
}

// BuildMealPlanServicesAtForTests is BuildMealPlanAtForTests with every part
// of the Meal Plan, the days without lunch (#7656) too.
func BuildMealPlanServicesAtForTests(db transactionruntime.Database, settings settingsCompose.BatchSettingsService, students StudentRootReads, names peopledirectory.Capability, notices mealplanModule.MenuChangeNotices, now func() time.Time) (mealplanModule.Services, error) {
	mealSettings, err := BuildMealPlanSettings(settings)
	if err != nil {
		return mealplanModule.Services{}, err
	}
	calendarRecords, err := BuildSchoolCalendarRecords(db, func(schoolCalendarCompose.Observation) {}, settings, now)
	if err != nil {
		return mealplanModule.Services{}, err
	}
	lockStudent, err := mealPlanStudentLock(names)
	if err != nil {
		return mealplanModule.Services{}, err
	}
	return mealplanCompose.New(mealplanCompose.Dependencies{
		DB: db.Pool(), Settings: mealSettings, Observe: func(mealplanCompose.Observation) {}, Now: now,
		Participants:    mealPlanParticipantFinder(students, now),
		ParticipantDays: mealPlanParticipantDaysFinder(names, now),
		StudentNames:    mealPlanStudentNames(names),
		LockStudent:     lockStudent,
		Calendar:        mealPlanCalendar(calendarRecords),
		Notices:         notices,
	})
}
