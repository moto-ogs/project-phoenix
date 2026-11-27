//go:build testhooks

package api

import (
	"context"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// CreateOpeningChangeFixture enters a changed opening day closing at
// closesAt for the school of the tenant transaction in ctx (#8157), through
// the School Calendar's own write.
func CreateOpeningChangeFixture(ctx context.Context, day calendar.Date, closesAt string) error {
	_, err := schoolCalendarCompose.NewOpeningChanges().CreateOpeningChange(ctx, schoolcalendar.OpeningChangeInput{
		StartDate: day, EndDate: day, OpensAt: "07:30", ClosesAt: closesAt, Reason: "Zeugnisausgabe",
	})
	return err
}

// OpeningChangeClosingTimes is the School Calendar read the production roots
// bind as the closing time of a changed opening day (#8157).
func OpeningChangeClosingTimes() func(context.Context, calendar.Date) (string, bool, error) {
	return schoolCalendarCompose.NewOpeningChanges().ClosingTimeOn
}

// TraegerOpeningChangeRouter is the router the serving root mounts at
// /traeger/opening-changes (#8202), over the Träger's schools.
func TraegerOpeningChangeRouter(schools traegercalendar.Schools) chi.Router {
	return newTraegerOpeningChangeRouter(schools, nil)
}
