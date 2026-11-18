package operator

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
)

type deviceSlotsFn func(ctx context.Context, schoolID int64, slots *int, operatorID int64, clientIP net.IP) error

func (fn deviceSlotsFn) SetSchoolDeviceSlots(ctx context.Context, schoolID int64, slots *int, operatorID int64, clientIP net.IP) error {
	return fn(ctx, schoolID, slots, operatorID, clientIP)
}

// TestProvisioningResource_SetSchoolDeviceSlots covers the operator route of
// the Geräteplätze (#2312): number, null and a missing field, and the answer
// to a reduction below the registered devices.
func TestProvisioningResource_SetSchoolDeviceSlots(t *testing.T) {
	t.Parallel()

	request := func(id, body string) *http.Request {
		req := httptest.NewRequest(http.MethodPut, "/operator/schools/"+id+"/device-slots", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = "203.0.113.50:4242"
		req = withOperatorClaims(req, 42)
		routeCtx := chi.NewRouteContext()
		routeCtx.URLParams.Add("id", id)
		return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
	}
	serve := func(fn deviceSlotsFn, id, body string) *httptest.ResponseRecorder {
		rr := httptest.NewRecorder()
		NewProvisioningResource(ProvisioningConfig{DeviceSlots: fn}).SetSchoolDeviceSlots(rr, request(id, body))
		return rr
	}

	t.Run("passes the number and answers without data", func(t *testing.T) {
		t.Parallel()
		rr := serve(func(_ context.Context, schoolID int64, slots *int, operatorID int64, clientIP net.IP) error {
			assert.Equal(t, int64(10), schoolID)
			require.NotNil(t, slots)
			assert.Equal(t, 7, *slots)
			assert.Equal(t, int64(42), operatorID)
			assert.Equal(t, "203.0.113.50", clientIP.String())
			return nil
		}, "10", `{"device_slots":7}`)
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		assert.NotContains(t, rr.Body.String(), `"data"`)
	})

	t.Run("null removes the limit", func(t *testing.T) {
		t.Parallel()
		rr := serve(func(_ context.Context, _ int64, slots *int, _ int64, _ net.IP) error {
			assert.Nil(t, slots)
			return nil
		}, "10", `{"device_slots":null}`)
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	})

	for name, body := range map[string]string{"missing field": `{}`, "not a number": `{"device_slots":"viele"}`, "no body": ``} {
		t.Run("rejects "+name, func(t *testing.T) {
			t.Parallel()
			rr := serve(func(context.Context, int64, *int, int64, net.IP) error {
				t.Fatal("an invalid request reached the service")
				return nil
			}, "10", body)
			assert.Equal(t, http.StatusBadRequest, rr.Code, rr.Body.String())
		})
	}

	t.Run("answers a reduction below the registered devices with its numbers", func(t *testing.T) {
		t.Parallel()
		rr := serve(func(context.Context, int64, *int, int64, net.IP) error {
			return &organizationtenancy.DeviceSlotsBelowOccupiedError{SchoolID: 10, Requested: 2, Occupied: 3}
		}, "10", `{"device_slots":2}`)
		require.Equal(t, http.StatusConflict, rr.Code, rr.Body.String())
		assert.Contains(t, rr.Body.String(), `"code":"provisioning.device_slots_below_occupied"`)
		assert.Contains(t, rr.Body.String(), `"occupied":3`)
		assert.Contains(t, rr.Body.String(), `"device_slots":2`)
	})

	t.Run("answers 500 without the capability", func(t *testing.T) {
		t.Parallel()
		rr := httptest.NewRecorder()
		NewProvisioningResource(ProvisioningConfig{}).SetSchoolDeviceSlots(rr, request("10", `{"device_slots":1}`))
		assert.Equal(t, http.StatusInternalServerError, rr.Code)
	})
}
