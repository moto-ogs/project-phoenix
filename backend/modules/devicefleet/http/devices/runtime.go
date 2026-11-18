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
	// Now is the root's clock the statistics and scan answers are stamped
	// with.
	Now func() time.Time
}

// codeDeviceIDTaken is the registered code of a device ID that another
// device already uses (error-registry/). This package does not import
// api/common, so it names the code once here.
const codeDeviceIDTaken = "iot.device_id_taken"

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

func (rs *Resource) renderError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, devicefleet.ErrAdministrationDuplicateDeviceID) && rs.runtime.ConflictOnField != nil {
		rs.runtime.ConflictOnField(w, r, err, codeDeviceIDTaken, "device_id")
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
