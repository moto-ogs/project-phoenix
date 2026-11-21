//go:build testhooks

package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/go-chi/chi/v5"

	mealplanModule "github.com/moto-ogs/project-phoenix/modules/mealplan"
	settingsModule "github.com/moto-ogs/project-phoenix/modules/settings"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/realtime"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// DayChangesMealPlanTestRig serves Meal Plan's staff routes under
// /api/meal-plan (#7666), the write path whose change mark the overview
// reads, with the Meal Plan's clock on the morning of today. Enable switches
// the meal plan on for the school in ctx. Signals drains the
// meal_plan_changed events a staff connection of each registered school
// received, and whether any carried content.
type DayChangesMealPlanTestRig struct {
	Router  chi.Router
	Enable  func(ctx context.Context) error
	Listen  func(tenantID int64)
	Signals func() (count int, content bool)
}

// NewDayChangesMealPlanTestRig builds the rig over the production Meal Plan
// composition and the production signal of its routes.
func NewDayChangesMealPlanTestRig(db transactionruntime.Database, unit tenant.UnitOfWork, today calendar.Date) (DayChangesMealPlanTestRig, error) {
	settings, err := owners.NewSettingsTestModule(db, unit)
	if err != nil {
		return DayChangesMealPlanTestRig{}, err
	}
	people := NewPeopleRepositorySuiteFactory(db)
	now := func() time.Time { return today.BerlinMidnight().Add(8 * time.Hour) }
	meals, err := owners.BuildMealPlanAtForTests(db, settings.Settings, owners.NewStudentRootReads(people.Student), owners.MustNewPeopleDirectory(db), mealplanModule.MenuChangeNotices(nil), now)
	if err != nil {
		return DayChangesMealPlanTestRig{}, err
	}
	hub := realtime.NewHub(slog.Default())
	connection := &realtime.Client{Channel: make(chan realtime.Event, 64), SubscribedGroups: map[string]bool{}}
	router := chi.NewRouter()
	router.Use(RequestIdentityCacheMiddleware)
	router.Mount("/api/meal-plan", newMealPlanResource(meals, newMealPlanExportRenderer(), mealPlanChangeSignal(hub, slog.Default())).Router())
	return DayChangesMealPlanTestRig{
		Router: router,
		Enable: func(ctx context.Context) error {
			return settings.Settings.SetValue(ctx, settingsModule.KeyMealPlanEnabled, true, nil, nil)
		},
		Listen: func(tenantID int64) { hub.Register(connection, tenantID, nil) },
		Signals: func() (int, bool) {
			count, content := 0, false
			for {
				select {
				case event := <-connection.Channel:
					if event.Type != realtime.EventMealPlanChanged {
						continue
					}
					count++
					raw, err := json.Marshal(event.Data)
					content = content || err != nil || string(raw) != "{}"
				default:
					return count, content
				}
			}
		},
	}, nil
}
