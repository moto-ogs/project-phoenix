//go:build testhooks

package api

import (
	"log/slog"

	dayChangesHTTP "github.com/moto-ogs/project-phoenix/modules/daychangesview/http"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewSchoolDayChangesTestResource binds "Heute anders" of moto schule
// (#7670) over the same owners as production, with the day pinned.
func NewSchoolDayChangesTestResource(db transactionruntime.Database, unit tenant.UnitOfWork, today calendar.Date) (*dayChangesHTTP.SchoolResource, error) {
	caller, err := NewUserContextTestModule(db, unit)
	if err != nil {
		return nil, err
	}
	classArrivals, err := owners.BuildClassArrivals(db, slog.Default())
	if err != nil {
		return nil, err
	}
	return NewSchoolDayChanges(SchoolDayChangesSources{
		Caller: caller, ClassArrivals: classArrivals, ClosingDays: owners.NewSchoolClosingDayReads(),
		Today: func() calendar.Date { return today }, Logger: slog.Default(),
	})
}
