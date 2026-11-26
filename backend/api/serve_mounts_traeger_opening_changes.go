package api

import (
	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	schoolCalendarHTTP "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/http"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
)

// mountTraegerOpeningChangeRoutes serves the opening changes of a Träger
// (#8202) at /traeger/opening-changes: reading behind "Übersicht sehen",
// planning behind "Einstellungen verwalten", like the Träger's closing days.
func mountTraegerOpeningChangeRoutes(root chi.Router, schools traegercalendar.Schools) {
	root.Mount("/traeger/opening-changes", newTraegerOpeningChangeRouter(schools))
}

func newTraegerOpeningChangeRouter(schools traegercalendar.Schools) chi.Router {
	resource := schoolCalendarHTTP.NewTraegerOpeningChangeResource(schoolCalendarCompose.NewTraegerOpeningChanges(schools),
		common.RequiresPermission(identityaccess.TraegerRightOverviewRead), common.RequiresPermission(identityaccess.TraegerRightSettingsManage))
	return resource.TraegerRouter(ProtectedTraegerRoutes)
}
