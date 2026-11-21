//go:build testhooks

package api

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// CreateDayChangesTestClosingDay saves a closing day of the school in ctx
// through School Calendar's write, as the timetable route does, on the
// pinned day today ("Heute anders", #7664). ctx carries the school's
// transaction.
func CreateDayChangesTestClosingDay(ctx context.Context, db transactionruntime.Database, unit tenant.UnitOfWork, today, start, end calendar.Date, reason string) error {
	settings, err := owners.NewSettingsTestModule(db, unit)
	if err != nil {
		return err
	}
	days, err := NewSchoolCalendarWithClosingDayNotices(db, settings.Settings, owners.DeliveryNotifications{}, today.String())
	if err != nil {
		return err
	}
	_, err = days.CreateClosingDay(ctx, schoolcalendar.CreateClosingDay{ClosingDayFields: schoolcalendar.ClosingDayFields{
		StartDate: start.String(), EndDate: end.String(), Reason: reason,
	}})
	return err
}
