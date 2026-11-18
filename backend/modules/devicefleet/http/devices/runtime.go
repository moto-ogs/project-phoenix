package devices

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/devicefleet"
)

type Middleware = func(http.Handler) http.Handler

// Runtime supplies permission enforcement and the shared wire envelope.
type Runtime struct {
	ParseID    func(*http.Request, string) (int64, error)
	Permission func(string) Middleware
	Success    func(http.ResponseWriter, *http.Request, int, any, string)
	Failure    func(http.ResponseWriter, *http.Request, int, error, string)
	// ConflictOnField renders a 409 with a registered code that names the
	// field the conflict is about (#2517).
	ConflictOnField     func(w http.ResponseWriter, r *http.Request, err error, code, field string)
	ConstraintViolation func(error) bool
	// ConflictWithDetails renders a 409 with a registered code and the
	// structured values the screen shows.
	ConflictWithDetails func(w http.ResponseWriter, r *http.Request, err error, code string, details map[string]any)
	// ActiveSession reads the open kiosk session of a device row in the
	// request's tenant transaction; nil when the device runs none (#2319).
	ActiveSession func(ctx context.Context, deviceRowID int64) (*RemovalSession, error)
	// AuditRemoval records one removal outcome with the acting account.
	AuditRemoval func(r *http.Request, entry RemovalAudit)
	// AuditStatusChange records one effective status change with the acting
	// account: a block, an unblock or another status (#2317).
	AuditStatusChange func(r *http.Request, entry StatusAudit)
	// History records and reads the Gerätelebenszyklus (#2321): every
	// effective change writes an entry in the request's transaction.
	History devicefleet.LifecycleHistory
	// Actor is the staff account behind the request.
	Actor func(*http.Request) int64
	// ActorNames names the school's staff accounts a history shows, in one
	// read; an account without a person is left out.
	ActorNames func(context.Context, []int64) (map[int64]string, error)
	// DeviceSlots reads the school's Geräteplätze and their occupancy
	// (#2312). Without it that route answers 500.
	DeviceSlots devicefleet.DeviceSlotQuery
	// Now is the root's clock the statistics and scan answers are stamped
	// with.
	Now func() time.Time
}

// codeDeviceIDTaken is the registered code of a device ID that another
// device already uses (error-registry/). This package does not import
// api/common, so it names the code once here.
const codeDeviceIDTaken = "iot.device_id_taken"

// The device permissions of a school (#2312): devices:read shows the devices
// and the Geräteplätze, devices:manage every device-management action.
const (
	permissionDevicesRead   = "devices:read"
	permissionDevicesManage = "devices:manage"
)

// codeDeviceSlotsFull is the registered code of a registration every
// Geräteplatz of the school is taken for (error-registry/iot.json, #2312).
const codeDeviceSlotsFull = "iot.device_slots_full"

// codeDeviceInActiveSession is the registered code of a removal an open
// kiosk session blocks (error-registry/iot.json).
const codeDeviceInActiveSession = "iot.device_in_active_session"

// RemovalSession is the open kiosk session that protects a device from
// removal: ending it first keeps the session and its visits consistent.
type RemovalSession struct {
	ID        int64
	StartedAt time.Time
	RoomID    int64
}

// The outcomes of a removal request the audit trail distinguishes.
const (
	RemovalOutcomeRemoved       = "removed"
	RemovalOutcomeActiveSession = "rejected_active_session"
	RemovalOutcomeProtected     = "rejected_protected"
)

// RemovalAudit is one removal outcome. It names the device row, never its
// credential.
type RemovalAudit struct {
	DeviceRowID int64
	DeviceID    string
	Outcome     string
	SessionID   *int64
}

// StatusAudit is one effective status change of a device. It names the
// device row, never its credential. "inactive" blocks the device and
// "active" unblocks it (Gerätesperre, #2317).
type StatusAudit struct {
	DeviceRowID int64
	DeviceID    string
	From        devicefleet.DeviceStatus
	To          devicefleet.DeviceStatus
}

// The outcomes of a status change the audit trail distinguishes.
const (
	StatusOutcomeBlocked   = "blocked"
	StatusOutcomeUnblocked = "unblocked"
	StatusOutcomeChanged   = "status_changed"
)

// Outcome names the change: a block, an unblock or another status.
func (e StatusAudit) Outcome() string {
	switch e.To {
	case devicefleet.DeviceStatusInactive:
		return StatusOutcomeBlocked
	case devicefleet.DeviceStatusActive:
		return StatusOutcomeUnblocked
	default:
		return StatusOutcomeChanged
	}
}

func (rs *Resource) renderError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, devicefleet.ErrAdministrationDuplicateDeviceID) && rs.runtime.ConflictOnField != nil {
		rs.runtime.ConflictOnField(w, r, err, codeDeviceIDTaken, "device_id")
		return
	}
	var slotsFull *devicefleet.DeviceSlotsFullError
	if errors.As(err, &slotsFull) {
		rs.runtime.ConflictWithDetails(w, r, err, codeDeviceSlotsFull, map[string]any{"device_slots": slotsFull.DeviceSlots})
		return
	}
	status := http.StatusInternalServerError
	var failure *devicefleet.AdministrationError
	// Keep the historical outer-wrapper dispatch, not a nested refusal.
	if errors.As(err, &failure) && errors.Is(failure, err) {
		switch {
		case errors.Is(failure.Err, devicefleet.ErrAdministrationDeviceNotFound):
			status = http.StatusNotFound
		case errors.Is(failure.Err, devicefleet.ErrAdministrationInvalidDeviceData), errors.Is(failure.Err, devicefleet.ErrAdministrationInvalidStatus):
			status = http.StatusBadRequest
		case errors.Is(failure.Err, devicefleet.ErrAdministrationDuplicateDeviceID), errors.Is(failure.Err, devicefleet.ErrAdministrationDeviceOffline):
			status = http.StatusConflict
		case errors.Is(failure.Err, devicefleet.ErrAdministrationDeviceProtected):
			status = http.StatusForbidden
		}
	}
	rs.runtime.Failure(w, r, status, err, "")
}

// wireTime retains the administrative API's second-precision timestamps.
type wireTime time.Time

func (t wireTime) MarshalJSON() ([]byte, error) {
	return []byte(`"` + time.Time(t).Format(time.RFC3339) + `"`), nil
}
