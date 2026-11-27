package api

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	schoolCalendarHTTP "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/http"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// mountTraegerOpeningChangeRoutes serves the opening changes of a Träger
// (#8202) at /traeger/opening-changes: reading behind "Übersicht sehen",
// planning behind "Einstellungen verwalten", like the Träger's closing days.
// A write tells each named school through Delivery's notification feed
// (#8231); today names the push window's day (YYYY-MM-DD).
func mountTraegerOpeningChangeRoutes(root chi.Router, schools traegercalendar.Schools, staffing schoolCalendarHTTP.StaffingChangeQueue,
	notifications owners.DeliveryNotifications, logger *slog.Logger, today func() string,
) {
	root.Mount("/traeger/opening-changes", newTraegerOpeningChangeRouter(schools, staffing, notifications, logger, today))
}

func newTraegerOpeningChangeRouter(schools traegercalendar.Schools, staffing schoolCalendarHTTP.StaffingChangeQueue,
	notifications owners.DeliveryNotifications, logger *slog.Logger, today func() string,
) chi.Router {
	resource := schoolCalendarHTTP.NewTraegerOpeningChangeResource(NewTraegerOpeningChangesWithNotices(schools, notifications, logger, today),
		common.RequiresPermission(identityaccess.TraegerRightOverviewRead), common.RequiresPermission(identityaccess.TraegerRightSettingsManage), staffing)
	return resource.TraegerRouter(TraegerOpeningChangeRoutes)
}

// TraegerOpeningChangeRoutes registers the Träger route group of the opening
// changes: ProtectedTraegerRoutes with the Träger transaction of
// TraegerTxWithOpeningChangeRetractions (#8231).
func TraegerOpeningChangeRoutes(r chi.Router, fn func(chi.Router, common.Middleware)) {
	ProtectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		fn(r, TraegerTxWithOpeningChangeRetractions)
	})
}

// TraegerTxWithOpeningChangeRetractions is common.TraegerTxMiddleware for a
// request that tells schools of a Träger opening change: the request enters
// the Träger transaction prepared for the retractions of its school notices,
// and once the transaction has ended without a commit, each school whose
// notice committed is told the retraction.
func TraegerTxWithOpeningChangeRetractions(next http.Handler) http.Handler {
	inTx := common.TraegerTxMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
		tenant.MarkUnitOfWorkHandlerReturned(r.Context())
	}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, settle := tenant.WithUnitOfWorkOutcomeCallbacks(r.Context())
		defer settle(context.WithoutCancel(ctx))
		inTx.ServeHTTP(w, r.WithContext(ctx))
	})
}

// NewTraegerOpeningChangesWithNotices composes the Träger's opening changes
// the way the serving root mounts them (#8231); without Delivery's
// notifications they tell nobody.
func NewTraegerOpeningChangesWithNotices(schools traegercalendar.Schools, notifications owners.DeliveryNotifications, logger *slog.Logger, today func() string) traegercalendar.OpeningChanges {
	notices := owners.NewTraegerOpeningChangeNotices(notifications, func(ctx context.Context) int64 {
		return int64(sessiontoken.ClaimsFromCtx(ctx).ID)
	}, logger)
	return schoolCalendarCompose.NewTraegerOpeningChanges(schools, notices, today)
}
