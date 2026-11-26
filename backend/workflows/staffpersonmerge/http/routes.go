// Package http serves operator-only duplicate repair routes.
package http

import (
	"context"
	"net"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
	"github.com/moto-ogs/project-phoenix/workflows/staffpersonmerge"
)

type Capability interface {
	Preview(rctx context.Context, schoolID int64, clientIP net.IP) ([]staffpersonmerge.StaffPersonMergeCandidate, error)
	Execute(rctx context.Context, schoolID int64, request staffpersonmerge.Request) error
}

type resource struct{ workflow Capability }

func Router(workflow Capability, bindScope func(http.Handler) http.Handler) http.Handler {
	if workflow == nil || bindScope == nil {
		panic("staff person merge HTTP: workflow and scope binding required")
	}
	rs := resource{workflow: workflow}
	r := chi.NewRouter()
	r.Use(bindScope, common.TenantTxMiddleware)
	r.Get("/{schoolId}", rs.preview)
	r.Post("/{schoolId}", rs.execute)
	return r
}
func (rs resource) preview(w http.ResponseWriter, r *http.Request) {
	load := func(ctx context.Context, schoolID int64) ([]staffpersonmerge.StaffPersonMergeCandidate, error) {
		return rs.workflow.Preview(ctx, schoolID, common.ParseClientIP(r))
	}
	common.IDFetch("schoolId", "invalid school ID", load, errorRenderer, "staff person merge candidates")(w, r)
}

func (rs resource) execute(w http.ResponseWriter, r *http.Request) {
	schoolID, err := common.ParseIDParam(r, "schoolId")
	if err != nil {
		common.RenderError(w, r, common.OperatorInvalidRequest(err))
		return
	}
	var input staffpersonmerge.Request
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := wire.DecodeAndDrain(r.Body, &input); err != nil {
		common.RenderError(w, r, common.OperatorInvalidRequest(err))
		return
	}
	if err := rs.workflow.Execute(r.Context(), schoolID, input); err != nil {
		respondError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, nil, "staff persons merged")
}

var errorRenderer = common.RulesRenderer([]common.ErrorRule{
	{Target: staffpersonmerge.ErrAuditUnavailable, Render: func(error) render.Renderer {
		return common.OperatorRejection(http.StatusServiceUnavailable, common.CodeOperatorAuditUnavailable, "Operator audit unavailable")
	}},
	{Target: staffpersonmerge.ErrInvalid, Render: common.OperatorInvalidRequest},
	{Target: staffpersonmerge.ErrUnauthorized, Render: common.ErrorForbidden},
	{Target: staffpersonmerge.ErrConflict, Render: common.ErrorConflict},
}, common.ErrorInternalServer)

func respondError(w http.ResponseWriter, r *http.Request, err error) {
	common.RenderError(w, r, errorRenderer(err))
}

// RouteContracts registers the duplicate repair (ADR 0270, #2352), relative
// to the /operator/staff-person-merges mount.
func RouteContracts() []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/{schoolId}", Portals: operator, Response: []staffpersonmerge.StaffPersonMergeCandidate{}},
		{Method: "POST", Pattern: "/{schoolId}", Portals: operator, Request: staffpersonmerge.Request{}, NoData: true},
	}
}
