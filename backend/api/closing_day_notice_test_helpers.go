//go:build testhooks

package api

import (
	"context"

	owners "github.com/moto-ogs/project-phoenix/roots/owners"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
)

// NewSchoolCalendarWithClosingDayNotices composes the School Calendar the way
// the serving root does for its closing-day routes (#7144): a changed closing
// day reaches the school through notifications, without the account of the
// request. today (YYYY-MM-DD) pins the calendar day the relevance window
// counts from.
func NewSchoolCalendarWithClosingDayNotices(db transactionruntime.Database, settings federalStateResolver, notifications owners.DeliveryNotifications, today string) (schoolcalendar.Calendar, error) {
	return newSchoolCalendarWithAdministration(db, settings, func(context.Context) error { return nil }, nil, schoolCalendarCompose.AdministrationDependencies{
		Today: func() string { return today },
		ClosingDayNotices: owners.NewSchoolCalendarClosingDayNotices(notifications, func(ctx context.Context) int64 {
			return int64(sessiontoken.ClaimsFromCtx(ctx).ID)
		}),
	})
}
