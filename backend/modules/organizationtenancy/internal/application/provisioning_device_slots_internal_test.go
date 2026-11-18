package application

import (
	"context"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func slotCount(n int) *int { return &n }

// TestProvisioningSetSchoolDeviceSlots pins how the operator maintains the
// Geräteplätze of a school (#2312): raised and lowered with an audit entry,
// never below the registered devices, and only under the Geräteplatz lock.
func TestProvisioningSetSchoolDeviceSlots(t *testing.T) {
	t.Parallel()

	setup := func(t *testing.T, devices int) *provisioningHarness {
		t.Helper()
		h := newHarness(t)
		h.addOrg(1, "Talent", "talent", false)
		h.addSchool(10, 1, "Burbach", "burbach")
		for i := range devices {
			h.devices.add(domain.Device{ID: int64(600 + i), TenantID: 10, DeviceID: "kiosk-" + string(rune('a'+i)), DeviceType: "rfid_reader"})
		}
		archived := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
		h.devices.add(domain.Device{ID: 690, TenantID: 10, DeviceID: "removed", DeviceType: "rfid_reader", ArchivedAt: &archived})
		return h
	}

	t.Run("sets and raises the limit, each audited with old and new", func(t *testing.T) {
		t.Parallel()
		h := setup(t, 2)

		require.NoError(t, h.svc.SetSchoolDeviceSlots(context.Background(), 10, slotCount(3), testOperatorID, operatorIP))
		require.NoError(t, h.svc.SetSchoolDeviceSlots(context.Background(), 10, slotCount(5), testOperatorID, operatorIP))

		require.NotNil(t, h.engine.schools[10].DeviceSlots)
		assert.Equal(t, 5, *h.engine.schools[10].DeviceSlots)
		require.Len(t, h.audit.entries, 2)
		assert.Equal(t, map[string]any{
			"device_slots": map[string]any{"old": float64(3), "new": float64(5)},
			"occupied":     float64(2),
		}, auditChanges(t, h.audit.entries[1]))
		assert.Equal(t, 2, h.engine.deviceSlotLocks, "every change holds the Geräteplatz lock")
	})

	t.Run("lowers the limit to exactly the occupied places", func(t *testing.T) {
		t.Parallel()
		h := setup(t, 2)
		h.engine.schools[10].DeviceSlots = slotCount(4)

		require.NoError(t, h.svc.SetSchoolDeviceSlots(context.Background(), 10, slotCount(2), testOperatorID, operatorIP))

		assert.Equal(t, 2, *h.engine.schools[10].DeviceSlots, "the removed device frees its place")
	})

	t.Run("rejects a limit below the registered devices and changes nothing", func(t *testing.T) {
		t.Parallel()
		h := setup(t, 3)
		h.engine.schools[10].DeviceSlots = slotCount(4)

		err := h.svc.SetSchoolDeviceSlots(context.Background(), 10, slotCount(2), testOperatorID, operatorIP)

		var below *organizationtenancy.DeviceSlotsBelowOccupiedError
		require.ErrorAs(t, err, &below)
		assert.Equal(t, organizationtenancy.DeviceSlotsBelowOccupiedError{SchoolID: 10, Requested: 2, Occupied: 3}, *below)
		assert.Equal(t, 4, *h.engine.schools[10].DeviceSlots)
		assert.False(t, h.engine.called("SetSchoolDeviceSlots"))
		assert.Empty(t, h.audit.entries)
		assert.Len(t, h.devices.devices, 4, "no device is touched")
	})

	t.Run("removes the limit", func(t *testing.T) {
		t.Parallel()
		h := setup(t, 1)
		h.engine.schools[10].DeviceSlots = slotCount(1)

		require.NoError(t, h.svc.SetSchoolDeviceSlots(context.Background(), 10, nil, testOperatorID, operatorIP))

		assert.Nil(t, h.engine.schools[10].DeviceSlots)
		assert.Equal(t, map[string]any{
			"device_slots": map[string]any{"old": float64(1), "new": nil},
			"occupied":     float64(1),
		}, auditChanges(t, h.onlyAudit(t, domain.AuditActionUpdate, domain.AuditResourceSchool, 10)))
	})

	t.Run("the same number changes nothing and records nothing", func(t *testing.T) {
		t.Parallel()
		h := setup(t, 1)
		h.engine.schools[10].DeviceSlots = slotCount(2)

		require.NoError(t, h.svc.SetSchoolDeviceSlots(context.Background(), 10, slotCount(2), testOperatorID, operatorIP))

		assert.False(t, h.engine.called("SetSchoolDeviceSlots"))
		assert.Empty(t, h.audit.entries)
	})

	t.Run("rejects a number outside the contract model", func(t *testing.T) {
		t.Parallel()
		h := setup(t, 0)

		for _, slots := range []int{-1, organizationtenancy.MaxDeviceSlots + 1} {
			err := h.svc.SetSchoolDeviceSlots(context.Background(), 10, slotCount(slots), testOperatorID, operatorIP)
			var invalid *organizationtenancy.InvalidProvisioningDataError
			require.ErrorAs(t, err, &invalid)
		}
		assert.Zero(t, h.engine.deviceSlotLocks)
		assert.Empty(t, h.audit.entries)
	})

	t.Run("a deleted school keeps its limit", func(t *testing.T) {
		t.Parallel()
		h := setup(t, 0)
		deleted := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
		h.engine.schools[10].DeletedAt = &deleted

		err := h.svc.SetSchoolDeviceSlots(context.Background(), 10, slotCount(3), testOperatorID, operatorIP)

		var gone *organizationtenancy.SchoolAlreadyDeletedError
		require.ErrorAs(t, err, &gone)
		assert.Nil(t, h.engine.schools[10].DeviceSlots)
	})
}
