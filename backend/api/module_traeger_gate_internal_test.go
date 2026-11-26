package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/common"
	settings "github.com/moto-ogs/project-phoenix/modules/settings"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// The lock reads no row; the ID only names the Träger of the session.
const gateTraeger int64 = 6052

// serveThroughTraegerLock sends a request of the Träger session through the
// classification and the lock and reports whether the handler was reached.
func serveThroughTraegerLock(t *testing.T, booked TraegerBookedModules, path string) (*httptest.ResponseRecorder, bool) {
	t.Helper()
	booking, err := settings.NewModuleBooking(moduleSwitches{})
	require.NoError(t, err)
	reached := false
	handler := moduleRoutesMiddleware(booking, nil, booked)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r = r.WithContext(tenant.WithOrgID(r.Context(), gateTraeger))
		requireTraegerModule(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			reached = true
			w.WriteHeader(http.StatusOK)
		})).ServeHTTP(w, r)
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
	return recorder, reached
}

// The lock of the Träger portal (#6052) decides only on a read that
// answered: a missing module is 403 module.not_booked, an unavailable Träger
// 401 like the frame of the portal, a failed read 500, and Basis reads
// nothing at all.
func TestTraegerModuleLockMapsEveryAnswer(t *testing.T) {
	t.Parallel()

	t.Run("a booked module passes", func(t *testing.T) {
		t.Parallel()
		_, reached := serveThroughTraegerLock(t, holidayLinkModules{modules: []settings.ModuleKey{settings.ModuleElternbeitraege}}, "/traeger/billing-runs/")
		assert.True(t, reached)
	})

	t.Run("a module no school books is refused and named", func(t *testing.T) {
		t.Parallel()
		recorder, reached := serveThroughTraegerLock(t, holidayLinkModules{modules: []settings.ModuleKey{settings.ModuleVertraege}}, "/traeger/billing-runs/")
		assert.False(t, reached)
		require.Equal(t, http.StatusForbidden, recorder.Code)
		var body struct {
			Code    string         `json:"code"`
			Details map[string]any `json:"details"`
		}
		require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
		assert.Equal(t, common.CodeModuleNotBooked, body.Code)
		assert.Equal(t, string(settings.ModuleElternbeitraege), body.Details["module"])
		assert.Equal(t, "Elternbeiträge und Abrechnung", body.Details["module_label"])
	})

	t.Run("an unavailable Träger has no session to serve", func(t *testing.T) {
		t.Parallel()
		recorder, reached := serveThroughTraegerLock(t, holidayLinkModules{err: traegerview.ErrTraegerUnavailable}, "/traeger/contracts/")
		assert.False(t, reached)
		assert.Equal(t, http.StatusUnauthorized, recorder.Code)
	})

	t.Run("a failed read is a server error, never a booking decision", func(t *testing.T) {
		t.Parallel()
		recorder, reached := serveThroughTraegerLock(t, holidayLinkModules{err: errors.New("settings unavailable")}, "/traeger/holiday-periods/")
		assert.False(t, reached)
		assert.Equal(t, http.StatusInternalServerError, recorder.Code)
	})

	t.Run("Basis reads no switch", func(t *testing.T) {
		t.Parallel()
		_, reached := serveThroughTraegerLock(t, failingTraegerModules{t: t}, "/traeger/schools/")
		assert.True(t, reached)
	})
}

// failingTraegerModules fails the test when the lock reads the modules.
type failingTraegerModules struct{ t *testing.T }

func (m failingTraegerModules) BookedModules(context.Context, int64) ([]settings.ModuleKey, error) {
	m.t.Error("a Basis route read the module switches")
	return nil, nil
}
