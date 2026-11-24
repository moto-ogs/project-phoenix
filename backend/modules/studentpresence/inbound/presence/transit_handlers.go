package presence

import (
	"errors"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

type assignTransitStudentsRequest struct {
	StudentIDs    []ident.ID `json:"student_ids"`
	ActiveGroupID ident.ID   `json:"active_group_id"`
}

func (rs *Resource) assignTransitStudents(w http.ResponseWriter, r *http.Request) {
	var req assignTransitStudentsRequest
	if err := wire.Decode(r.Body, &req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid request body")))
		return
	}
	if len(req.StudentIDs) == 0 || req.ActiveGroupID <= 0 {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("student_ids and active_group_id are required")))
		return
	}

	auth, ok := rs.BulkStudentMoveAuthorization(w, r)
	if !ok {
		return
	}

	result, err := rs.Operations.AssignTransitStudents(r.Context(), ident.Int64s(req.StudentIDs), req.ActiveGroupID.Int64(), *auth)
	if err != nil {
		rs.runtime.MarkRollback(r.Context())
		common.RenderError(w, r, ErrorRenderer(err))
		return
	}

	common.Respond(w, r, http.StatusOK, result, "Transit students assigned successfully")
}
