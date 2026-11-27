package classdayhttp

import (
	"errors"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
)

func (rs *Resource) getAssignedClasses(w http.ResponseWriter, r *http.Request) {
	date, ok := rs.dateQueryOrToday(w, r)
	if !ok {
		return
	}
	if rs.AssignedClasses == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errors.New("assigned classes overview is not configured")))
		return
	}
	report, err := rs.AssignedClasses.AssignedClassesReport(r.Context(), date)
	if err != nil {
		rs.logger.Error("class day: assigned classes overview failed",
			"date", date.String(),
			"error", err.Error(),
		)
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	common.Respond(w, r, http.StatusOK, report, "Assigned classes retrieved successfully")
}
