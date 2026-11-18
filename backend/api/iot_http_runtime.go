package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	iotAPI "github.com/moto-ogs/project-phoenix/api/iot"
	"github.com/moto-ogs/project-phoenix/modules/devicefleet/deviceauth"
	devicesAPI "github.com/moto-ogs/project-phoenix/modules/devicefleet/http/devices"
	"github.com/moto-ogs/project-phoenix/modules/devicescan"
	checkinAPI "github.com/moto-ogs/project-phoenix/modules/devicescan/http/checkin"
	dataAPI "github.com/moto-ogs/project-phoenix/modules/devicescan/http/data"
	sessionsAPI "github.com/moto-ogs/project-phoenix/modules/devicescan/http/sessions"
	staffclockAPI "github.com/moto-ogs/project-phoenix/modules/devicescan/http/staffclock"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	transactionFailures "github.com/moto-ogs/project-phoenix/modules/transactionruntime"
	"github.com/moto-ogs/project-phoenix/tenant"
)

func iotInfoRuntime() iotAPI.Runtime {
	return iotAPI.Runtime{Authenticated: func(ctx context.Context) bool { _, _, _, _, ok := deviceauth.ContextDevice(ctx); return ok }, Success: common.Respond, Failure: renderIoTDataFailure}
}

func iotErrorReportsRuntime() iotAPI.ErrorReportsRuntime {
	return iotAPI.ErrorReportsRuntime{
		Device: func(ctx context.Context) (int64, string, int64, bool) {
			id, deviceID, tenantID, _, ok := deviceauth.ContextDevice(ctx)
			return id, deviceID, tenantID, ok
		},
		Failure:               renderIoTErrorReportFailure,
		SkipServerErrorReport: common.SkipServerErrorReport,
	}
}

// renderIoTErrorReportFailure renders the relay's rejections in the IoT error
// envelope. A 502 answers a stable text and keeps Sentry's failure as the
// logged cause.
func renderIoTErrorReportFailure(w http.ResponseWriter, r *http.Request, status int, err error) {
	switch status {
	case http.StatusTooManyRequests:
		common.RenderError(w, r, common.ErrorTooManyRequests(err))
	case http.StatusServiceUnavailable:
		common.RenderError(w, r, common.ErrorServiceUnavailable(err))
	case http.StatusBadGateway:
		common.RenderError(w, r, common.ErrorBadGatewayWrap(iotAPI.ErrErrorReportUndelivered.Error(), err))
	default:
		renderIoTDataFailure(w, r, status, err, "")
	}
}

func iotDevicesRuntime(sessions DeviceRemovalSessions, logger *slog.Logger, now func() time.Time) devicesAPI.Runtime {
	return devicesAPI.Runtime{ParseID: common.ParseIDParam, Now: now, Permission: common.RequiresPermission, Success: common.Respond, Failure: renderIoTDataFailure, ConflictOnField: renderIoTConflictOnField, ConstraintViolation: transactionFailures.IsConstraintViolation,
		ConflictWithDetails: func(w http.ResponseWriter, r *http.Request, err error, code string, details map[string]any) {
			common.RenderError(w, r, common.ErrorConflictWithDetails(err, code, details))
		},
		ActiveSession: deviceRemovalSession(sessions),
		AuditRemoval:  deviceRemovalAudit(logger),
	}
}

// DeviceRemovalSessions is the Student Presence read the device removal
// guard needs (#2319): the open sessions a device runs.
type DeviceRemovalSessions interface {
	QueryLiveGroups(context.Context, studentpresence.LiveGroupFilter) ([]studentpresence.LiveGroup, error)
}

// deviceRemovalSession reads the device's open kiosk session in the
// request's tenant transaction.
func deviceRemovalSession(sessions DeviceRemovalSessions) func(context.Context, int64) (*devicesAPI.RemovalSession, error) {
	return func(ctx context.Context, deviceRowID int64) (*devicesAPI.RemovalSession, error) {
		open, err := sessions.QueryLiveGroups(ctx, studentpresence.LiveGroupFilter{DeviceID: &deviceRowID, OpenOnly: true, Limit: 1})
		if err != nil || len(open) == 0 {
			return nil, err
		}
		return &devicesAPI.RemovalSession{ID: open[0].ID, StartedAt: open[0].StartTime, RoomID: open[0].RoomID}, nil
	}
}

// deviceRemovalAudit writes the removal outcome to the structured audit
// log: who removed or tried to remove which device of which school. The
// entry carries no credential.
func deviceRemovalAudit(logger *slog.Logger) func(*http.Request, devicesAPI.RemovalAudit) {
	return func(r *http.Request, entry devicesAPI.RemovalAudit) {
		attrs := []any{
			"audit", "device_removal",
			"outcome", entry.Outcome,
			"tenant_id", tenant.FromContext(r.Context()),
			"account_id", sessiontoken.ClaimsFromCtx(r.Context()).ID,
			"device_row_id", entry.DeviceRowID,
			"device_id", entry.DeviceID,
		}
		if entry.SessionID != nil {
			attrs = append(attrs, "session_id", *entry.SessionID)
		}
		logger.InfoContext(r.Context(), "device removal", attrs...)
	}
}

func iotSessionRuntime(now func() time.Time) sessionsAPI.Runtime {
	return sessionsAPI.Runtime{ParseID: common.ParseIDParam, Now: now,
		Authenticated: func(ctx context.Context) bool { _, _, _, _, ok := deviceauth.ContextDevice(ctx); return ok },
		Success:       common.Respond,
		Failure:       renderIoTDataFailure,
		Conflict:      renderIoTSessionConflict,
		MarkRollback:  tenant.MarkRollback,
	}
}

// renderIoTSessionConflict answers a session conflict in the shared error
// envelope; the conflict travels as details.
func renderIoTSessionConflict(w http.ResponseWriter, r *http.Request, message string, info devicescan.ConflictInfoResponse) {
	details := map[string]any{
		"has_conflict":     info.HasConflict,
		"conflict_message": info.ConflictMessage,
		"can_override":     info.CanOverride,
	}
	if info.ConflictingDevice != nil {
		details["conflicting_device"] = *info.ConflictingDevice
	}
	common.RenderError(w, r, common.ErrorConflictWithDetails(errors.New(message), common.CodeGeneralBusinessRejection, details))
}

func iotDataRuntime(now func() time.Time) dataAPI.Runtime {
	return dataAPI.Runtime{ParseID: common.ParseIDParam, Now: now,
		Device: func(ctx context.Context) (int64, string, bool) {
			id, deviceID, _, _, ok := deviceauth.ContextDevice(ctx)
			return id, deviceID, ok
		},
		Success: common.Respond,
		Failure: renderIoTDataFailure,
	}
}

func renderIoTConflictOnField(w http.ResponseWriter, r *http.Request, err error, code, field string) {
	common.RenderError(w, r, common.ErrorConflictOnField(err, code, field))
}

func renderIoTDataFailure(w http.ResponseWriter, r *http.Request, status int, err error, clientMessage string) {
	// A classified kiosk refusal with a registered code keeps it (#3939).
	if failure, ok := devicescan.IsFailure(err); ok && failure.Code != "" {
		renderIoTKioskFailure(w, r, status, failure.Code, err, nil, clientMessage)
		return
	}
	switch status {
	case http.StatusUnauthorized:
		common.RenderError(w, r, deviceauth.Unauthorized(err))
	case http.StatusBadRequest:
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
	case http.StatusNotFound:
		common.RenderError(w, r, common.ErrorNotFound(err))
	case http.StatusConflict:
		common.RenderError(w, r, common.ErrorConflict(err))
	case http.StatusForbidden:
		common.RenderError(w, r, common.ErrorForbidden(err))
	default:
		if clientMessage != "" {
			common.RenderError(w, r, common.ErrorInternalServerWrap(clientMessage, err))
		} else {
			common.RenderError(w, r, common.ErrorInternalServer(err))
		}
	}
}

// iotStaffClockRuntime binds the kiosk staff clock resource to the shared
// response envelope. The resource classifies; this renders (#2690).
func iotStaffClockRuntime() staffclockAPI.Runtime {
	return staffclockAPI.Runtime{
		Success: common.Respond,
		Failure: renderIoTKioskFailure,
	}
}

// iotCheckinRuntime binds the kiosk scan and attendance resources to the same
// envelope (#2698).
func iotCheckinRuntime(now func() time.Time) checkinAPI.Runtime {
	return checkinAPI.Runtime{Now: now,
		Success: common.Respond,
		Failure: renderIoTKioskFailure,
	}
}

func renderIoTKioskFailure(w http.ResponseWriter, r *http.Request, status int, code string, err error, details map[string]string, clientMessage string) {
	switch status {
	case http.StatusBadRequest:
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, code))
	case http.StatusUnauthorized:
		common.RenderError(w, r, common.ErrorUnauthorizedWithCode(err, code))
	case http.StatusNotFound:
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, code))
	case http.StatusConflict:
		if len(details) > 0 {
			payload := make(map[string]any, len(details))
			for key, value := range details {
				payload[key] = value
			}
			common.RenderError(w, r, common.ErrorConflictWithDetails(err, code, payload))
			return
		}
		common.RenderError(w, r, common.ErrorConflictWithCode(err, code))
	default:
		common.RenderError(w, r, common.ErrorInternalServerWrapWithCode(clientMessage, err, code))
	}
}
