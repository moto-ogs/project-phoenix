package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	absencetypesHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/absencetypes"
)

// newAbsenceTypesResource wires /api/absence-types over the absence-type
// administration capability. resolveActor identifies the staff member behind
// an allowance change.
func newAbsenceTypesResource(types workforce.AbsenceTypeAdministration, resolveActor func(context.Context) (int64, error)) *absencetypesHTTP.Resource {
	if types == nil || resolveActor == nil {
		panic("absence-types HTTP composition: all dependencies are required")
	}
	return absencetypesHTTP.NewResource(types, absenceTypesRuntime(resolveActor))
}

func absenceTypesRuntime(resolveActor func(context.Context) (int64, error)) absencetypesHTTP.Runtime {
	return absencetypesHTTP.Runtime{
		Protected: func(router chi.Router, routes func(chi.Router, absencetypesHTTP.Middleware)) {
			ProtectedTenantRoutes(router, routes)
		},
		Permission:         common.RequiresPermission,
		AnyPermission:      common.RequiresAnyPermission,
		ParseID:            common.ParseID,
		ParseIDParam:       common.ParseIDParam,
		Success:            common.Respond,
		Failure:            renderAbsenceTypesFailure,
		ResolveActor:       absenceTypesActor(resolveActor),
		TimeTrackingOwn:    permissions.TimeTrackingOwn,
		TimeTrackingManage: permissions.TimeTrackingManage,
		VacationApprove:    permissions.VacationApprove,
	}
}

// absenceTypesActor keeps an allowance change staff-only: it records its
// staff member in changed_by. A valid session without a staff record, also
// one opened through the Träger-Portal, is refused with its code; a failed
// lookup stays the server's error (#7818).
func absenceTypesActor(resolveActor func(context.Context) (int64, error)) func(context.Context) (int64, error) {
	return func(ctx context.Context) (int64, error) {
		staffID, err := resolveActor(ctx)
		if callerHasNoStaffRecord(err) {
			return 0, absencetypesHTTP.ErrNoStaffActor
		}
		return staffID, err
	}
}

// renderAbsenceTypesFailure renders the failure with the shared envelope; the
// error's own wording is the message, as it was before the cutover.
func renderAbsenceTypesFailure(w http.ResponseWriter, r *http.Request, kind absencetypesHTTP.FailureKind, err error) {
	// What the Träger keeps of its types (#4710) has its own code, so the
	// school reads why it cannot change it.
	if errors.Is(err, workforce.ErrAbsenceTypeKeptByTraeger) {
		common.RenderError(w, r, common.ErrorConflictWithCode(err, common.CodeWorkforceAbsenceTypeKeptByTraeger))
		return
	}
	switch kind {
	case absencetypesHTTP.FailureInvalid:
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
	case absencetypesHTTP.FailureNotFound:
		common.RenderError(w, r, common.ErrorNotFound(err))
	case absencetypesHTTP.FailureConflict:
		common.RenderError(w, r, common.ErrorConflict(err))
	case absencetypesHTTP.FailureForbidden:
		common.RenderError(w, r, common.ErrorForbiddenWithCode(err, common.CodeWorkforceNoStaffProfile))
	default:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	}
}
