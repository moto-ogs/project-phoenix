package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	fileStorageCompose "github.com/moto-ogs/project-phoenix/modules/filestorage/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	apiCommon "github.com/moto-ogs/project-phoenix/api/common"
	nativeUploads "github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	settingsModule "github.com/moto-ogs/project-phoenix/modules/settings"
	settingsHTTP "github.com/moto-ogs/project-phoenix/modules/settings/http"
	settingsOperatorAPI "github.com/moto-ogs/project-phoenix/modules/settings/inbound/operator"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
)

func newSettingsResource(db transactionruntime.Database, operations settingsHTTP.Operations, homeLayouts settingsHTTP.HomeLayoutOperations, devicePIN settingsHTTP.DevicePINOperations, references func(context.Context, string, string) (bool, error), now func() time.Time, schools owners.SchoolFinder, uploads nativeUploads.UploadFiles) *settingsHTTP.SettingsResource {
	settingsRuntime := settingsHTTP.NewRuntime(settingsHTTP.RuntimeDependencies{
		DocumentCleanup: fileStorageCompose.NewUploadCleanup(db.Pool(), "enrollment-legal-documents", now).Queue,
		Protected: func(r chi.Router, fn func(chi.Router, settingsHTTP.Middleware)) {
			ProtectedTenantRoutes(r, fn)
		},
		Permission: func(access settingsHTTP.Access) settingsHTTP.Middleware {
			return requireSettingsAccess(access)
		},
		TenantGuard: apiCommon.TenantOperationMiddleware,
		RequestActor: func(ctx context.Context) (int64, int64, []string) {
			principal, err := apiCommon.CurrentPrincipal(ctx)
			if err != nil {
				return 0, 0, nil
			}
			return principal.TenantID(), principal.AccountID(), principal.Permissions()
		},
		Editable:  canEditConfig,
		Success:   apiCommon.Respond,
		NoContent: apiCommon.RespondNoContent,
		Failure:   renderSettingsError,
		ImageUpload: func(w http.ResponseWriter, r *http.Request, field string, maxBody int64) (*settingsHTTP.UploadedFile, error) {
			file, err := apiCommon.ParseImage(w, r, field, maxBody)
			if err != nil {
				return nil, err
			}
			return &settingsHTTP.UploadedFile{File: file.File, ContentType: file.ContentType}, nil
		},
		PDFUpload: func(w http.ResponseWriter, r *http.Request, field string, maxFile, maxBody int64) (*settingsHTTP.UploadedFile, error) {
			file, err := apiCommon.Declared(apiCommon.ParsePDFWithLimits, apiCommon.DeclaredPDFTypes)(w, r, field, maxFile, maxBody)
			if err != nil {
				return nil, err
			}
			return &settingsHTTP.UploadedFile{File: file.File, ContentType: file.ContentType}, nil
		},
		ImageSave: func(file io.Reader, dir, prefix, contentType string) (string, error) {
			return apiCommon.SaveImage(file, dir, prefix, contentType, uploads)
		},
		PDFSave: func(file io.Reader, dir, prefix string) (string, error) {
			return apiCommon.SavePDF(file, dir, prefix, uploads)
		},
		FileRemove: uploads.RemoveUpload,
		StoredPath: uploads.StoredPath,
		LegalDocumentReference: func(ctx context.Context, storedURL string) (bool, error) {
			publicURL := enrollmentAPI.PublicLegalDocumentURL(storedURL)
			referenced, err := references(ctx, storedURL, publicURL)
			if err != nil {
				return false, fmt.Errorf("check AGB document references: %w", err)
			}
			return referenced, nil
		},
	})
	return settingsHTTP.NewSettingsResource(operations, homeLayouts, devicePIN, settingsRuntime, owners.SchoolContactDirectory{Schools: schools}.ContactEmail)
}

func renderSettingsError(w http.ResponseWriter, r *http.Request, status int, err error) {
	switch status {
	case http.StatusBadRequest:
		apiCommon.RenderError(w, r, settingsInputError(err))
	case http.StatusForbidden:
		apiCommon.RenderError(w, r, apiCommon.ErrorForbidden(err))
	case http.StatusNotFound:
		apiCommon.RenderError(w, r, apiCommon.ErrorNotFound(err))
	default:
		apiCommon.RenderError(w, r, apiCommon.ErrorInternalServer(err))
	}
}

// settingsInputError renders a rejected setting value. A visible attendance
// window longer than its retention names the window that blocks it (#3957),
// so the person reads which value is allowed. A device PIN that is easy to
// guess gets its own code, so the person reads why (#7175).
func settingsInputError(err error) render.Renderer {
	// A refused AGB document or login image keeps the upload's code (#2352).
	if refused, ok := apiCommon.UploadRefusalRenderer(err); ok {
		return refused
	}
	if _, ok := errors.AsType[*settingsModule.DevicePINTooSimpleError](err); ok {
		return apiCommon.ErrorInvalidRequestWithCode(err, apiCommon.CodeSettingsDevicePinTooSimple)
	}
	if _, ok := errors.AsType[*settingsModule.EnrollmentPrivacyNoticeError](err); ok {
		// #7176: names the missing privacy notice instead of a bare invalid value.
		return apiCommon.ErrorInvalidRequestWithCode(err, apiCommon.CodeSettingsEnrollmentPrivacyNoticeMissing)
	}
	window, ok := errors.AsType[*settingsModule.AttendanceWindowError](err)
	if !ok {
		return apiCommon.ErrorInvalidRequest(err)
	}
	if window.VisibleWritten() {
		return apiCommon.ErrorInvalidRequestWithDetails(err, apiCommon.CodeSettingsAttendanceVisibleExceedsRetention,
			settingsOperatorAPI.RetentionDaysDetails{RetentionDays: window.RetentionDays})
	}
	return apiCommon.ErrorInvalidRequestWithDetails(err, apiCommon.CodeSettingsAttendanceRetentionBelowVisible,
		settingsOperatorAPI.VisibleDaysDetails{VisibleDays: window.VisibleDays})
}
