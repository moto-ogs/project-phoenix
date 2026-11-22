package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/render"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/dataimport"
	importapi "github.com/moto-ogs/project-phoenix/modules/dataimport/http"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/tokenprimitives"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// dataImportHTTPRuntime binds infrastructure and owner queries outside the handlers.
func dataImportHTTPRuntime(people peopledirectory.Capability, membership schoolmembership.Capability,
	opening dataimport.OpeningBalanceFactory,
) importapi.Runtime {
	staffForAccount := func(ctx context.Context, accountID int64) (int64, error) {
		person, err := people.FindPersonByAccount(ctx, accountID)
		if err != nil {
			return 0, fmt.Errorf("find person for account %d: %w", accountID, err)
		}
		staff, err := membership.FindStaffByPerson(ctx, person.ID)
		if err != nil {
			return 0, fmt.Errorf("find staff for person %d: %w", person.ID, err)
		}
		return staff.ID, nil
	}
	runtime := importapi.Runtime{
		Middleware:           append(SessionChain(tokenprimitives.TenantClaims), common.TenantOperationMiddleware, markDataImportTraegerAuthor),
		RequireAnyPermission: common.RequiresAnyPermission,
		TemplateTransaction:  common.TenantTxMiddleware,
		WithinTenant:         tenant.WithinCurrentTenant,
		TenantID:             tenant.FromContext,
		AccountID:            dataImportAccountID,
		Permissions:          func(ctx context.Context) []string { return sessiontoken.ClaimsFromCtx(ctx).Permissions },
		StaffID: func(ctx context.Context) (int64, error) {
			id, err := dataImportAccountID(ctx)
			if err != nil {
				return 0, err
			}
			staffID, err := staffForAccount(ctx, id)
			return dataImportStaffID(ctx, staffID, err)
		},
		OpeningDecider: staffForAccount,
		ChildQuota: func(ctx context.Context) (importapi.ChildQuota, bool, error) {
			// The module behind the capability also reads the Kinderkontingent
			// (#3571); the capability interface stays as narrow as it is.
			quota, ok := membership.(schoolmembership.ChildQuotaUsages)
			if !ok {
				return importapi.ChildQuota{}, false, errDataImportChildQuotaReaderUnbound
			}
			usage, limited, err := quota.ChildQuotaUsage(ctx)
			return importapi.ChildQuota{Booked: usage.Booked, Occupied: usage.Occupied, Free: usage.Free(), Admit: usage.Admit}, limited, err
		},
		Success: common.Respond,
		Failure: renderDataImportFailure,
	}
	if opening != nil {
		runtime.ValidateOpeningDate = opening.ValidateDate
		runtime.OpeningImport = opening.ForUpload
	}
	return runtime
}

// markDataImportTraegerAuthor marks the request of a school session the
// Träger-Büro opened through the Absprung (ADR 0084 section 5, #7818). Its
// person holds the school's admin role without a staff record there; the
// weekly times an import writes carry the mark instead of a staff author.
func markDataImportTraegerAuthor(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if sessiontoken.ClaimsFromCtx(r.Context()).ViaTraeger {
			r = r.WithContext(careplan.WithTraegerBueroAuthor(r.Context()))
		}
		next.ServeHTTP(w, r)
	})
}

// dataImportStaffID names the import's author. A staff member always imports
// as staff; the marked Träger-Büro without a staff record imports without one
// (0); any other account without a staff record is refused (#7818). A
// failed lookup stays an error of its own.
func dataImportStaffID(ctx context.Context, staffID int64, err error) (int64, error) {
	if !errors.Is(err, peopledirectory.ErrPersonNotFound) && !errors.Is(err, schoolmembership.ErrStaffNotFound) {
		return staffID, err
	}
	if careplan.EnteredByTraeger(ctx, 0) {
		return 0, nil
	}
	return 0, fmt.Errorf("%w: %w", importapi.ErrStaffProfileRequired, err)
}

var errDataImportChildQuotaReaderUnbound = errors.New("data import: child quota reader is not bound")

func dataImportAccountID(ctx context.Context) (int64, error) {
	claims, ok := ctx.Value(sessiontoken.CtxClaims).(sessiontoken.AppClaims)
	if !ok {
		return 0, fmt.Errorf("no claims in context")
	}
	return int64(claims.ID), nil
}

// dataImportBatchFailure answers a failed batch with the progress committed before it.
// A batch the owner refused, such as one a full Kinderkontingent stops after
// a concurrent write (#3571), is a 409 that also names the refusal's code and
// details, so the client can say both what was saved and why it stopped.
func dataImportBatchFailure(failure importapi.Failure) render.Renderer {
	details := map[string]any{"result": failure.Result}
	status := failure.Status
	var rejection common.BusinessRejection
	if errors.As(failure.Cause, &rejection) {
		status = http.StatusConflict
		details["rejection"] = map[string]any{"code": rejection.ErrorCode(), "details": rejection.ErrorDetails()}
	}
	return &common.ErrResponse{Err: failure.Cause, HTTPStatusCode: status, Detail: failure.Message, Code: failure.Code, Details: details}
}

// dataImportCodedFailure answers a refusal the client words itself from its code, such
// as an upload it must fix (#2517). The message stays a diagnostic.
func dataImportCodedFailure(failure importapi.Failure) render.Renderer {
	text := failure.Message
	if text == "" && failure.Cause != nil {
		text = failure.Cause.Error()
	}
	return &common.ErrResponse{Err: failure.Cause, HTTPStatusCode: failure.Status, Detail: text, Code: failure.Code, Details: failure.Details}
}

func renderDataImportFailure(w http.ResponseWriter, r *http.Request, failure importapi.Failure) {
	var response render.Renderer
	switch {
	case failure.Code != "" && failure.Result != nil:
		response = dataImportBatchFailure(failure)
	case failure.Code != "":
		response = dataImportCodedFailure(failure)
	case failure.Status == http.StatusBadRequest:
		response = common.ErrorInvalidRequest(failure.Cause)
	case failure.Status == http.StatusUnauthorized:
		response = common.ErrorUnauthorized(failure.Cause)
	case failure.Status == http.StatusForbidden:
		response = common.ErrorForbiddenMessage(failure.Message)
	case failure.Message != "":
		response = common.ErrorInternalServerWrap(failure.Message, failure.Cause)
	default:
		response = common.ErrorInternalServer(failure.Cause)
	}
	common.RenderError(w, r, response)
}
