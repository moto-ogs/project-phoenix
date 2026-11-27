package owners

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewTraegerOpeningChangeNotices binds School Calendar's notice about an
// opening change of the Träger (#8231) to Delivery: each named school gets
// the notice of a change it entered itself (#8178), written in a school
// transaction of that school, so its staff, its families and the members of
// its Träger read it under the school's own switch. The Träger request holds
// no school; the unit opens on its own, as the holiday closures do, and
// commits before the Träger transaction. A failed notice rolls the Träger's
// write back. actor names the account of the request, which is left out.
// Without Delivery's notifications it is nil, and School Calendar tells
// nobody.
func NewTraegerOpeningChangeNotices(notifications DeliveryNotifications, actor func(context.Context) int64) traegercalendar.OpeningChangeNotices {
	school := NewSchoolCalendarOpeningChangeNotices(notifications, actor)
	if school == nil {
		return nil
	}
	return traegerOpeningChangeNotices{school: school}
}

type traegerOpeningChangeNotices struct {
	school schoolcalendar.OpeningChangeNotices
}

func (n traegerOpeningChangeNotices) NotifySchool(ctx context.Context, schoolID int64, notice schoolcalendar.OpeningChangeNotice) error {
	id, err := tenant.NewTenantID(schoolID)
	if err == nil {
		err = tenant.WithinTenant(tenant.ContextWithoutTransaction(ctx), id, func(ctx context.Context) error {
			return n.school.NotifyOpeningChangeChanged(ctx, notice)
		})
	}
	if err != nil {
		tenant.MarkRollback(ctx)
	}
	return err
}
