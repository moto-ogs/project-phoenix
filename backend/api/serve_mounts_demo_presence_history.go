package api

import (
	"context"
	"net/http"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	presenceCompose "github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	studentpresenceHTTP "github.com/moto-ogs/project-phoenix/modules/studentpresence/http"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// newDemoPresenceHistoryRoute binds the read of effective bookings and
// the write of past attendance for the public demo's operator (ADR 0127).
// Outside APP_ENV=demo the route is absent.
func newDemoPresenceHistoryRoute(db transactionruntime.Database, appEnv string, plans studentpresence.DemoCareDays) http.HandlerFunc {
	if !IsDemoEnvironment(appEnv) {
		return nil
	}
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
