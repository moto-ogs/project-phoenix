package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	iotAPI "github.com/moto-ogs/project-phoenix/api/iot"
	"github.com/moto-ogs/project-phoenix/modules/devicefleet"
	"github.com/moto-ogs/project-phoenix/modules/devicefleet/deviceauth"
	devicesAPI "github.com/moto-ogs/project-phoenix/modules/devicefleet/http/devices"
	"github.com/moto-ogs/project-phoenix/modules/devicescan"
	checkinAPI "github.com/moto-ogs/project-phoenix/modules/devicescan/http/checkin"
	dataAPI "github.com/moto-ogs/project-phoenix/modules/devicescan/http/data"
	sessionsAPI "github.com/moto-ogs/project-phoenix/modules/devicescan/http/sessions"
	staffclockAPI "github.com/moto-ogs/project-phoenix/modules/devicescan/http/staffclock"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
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

func iotDevicesRuntime(history devicefleet.LifecycleHistory, names DeviceActorDirectory, sessions DeviceRemovalSessions, logger *slog.Logger, now func() time.Time) devicesAPI.Runtime {
	return devicesAPI.Runtime{ParseID: common.ParseIDParam, Now: now, Permission: common.RequiresPermission, Success: common.Respond, Failure: renderIoTDataFailure, ConflictOnField: renderIoTConflictOnField, ConstraintViolation: transactionFailures.IsConstraintViolation,
		ConflictWithDetails: func(w http.ResponseWriter, r *http.Request, err error, code string, details map[string]any) {
			common.RenderError(w, r, common.ErrorConflictWithDetails(err, code, details))
		},
		ActiveSession:     deviceRemovalSession(sessions),
		AuditRemoval:      deviceRemovalAudit(logger),
		AuditStatusChange: deviceStatusAudit(logger),
		History:           history,
		Actor:             deviceLifecycleActor,
		ActorNames:        deviceActorNames(names),
	}
}

// deviceLifecycleActor is the staff account of a school request the device
// history records (#2321).
func deviceLifecycleActor(r *http.Request) int64 {
	return int64(sessiontoken.ClaimsFromCtx(r.Context()).ID)
}

// DeviceActorDirectory is the People Directory read that names the staff in
// a device history (#2321): the persons of the school's accounts.
type DeviceActorDirectory interface {
	ListPersonsByAccount(context.Context, []int64) ([]peopledirectory.Person, error)
}

// deviceActorNames names the accounts in the request's tenant transaction,
// so a history names only the school's own staff.
func deviceActorNames(directory DeviceActorDirectory) func(context.Context, []int64) (map[int64]string, error) {
	return func(ctx context.Context, accountIDs []int64) (map[int64]string, error) {
		names := make(map[int64]string, len(accountIDs))
		if len(accountIDs) == 0 {
			return names, nil
		}
		persons, err := directory.ListPersonsByAccount(ctx, accountIDs)
		if err != nil {
			return nil, err
		}
		for _, person := range persons {
			if person.AccountID != nil {
				names[*person.AccountID] = strings.TrimSpace(person.FullName())
			}
		}
		return names, nil
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

// deviceStatusAudit writes an effective status change to the structured
// audit log (#2317): who blocked, unblocked or otherwise changed which
// device of which school. The entry carries no credential.
func deviceStatusAudit(logger *slog.Logger) func(*http.Request, devicesAPI.StatusAudit) {
	return func(r *http.Request, entry devicesAPI.StatusAudit) {
		logger.InfoContext(r.Context(), "device status change",
			"audit", "device_status",
			"outcome", entry.Outcome(),
			"tenant_id", tenant.FromContext(r.Context()),
			"account_id", sessiontoken.ClaimsFromCtx(r.Context()).ID,
			"device_row_id", entry.DeviceRowID,
			"device_id", entry.DeviceID,
			"from_status", string(entry.From),
			"to_status", string(entry.To),
		)
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
