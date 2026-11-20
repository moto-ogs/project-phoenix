package api

import (
	"context"
	"net/http"
	"time"

	apiCommon "github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/feedback"
	feedbackCompose "github.com/moto-ogs/project-phoenix/modules/feedback/compose"
	feedbackAPI "github.com/moto-ogs/project-phoenix/modules/feedback/http"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	presenceCompose "github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	studentpresenceHTTP "github.com/moto-ogs/project-phoenix/modules/studentpresence/http"
	timetableAPI "github.com/moto-ogs/project-phoenix/modules/timetable/http"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// demoOperatorRoutes are the seed writes only the public demo's server
// mounts on the operator routes: the past presence (ADR 0127), the past
// ratings and the seeded school vacations (ADR 0298). Outside APP_ENV=demo
// every field is nil and no route is mounted.
type demoOperatorRoutes struct {
	presenceHistory http.HandlerFunc
	feedbackHistory http.HandlerFunc
	schoolVacations http.HandlerFunc
}

// newDemoOperatorRoutes builds the demo's seed writes; outside APP_ENV=demo
// it builds none.
func newDemoOperatorRoutes(db transactionruntime.Database, appEnv string, plans studentpresence.DemoCareDays) (demoOperatorRoutes, error) {
	if !IsDemoEnvironment(appEnv) {
		return demoOperatorRoutes{}, nil
	}
	vacations, err := schoolCalendarCompose.NewSchoolVacations(nil, "", nil)
	if err != nil {
		return demoOperatorRoutes{}, err
	}
	history := feedbackCompose.NewFeedbackHistory(time.Now)
	return demoOperatorRoutes{
		presenceHistory: newDemoPresenceHistoryRoute(db, plans),
		feedbackHistory: feedbackAPI.DemoFeedbackHistoryHandler(func(ctx context.Context, schoolID int64, entries []feedback.CreateEntry) (int, error) {
			return history.RecordFeedbackHistory(tenant.WithTenantID(ctx, schoolID), entries)
		}, feedbackAPI.DemoRuntime{Success: apiCommon.Respond, Failure: renderFeedbackFailure, ParseIDParam: apiCommon.ParseIDParam}),
		schoolVacations: timetableAPI.DemoSchoolVacationsHandler(vacations),
	}, nil
}

// newDemoPresenceHistoryRoute binds the read of effective bookings and
// the write of past attendance for the public demo's operator (ADR 0127).
func newDemoPresenceHistoryRoute(db transactionruntime.Database, plans studentpresence.DemoCareDays) http.HandlerFunc {
	history := presenceCompose.NewPresenceHistory(presenceCompose.Dependencies{DB: db.Pool()})
	write := studentpresenceHTTP.DemoPresenceHistoryHandler(history)
	read := studentpresenceHTTP.DemoCareDaysHandler(func(ctx context.Context, schoolID int64, from, to calendar.Date) ([]studentpresence.DemoCareDay, error) {
		id, err := tenant.NewTenantID(schoolID)
		if err != nil {
			return nil, err
		}
		var days []studentpresence.DemoCareDay
		err = tenant.WithinTenant(ctx, id, func(txCtx context.Context) error {
			var err error
			days, err = plans.DemoCareDays(txCtx, from, to)
			return err
		})
		return days, err
	})
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			read(w, r)
			return
		}
		write(w, r)
	}
}
