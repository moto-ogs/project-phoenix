package operator

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
)

type deviceHistoryFunc func(context.Context, int64) ([]organizationtenancy.DeviceHistoryEntry, error)

func (f deviceHistoryFunc) DeviceHistory(ctx context.Context, id int64) ([]organizationtenancy.DeviceHistoryEntry, error) {
	return f(ctx, id)
}

func serveDeviceHistory(t *testing.T, history organizationtenancy.DeviceHistoryProvisioning, id string) *httptest.ResponseRecorder {
	t.Helper()
	resource := NewProvisioningResource(ProvisioningConfig{Service: &mockProvisioningService{}, DeviceHistory: history})
	req := httptest.NewRequest(http.MethodGet, "/operator/devices/"+id+"/history", nil)
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("id", id)
	req = withOperatorClaims(req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx)), 42)
	rr := httptest.NewRecorder()
	resource.DeviceHistory(rr, req)
	return rr
}

// TestProvisioningResource_DeviceHistory answers the history with string
// IDs, the school's name and the values before and after (#2321).
func TestProvisioningResource_DeviceHistory(t *testing.T) {
	t.Parallel()
	before, after := "Eingang", "Haupteingang"
	var asked int64
	rr := serveDeviceHistory(t, deviceHistoryFunc(func(_ context.Context, id int64) ([]organizationtenancy.DeviceHistoryEntry, error) {
		asked = id
		return []organizationtenancy.DeviceHistoryEntry{{
			ID: 5, SchoolID: 10, SchoolName: "Burbach", Action: "updated", ActorKind: "school_staff",
			Changes:    map[string]organizationtenancy.DeviceHistoryChange{"name": {Before: &before, After: &after}},
			OccurredAt: time.Date(2026, time.November, 18, 9, 0, 0, 0, time.UTC),
		}}, nil
	}), "17")

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Equal(t, int64(17), asked)
	entries := decodeBody(t, rr)["data"].([]any)
	require.Len(t, entries, 1)
	assert.Equal(t, map[string]any{
		"id": "5", "action": "updated", "actor_kind": "school_staff",
		"changes":     map[string]any{"name": map[string]any{"before": "Eingang", "after": "Haupteingang"}},
		"occurred_at": "2026-11-18T09:00:00Z", "school_id": "10", "school_name": "Burbach",
	}, entries[0])
}

func TestProvisioningResource_DeviceHistory_UnknownDevice(t *testing.T) {
	t.Parallel()
	rr := serveDeviceHistory(t, deviceHistoryFunc(func(_ context.Context, id int64) ([]organizationtenancy.DeviceHistoryEntry, error) {
		return nil, &organizationtenancy.OperatorDeviceNotFoundError{DeviceID: id}
	}), "17")
	assert.Equal(t, http.StatusNotFound, rr.Code, rr.Body.String())

	rr = serveDeviceHistory(t, nil, "x")
	assert.Equal(t, http.StatusBadRequest, rr.Code, rr.Body.String())
}
