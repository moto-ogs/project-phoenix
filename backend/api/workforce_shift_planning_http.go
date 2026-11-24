// Package shiftplanning composes the HTTP runtime of the staff-shift and
// shift-type administration routes over the Workforce capability (#2689).
// The route adapters themselves must not own the HTTP platform, so this
// package supplies authentication, tenant transaction scoping, permission
// names, actor resolution and the shared response envelope through their
// Runtime. The public StaffShiftPlanning and ShiftTypeAdministration
// contracts it mounts are served by the Workforce planning composition
// (modules/workforce/compose, #3418).
package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	shifttypesHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/shifttypes"
	staffshiftsHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/staffshifts"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// staffShiftsDependencies are the collaborators the staff-shift route
// composition cannot own: the planning capability and the actor lookups.
// The shared middleware opens the tenant transaction from the request context.
type staffShiftsDependencies struct {
	Planning workforce.StaffShiftPlanning

	// ResolveStaffID identifies the staff record of the acting admin.
	ResolveStaffID func(context.Context) (int64, error)
	// ActorAccountID names the acting account for audit entries; nil records
	// an actor-less event.
	ActorAccountID func(context.Context) *int64
}

// newStaffShiftsResource wires /api/staff-shifts over the planning
// capability.
func newStaffShiftsResource(deps staffShiftsDependencies) *staffshiftsHTTP.Resource {
	if deps.Planning == nil || deps.ResolveStaffID == nil || deps.ActorAccountID == nil {
		panic("staff-shifts HTTP composition: all dependencies are required")
	}
	return staffshiftsHTTP.NewResource(deps.Planning, staffShiftsRuntime(deps))
}

func staffShiftsRuntime(deps staffShiftsDependencies) staffshiftsHTTP.Runtime {
	return staffshiftsHTTP.Runtime{
		Protected: func(router chi.Router, routes func(chi.Router, staffshiftsHTTP.Middleware)) {
			ProtectedTenantRoutes(router, routes)
		},
		Permission: common.RequiresPermission,
		ParseID:    common.ParseID,
		Success:    common.Respond,
		Failure:    renderStaffShiftsFailure,
		ResolveActor: func(ctx context.Context) (staffshiftsHTTP.Actor, error) {
			return resolveStaffShiftsActor(ctx, deps)
		},
		MarkRollback: tenant.MarkRollback,
		CanExportInternalPlan: func(ctx context.Context) bool {
			return common.CanExportInternalPlan(sessiontoken.PermissionsFromCtx(ctx))
		},
		TimeTrackingManage: permissions.TimeTrackingManage,
		SchedulesRead:      permissions.SchedulesRead,
		UsersRead:          permissions.UsersRead,
	}
}

// resolveStaffShiftsActor names who writes the Dienstplan. A person with a
// staff record of the school writes as staff, also in a session opened
// through the Träger-Portal. Without one, only such a session writes, as the
// Träger-Büro (#7818, ADR 0084 section 5); every other account is refused.
// A failed lookup stays the server's error.
func resolveStaffShiftsActor(ctx context.Context, deps staffShiftsDependencies) (staffshiftsHTTP.Actor, error) {
	staffID, err := deps.ResolveStaffID(ctx)
	switch {
	case err == nil:
		return staffshiftsHTTP.NewActor(staffID, deps.ActorAccountID(ctx))
	case !callerHasNoStaffRecord(err):
		return staffshiftsHTTP.Actor{}, err
	case sessiontoken.ClaimsFromCtx(ctx).ViaTraeger:
		return staffshiftsHTTP.NewTraegerActor(deps.ActorAccountID(ctx))
	default:
		return staffshiftsHTTP.Actor{}, staffshiftsHTTP.ErrNoStaffActor
	}
}

// callerHasNoStaffRecord reports a session whose account has no person or
// no staff record at the school: the caller's missing profile, not a failed
// lookup.
func callerHasNoStaffRecord(err error) bool {
	return errors.Is(err, identityaccess.ErrCallerNotLinkedToPerson) || errors.Is(err, identityaccess.ErrCallerNotLinkedToStaff)
}

// staffShiftErrorCodes names the refusals the Dienstplan explains on its own
// (#2514). The first match wins, so a specific reason precedes the kind it
// travels with; anything unlisted keeps the class code of its status.
var staffShiftErrorCodes = []struct {
	target error
	code   string
}{
	{workforce.ErrReplacementOutsideOrigin, common.CodeWorkforceReplacementOutsideOrigin},
	{workforce.ErrReplacementStaffAbsent, common.CodeWorkforceReplacementStaffAbsent},
	{workforce.ErrShiftHasReplacements, common.CodeWorkforceShiftHasReplacements},
	{workforce.ErrShiftSeriesNoOccurrences, common.CodeWorkforceShiftSeriesNoOccurrences},
	{workforce.ErrShiftSeriesOutsidePeriod, common.CodeWorkforceShiftSeriesOutsidePeriod},
	{workforce.ErrShiftSeriesWeekCycleMissing, common.CodeWorkforceShiftSeriesWeekCycleMissing},
	{workforce.ErrStaffShiftOverlap, common.CodeWorkforceShiftOverlap},
	{workforce.ErrShiftOverlapsOtherSite, common.CodeWorkforceShiftOverlapsOtherSite},
	{workforce.ErrShiftWorkingTimeWarning, common.CodeWorkforceShiftWorkingTimeWarning},
	{workforce.ErrShiftPlanningOff, common.CodeWorkforceShiftPlanningOff},
	{workforce.ErrStaffShiftConflict, common.CodeWorkforceShiftChanged},
	{workforce.ErrStaffShiftDuplicate, common.CodeWorkforceShiftDuplicate},
	{workforce.ErrShiftTypeInactive, common.CodeWorkforceShiftTypeInactive},
	{workforce.ErrShiftTypeArchived, common.CodeWorkforceShiftTypeArchived},
	{staffshiftsHTTP.ErrNoStaffActor, common.CodeWorkforceNoStaffProfile},
}

func staffShiftErrorCode(err error) string {
	for _, entry := range staffShiftErrorCodes {
		if errors.Is(err, entry.target) {
			return entry.code
		}
	}
	return ""
}

// renderStaffShiftsFailure renders the failure with the shared envelope; the
// error's own wording is the message, as it was before the cutover. An
// internal failure carrying a client message keeps its cause in the log
// only.
func renderStaffShiftsFailure(w http.ResponseWriter, r *http.Request, kind staffshiftsHTTP.FailureKind, err error) {
	code := staffShiftErrorCode(err)
	switch kind {
	case staffshiftsHTTP.FailureInvalid:
		if code != "" {
			common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, code))
			return
		}
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
	case staffshiftsHTTP.FailureNotFound:
		common.RenderError(w, r, common.ErrorNotFound(err))
	case staffshiftsHTTP.FailureConflict:
		renderStaffShiftsConflict(w, r, code, err)
	case staffshiftsHTTP.FailureForbidden:
		if code != "" {
			common.RenderError(w, r, common.ErrorForbiddenWithCode(err, code))
			return
		}
		common.RenderError(w, r, common.ErrorForbidden(err))
	default:
		renderStaffShiftsInternal(w, r, err)
	}
}

// renderStaffShiftsConflict renders a 409. A refusal of the working-time
// check (#4708) can come after a cancellation already removed its covers,
// so it rolls back and carries its warnings in details.
func renderStaffShiftsConflict(w http.ResponseWriter, r *http.Request, code string, err error) {
	if details, ok := planCheckDetails(err); ok {
		tenant.MarkRollback(r.Context())
		common.RenderError(w, r, common.ErrorConflictWithDetails(err, code, details))
		return
	}
	// A duplicate is a unique violation that already aborted the
	// transaction; it was a 500 before and must still roll back.
	// An archived type can be refused while a cover set is rebuilt,
	// after its old covers were deleted; nothing of it may commit.
	if errors.Is(err, workforce.ErrStaffShiftDuplicate) || errors.Is(err, workforce.ErrShiftTypeArchived) || errors.Is(err, workforce.ErrShiftPlanningOff) {
		tenant.MarkRollback(r.Context())
	}
	if code != "" {
		common.RenderError(w, r, common.ErrorConflictWithCode(err, code))
		return
	}
	common.RenderError(w, r, common.ErrorConflict(err))
}

// renderStaffShiftsInternal keeps the cause of a client message in the log
// only.
func renderStaffShiftsInternal(w http.ResponseWriter, r *http.Request, err error) {
	var clientMessage *staffshiftsHTTP.ClientMessageError
	if errors.As(err, &clientMessage) {
		common.RenderError(w, r, common.ErrorInternalServerWrap(clientMessage.Message, clientMessage.Cause))
		return
	}
	common.RenderError(w, r, common.ErrorInternalServer(err))
}

// newShiftTypesResource wires /api/shift-types over the shift-type
// administration capability.
func newShiftTypesResource(types workforce.ShiftTypeAdministration, references workforce.ShiftPlanReferenceQuery) *shifttypesHTTP.Resource {
	if types == nil || references == nil {
		panic("shift-types HTTP composition: all dependencies are required")
	}
	return shifttypesHTTP.NewResource(types, references, shiftTypesRuntime())
}

func shiftTypesRuntime() shifttypesHTTP.Runtime {
	return shifttypesHTTP.Runtime{
		Protected: func(router chi.Router, routes func(chi.Router, shifttypesHTTP.Middleware)) {
			ProtectedTenantRoutes(router, routes)
		},
		Permission:         common.RequiresPermission,
		ParseID:            common.ParseID,
		Success:            common.Respond,
		Failure:            renderShiftTypesFailure,
		MarkRollback:       tenant.MarkRollback,
		TimeTrackingManage: permissions.TimeTrackingManage,
	}
}

func renderShiftTypesFailure(w http.ResponseWriter, r *http.Request, kind shifttypesHTTP.FailureKind, err error) {
	switch kind {
	case shifttypesHTTP.FailureInvalid:
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
	case shifttypesHTTP.FailureNotFound:
		common.RenderError(w, r, common.ErrorNotFound(err))
	case shifttypesHTTP.FailureConflict:
		common.RenderError(w, r, common.ErrorConflict(err))
	default:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	}
}

// planCheckDetails returns the details{} of a refusal of the working-time
// check: the warnings and whether a reason is missing, or the shift at the
// other Einsatzort. ok is false for every other error.
func planCheckDetails(err error) (any, bool) {
	if warning, ok := errors.AsType[*workforce.ShiftWorkingTimeError](err); ok {
		return warning.RefusalDetails(), true
	}
	if other, ok := errors.AsType[*workforce.ShiftOtherSiteError](err); ok {
		return workforce.ShiftOtherSiteRefusalDetails(other), true
	}
	return nil, false
}
