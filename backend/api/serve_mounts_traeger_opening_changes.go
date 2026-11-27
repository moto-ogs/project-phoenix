package api

import (
	"context"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	schoolCalendarHTTP "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/http"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
)

// mountTraegerOpeningChangeRoutes serves the opening changes of a Träger
// (#8202) at /traeger/opening-changes: reading behind "Übersicht sehen",
// planning behind "Einstellungen verwalten", like the Träger's closing days.
// A write tells each named school through Delivery's notification feed
// (#8231); today names the push window's day (YYYY-MM-DD).
func mountTraegerOpeningChangeRoutes(root chi.Router, schools traegercalendar.Schools, staffing schoolCalendarHTTP.StaffingChangeQueue,
	notifications owners.DeliveryNotifications, today func() string,
) {
	root.Mount("/traeger/opening-changes", newTraegerOpeningChangeRouter(schools, staffing, notifications, today))
}

func newTraegerOpeningChangeRouter(schools traegercalendar.Schools, staffing schoolCalendarHTTP.StaffingChangeQueue,
	notifications owners.DeliveryNotifications, today func() string,
) chi.Router {
	resource := schoolCalendarHTTP.NewTraegerOpeningChangeResource(NewTraegerOpeningChangesWithNotices(schools, notifications, today),
		common.RequiresPermission(identityaccess.TraegerRightOverviewRead), common.RequiresPermission(identityaccess.TraegerRightSettingsManage), staffing)
	return resource.TraegerRouter(ProtectedTraegerRoutes)
}

// NewTraegerOpeningChangesWithNotices composes the Träger's opening changes
// the way the serving root mounts them (#8231); without Delivery's
// notifications they tell nobody.
func NewTraegerOpeningChangesWithNotices(schools traegercalendar.Schools, notifications owners.DeliveryNotifications, today func() string) traegercalendar.OpeningChanges {
	notices := owners.NewTraegerOpeningChangeNotices(notifications, func(ctx context.Context) int64 {
		return int64(sessiontoken.ClaimsFromCtx(ctx).ID)
	})
	if notices == nil {
		return schoolCalendarCompose.NewTraegerOpeningChanges(schools)
	}
	return schoolCalendarCompose.NewNoticedTraegerOpeningChanges(schools, notices, today)
}
