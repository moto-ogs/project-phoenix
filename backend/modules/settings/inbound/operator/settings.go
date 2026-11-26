// Package operator serves the operator school settings routes of Settings
// Platform (#3232): the school's settings schema, and setting, resetting and
// revealing a school's values. The
// operator router in api/operator mounts these handlers behind its
// middleware chain, so the operator wire format and authorization stay
// unchanged. The handlers call the public OperatorSchoolSettings capability
// (#2736); the tenant transaction, the side effects and the broadcast live
// behind it. The operator and the school's slug come through ports the root
// binds (#4072), so the platform names no domain owner.
package operator

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/settings"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// errAdminOnlyForOperator explains why an operator may not touch an
// AccessAdminOnly setting (e.g. the OGS device PIN). Surfaced as HTTP 403.
const errAdminOnlyForOperator = "this setting is admin-only and cannot be modified by operators"

const errLegalAGBDocumentManagedByUpload = "AGB document URL is managed by the file upload endpoint"

// guardOperatorWrite blocks the operator from set/reset/reveal on AccessAdminOnly settings.
// The access-policy decision lives in the settings capability (CheckOperatorWritable);
// this maps the returned error to the operator HTTP response. Returns true when
// the handler should abort (response has already been written).
func (rs *SettingsResource) guardOperatorWrite(w http.ResponseWriter, r *http.Request, key string) bool {
	err := rs.settings.CheckOperatorWritable(key)
	if err == nil {
		return false
	}
	if _, ok := errors.AsType[*settings.DefinitionNotFoundError](err); ok {
		common.RenderError(w, r, common.OperatorRejection(http.StatusNotFound, common.CodeSettingsNotFound, fmt.Sprintf("setting %q not found", key)))
		return true
	}
	common.RenderError(w, r, common.OperatorRejection(http.StatusForbidden, common.CodeSettingsAdminOnly, errAdminOnlyForOperator))
	return true
}

func guardOperatorDirectManagedSettingWrite(w http.ResponseWriter, r *http.Request, key string) bool {
	if key != settings.KeyEnrollmentLegalAGBDocumentURL {
		return false
	}
	common.RenderError(w, r, common.OperatorRejection(http.StatusForbidden, common.CodeSettingsManagedByUpload, errLegalAGBDocumentManagedByUpload))
	return true
}

// SettingsResource handles operator-level settings management for schools.
type SettingsResource struct {
	// settings owns the reads and the set/reset orchestration (presence-mode
	// guard, tenant transaction, side-effect hook, SSE broadcast).
	settings             settings.OperatorSchoolSettings
	schoolService        SchoolLookup
	tenantLookupSettings []string
	// operatorID names the authenticated operator who changes a value.
	operatorID OperatorIdentity
}

// OperatorIdentity returns the authenticated operator of the request
// context. The root binds it to the operator session.
type OperatorIdentity func(ctx context.Context) int64

// SettingsConfig holds the operator settings routes' dependencies.
type SettingsConfig struct {
	Settings settings.OperatorSchoolSettings
	// Schools reads the key of the cached school lookup (its subdomain).
	Schools SchoolLookup
	// TenantLookupSettings names the settings read by that lookup.
	TenantLookupSettings []string
	// OperatorID records who set or reset a value. Required.
	OperatorID OperatorIdentity
}

// NewSettingsResource creates a new operator settings resource.
func NewSettingsResource(cfg SettingsConfig) *SettingsResource {
	if cfg.OperatorID == nil {
		panic("operator settings: SettingsConfig.OperatorID is required")
	}
	return &SettingsResource{
		settings:             cfg.Settings,
		schoolService:        cfg.Schools,
		tenantLookupSettings: cfg.TenantLookupSettings,
		operatorID:           cfg.OperatorID,
	}
}

type setSchoolSettingRequest struct {
	Value any `json:"value" contract_json:"The route's setting key selects the value type in the settings registry"`
}

// revealedSettingValue is the unmasked value of a password or PIN setting.
type revealedSettingValue struct {
	Value any `json:"value" contract_json:"The revealed setting's registered kind determines its value type"`
}

// schoolSettingMutationResponse carries the lookup slug for writes that
// change the school lookup. If it is unavailable after the write commits,
// the caller can invalidate all lookups without reporting a failed write.
type schoolSettingMutationResponse struct {
	SchoolSlug string `json:"school_slug,omitempty"`
}

func (rs *SettingsResource) mutationResponse(ctx context.Context, schoolID int64, key string) schoolSettingMutationResponse {
	if rs.schoolService == nil || !slices.Contains(rs.tenantLookupSettings, key) {
		return schoolSettingMutationResponse{}
	}
	slug, err := rs.schoolService.SchoolSubdomain(ctx, schoolID)
	if err != nil {
		slog.Warn("operator settings: school slug lookup failed",
			slog.Int64("school_id", schoolID),
			slog.Any("error", err),
		)
		return schoolSettingMutationResponse{}
	}
	return schoolSettingMutationResponse{SchoolSlug: slug}
}

// GetSchoolSettingsSchema returns the full settings schema with resolved values for a school.
// Operators bypass per-setting permission checks (nil permissions = all visible and writable).
func (rs *SettingsResource) GetSchoolSettingsSchema(w http.ResponseWriter, r *http.Request) {
	schoolID, ok := common.ParseInt64IDWithError(w, r, "id", "invalid school ID")
	if !ok {
		return
	}

	schema, err := rs.settings.Schema(r.Context(), schoolID)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("Failed to retrieve settings schema", err))
		return
	}

	common.Respond(w, r, http.StatusOK, schema, "Schema retrieved successfully")
}

// SetSchoolSettingValue sets a setting value for a specific school.
func (rs *SettingsResource) SetSchoolSettingValue(w http.ResponseWriter, r *http.Request) {
	schoolID, ok := common.ParseInt64IDWithError(w, r, "id", "invalid school ID")
	if !ok {
		return
	}
	key := chi.URLParam(r, "key")
	if rs.guardOperatorWrite(w, r, key) {
		return
	}
	if guardOperatorDirectManagedSettingWrite(w, r, key) {
		return
	}

	var req setSchoolSettingRequest
	if err := wire.Decode(r.Body, &req); err != nil {
		common.RenderError(w, r, common.OperatorInvalidRequest(err))
		return
	}

	changedBy := rs.operatorID(r.Context())
	// ?force=true lets operators bypass the presence-mode switch guard when
	// doing maintenance recovery (e.g. stuck attendance rows blocking the
	// switch). Everything else ignores the flag.
	force := r.URL.Query().Get("force") == "true"

	err := rs.settings.SetValue(r.Context(), schoolID, key, req.Value, changedBy, force)
	if err != nil {
		// Dedicated 409 path for the mode-switch block so the frontend can
		// surface the "daily end required" copy without heuristics. errors.Is
		// keeps the branch resilient to wrapping, unlike string equality.
		if errors.Is(err, settings.ErrPresenceModeSwitchBlocked) {
			common.RenderError(w, r, common.OperatorRejection(http.StatusConflict, common.CodeSettingsPresenceModeSwitchBlocked, settings.ErrPresenceModeSwitchBlocked.Error()))
			return
		}
		if blocked, ok := errors.AsType[*settings.BookingAuthorityBlockedError](err); ok {
			common.RenderError(w, r, common.OperatorRejection(http.StatusConflict, common.CodeSettingsBookingAuthorityBlocked, blocked.Error()))
			return
		}
		renderOperatorSettingsError(w, r, err)
		return
	}

	common.Respond(w, r, http.StatusOK, rs.mutationResponse(r.Context(), schoolID, key), "Value updated successfully")
}

// ResetSchoolSettingValue resets a setting value for a specific school to its default.
func (rs *SettingsResource) ResetSchoolSettingValue(w http.ResponseWriter, r *http.Request) {
	schoolID, ok := common.ParseInt64IDWithError(w, r, "id", "invalid school ID")
	if !ok {
		return
	}
	key := chi.URLParam(r, "key")
	if rs.guardOperatorWrite(w, r, key) {
		return
	}
	if guardOperatorDirectManagedSettingWrite(w, r, key) {
		return
	}

	changedBy := rs.operatorID(r.Context())

	if err := rs.settings.ResetValue(r.Context(), schoolID, key, changedBy); err != nil {
		renderOperatorSettingsError(w, r, err)
		return
	}

	common.Respond(w, r, http.StatusOK, rs.mutationResponse(r.Context(), schoolID, key), "Value reset successfully")
}

// RevealSchoolSettingValue reveals the unmasked value of a password/PIN setting for a school.
func (rs *SettingsResource) RevealSchoolSettingValue(w http.ResponseWriter, r *http.Request) {
	schoolID, ok := common.ParseInt64IDWithError(w, r, "id", "invalid school ID")
	if !ok {
		return
	}
	key := chi.URLParam(r, "key")
	if rs.guardOperatorWrite(w, r, key) {
		return
	}

	value, err := rs.settings.Reveal(r.Context(), schoolID, key)
	if err != nil {
		renderOperatorSettingsError(w, r, err)
		return
	}

	common.Respond(w, r, http.StatusOK, revealedSettingValue{Value: value}, "")
}

// renderOperatorSettingsError maps settings errors to operator HTTP responses.
func renderOperatorSettingsError(w http.ResponseWriter, r *http.Request, err error) {
	settingsErr, ok := errors.AsType[*settings.SettingsError](err)
	if !ok {
		// The cause is logged and reported, never sent to the client (#2519).
		common.RenderError(w, r, common.ErrorInternalServerWrap("Failed to change setting", err))
		return
	}

	inner := settingsErr.Unwrap()

	var defNotFound *settings.DefinitionNotFoundError
	var invalidValue *settings.InvalidValueError
	var attendanceWindow *settings.AttendanceWindowError
	var privacyNotice *settings.EnrollmentPrivacyNoticeError
	var moduleDependency *settings.ModuleDependencyError
	var permDenied *settings.PermissionDeniedError

	switch {
	case errors.As(inner, &defNotFound):
		common.RenderError(w, r, common.OperatorRejection(http.StatusNotFound, common.CodeSettingsNotFound, err.Error()))
	case errors.As(inner, &invalidValue):
		common.RenderError(w, r, common.OperatorInvalidRequestWithCode(err, common.CodeSettingsInvalidValue))
	case errors.As(inner, &attendanceWindow):
		code, details := attendanceWindowRejection(attendanceWindow)
		common.RenderError(w, r, common.OperatorRejectionWithDetails(http.StatusBadRequest, code, err.Error(), details))
	case errors.As(inner, &privacyNotice):
		common.RenderError(w, r, common.OperatorRejection(http.StatusBadRequest, common.CodeSettingsEnrollmentPrivacyNoticeMissing, err.Error()))
	case errors.As(inner, &moduleDependency):
		code, details := moduleDependencyRejection(moduleDependency)
		common.RenderError(w, r, common.OperatorRejectionWithDetails(http.StatusBadRequest, code, err.Error(), details))
	case errors.As(inner, &permDenied):
		common.RenderError(w, r, common.OperatorForbidden(err.Error()))
	default:
		common.RenderError(w, r, common.ErrorInternalServerWrap("Failed to change setting", err))
	}
}

// attendanceWindowRejection names the window that blocks the write (#3957):
// the retention a visible window may not exceed, or the visible window a
// retention may not undercut.
func attendanceWindowRejection(window *settings.AttendanceWindowError) (string, any) {
	if window.VisibleWritten() {
		return common.CodeSettingsAttendanceVisibleExceedsRetention, RetentionDaysDetails{RetentionDays: window.RetentionDays}
	}
	return common.CodeSettingsAttendanceRetentionBelowVisible, VisibleDaysDetails{VisibleDays: window.VisibleDays}
}

// moduleDependencyRejection names the modules that block a module switch
// (#4892): the prerequisites a booking lacks, or the booked modules a
// cancellation would leave without their prerequisite.
func moduleDependencyRejection(rejection *settings.ModuleDependencyError) (string, any) {
	if rejection.Booking {
		return common.CodeSettingsModuleRequires, ModuleRequiresDetails{
			Module: rejection.Module.Label, Required: rejection.ConflictLabels(),
		}
	}
	return common.CodeSettingsModuleRequiredBy, ModuleRequiredByDetails{
		Module: rejection.Module.Label, Dependents: rejection.ConflictLabels(),
	}
}

type RetentionDaysDetails struct {
	RetentionDays int `json:"retention_days"`
}

type VisibleDaysDetails struct {
	VisibleDays int `json:"visible_days"`
}

type ModuleRequiresDetails struct {
	Module   string `json:"module"`
	Required string `json:"required"`
}

type ModuleRequiredByDetails struct {
	Module     string `json:"module"`
	Dependents string `json:"dependents"`
}
