//go:build testhooks

package api

import (
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestOperatorProvisioningIntegration_DeviceSlots runs the Geräteplätze
// (#2312) through the production composition: a new school has no limit
// and its system device occupies no place; the operator sets and raises the
// limit, a registration beyond it and a reduction below the registered
// devices are rejected without any change, and a removed device frees its
// place. Every effective change is audited.
func TestOperatorProvisioningIntegration_DeviceSlots(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	graph := buildOperatorProvisioning(t, db)
	operatorID := testpkg.CreateTestOperator(t, db).ID
	ctx := provisioningContext(t, db)
	organizationID, schoolID := provisionTestSchool(t, db, graph, operatorID, "slots")
	summary := func() *organizationtenancy.SchoolSummary {
		t.Helper()
		summaries, err := graph.ListSchoolSummaries(ctx)
		require.NoError(t, err)
		for _, school := range summaries {
			if school.ID == ident.ID(schoolID) {
				return school
			}
		}
		t.Fatalf("school %d is not listed", schoolID)
		return nil
	}
	createDevice := func(label string) error {
		_, err := graph.CreateDevice(ctx, schoolID, fmt.Sprintf("slots-%s-%d", label, schoolID), "rfid_terminal", nil, nil, operatorID, provisioningTestClientIP)
		return err
	}
	slots := func(n int) *int { return &n }

	initial := summary()
	assert.Nil(t, initial.DeviceSlots, "a new school has no limit yet")
	assert.Zero(t, initial.GeraeteCount, "the manual web check-in device occupies no Geräteplatz")
	require.NoError(t, createDevice("before-limit"), "without a limit the school registers as before")

	require.NoError(t, graph.DeviceSlots.SetSchoolDeviceSlots(ctx, schoolID, slots(2), operatorID, provisioningTestClientIP))
	require.NoError(t, createDevice("second"))
	full := createDevice("third")
	value := requireProvisioningError(t, full, "DeviceSlotsFullError")
	assert.EqualValues(t, 2, value.FieldByName("DeviceSlots").Int())
	assert.Equal(t, 2, summary().GeraeteCount, "the refused registration left no device behind")

	below := graph.DeviceSlots.SetSchoolDeviceSlots(ctx, schoolID, slots(1), operatorID, provisioningTestClientIP)
	value = requireProvisioningError(t, below, "DeviceSlotsBelowOccupiedError")
	assert.EqualValues(t, 2, value.FieldByName("Occupied").Int())
	require.NotNil(t, summary().DeviceSlots)
	assert.Equal(t, 2, *summary().DeviceSlots, "a refused reduction keeps the limit")
	refused, err := graph.ListSchoolDevices(ctx, schoolID)
	require.NoError(t, err)
	for _, device := range refused {
		assert.Equal(t, "active", device.Status, "a refused reduction changes no device: %s", device.DeviceID)
	}
	assert.Equal(t, 2, summary().GeraeteCount, "a refused reduction removes no device")

	devices, err := graph.ListSchoolDevices(ctx, schoolID)
	require.NoError(t, err)
	for _, device := range devices {
		if device.DeviceID == fmt.Sprintf("slots-second-%d", schoolID) {
			require.NoError(t, graph.DeleteDevice(ctx, device.ID.Int64(), operatorID, provisioningTestClientIP))
		}
	}
	require.NoError(t, graph.DeviceSlots.SetSchoolDeviceSlots(ctx, schoolID, slots(1), operatorID, provisioningTestClientIP),
		"a removed device frees its place for the reduction")
	require.NoError(t, graph.DeviceSlots.SetSchoolDeviceSlots(ctx, schoolID, slots(1), operatorID, provisioningTestClientIP))
	require.NoError(t, graph.DeviceSlots.SetSchoolDeviceSlots(ctx, schoolID, nil, operatorID, provisioningTestClientIP))
	assert.Nil(t, summary().DeviceSlots, "the operator can remove the limit")

	// A transfer into a school without a free place is refused as a whole:
	// the source device stays live with its credential.
	targetInput := newInput(graph.CreateSchool)
	targetInput.OrganizationID = organizationID
	targetInput.Name = fmt.Sprintf("Volle Zielschule %d", schoolID)
	targetInput.Slug = fmt.Sprintf("volle-ziel-%d", schoolID)
	targetInput.Subdomain = fmt.Sprintf("volle-ziel-%d", schoolID)
	targetInput.Email = fmt.Sprintf("volle-ziel-%d@example.test", schoolID)
	targetInput.FederalState = "DE-NW"
	targetInput.Active = true
	target, err := graph.CreateSchool(ctx, targetInput, operatorID, provisioningTestClientIP)
	require.NoError(t, err)
	none := 0
	require.NoError(t, graph.DeviceSlots.SetSchoolDeviceSlots(ctx, target.ID.Int64(), &none, operatorID, provisioningTestClientIP))
	var moving organizationtenancy.OperatorDevice
	for _, device := range refused {
		if device.DeviceID == fmt.Sprintf("slots-before-limit-%d", schoolID) {
			moving = device
		}
	}
	require.NotZero(t, moving.ID)
	var hashBefore string
	require.NoError(t, db.NewRaw(`SELECT api_key_hash FROM iot.devices WHERE id = ?`, moving.ID).Scan(testpkg.Ctx(t), &hashBefore))
	_, err = graph.TransferDevice(ctx, moving.ID.Int64(), target.ID.Int64(), operatorID, provisioningTestClientIP)
	requireProvisioningError(t, err, "DeviceSlotsFullError")
	var source struct {
		ArchivedAt *string `bun:"archived_at"`
		Hash       string  `bun:"api_key_hash"`
	}
	require.NoError(t, db.NewSelect().TableExpr("iot.devices").Column("archived_at", "api_key_hash").
		Where("id = ?", moving.ID).Scan(testpkg.Ctx(t), &source))
	assert.Nil(t, source.ArchivedAt, "the refused transfer keeps the source live")
	assert.Equal(t, hashBefore, source.Hash, "the refused transfer keeps the credential")

	assert.Equal(t, 3, countDeviceSlotAudits(t, db, schoolID),
		"set, lowered and removed; the refused and the unchanged requests are not audited")
}

// TestOperatorProvisioningIntegration_DeviceSlotsLastPlaceRace sends two
// registrations for the last Geräteplatz at once: exactly one device results.
func TestOperatorProvisioningIntegration_DeviceSlotsLastPlaceRace(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	graph := buildOperatorProvisioning(t, db)
	operatorID := testpkg.CreateTestOperator(t, db).ID
	ctx := provisioningContext(t, db)
	_, schoolID := provisionTestSchool(t, db, graph, operatorID, "race")
	one := 1
	require.NoError(t, graph.DeviceSlots.SetSchoolDeviceSlots(ctx, schoolID, &one, operatorID, provisioningTestClientIP))

	var wg sync.WaitGroup
	results := make([]error, 2)
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, results[i] = graph.CreateDevice(ctx, schoolID, fmt.Sprintf("race-%d-%d", i, schoolID), "rfid_terminal", nil, nil, operatorID, provisioningTestClientIP)
		}(i)
	}
	wg.Wait()

	succeeded := 0
	for _, err := range results {
		if err == nil {
			succeeded++
			continue
		}
		requireProvisioningError(t, err, "DeviceSlotsFullError")
	}
	assert.Equal(t, 1, succeeded, "exactly one registration takes the last place")
	var live int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM iot.devices WHERE tenant_id = ? AND archived_at IS NULL AND device_id <> 'WEB-MANUAL-001'`, schoolID).
		Scan(testpkg.Ctx(t), &live))
	assert.Equal(t, 1, live)
}

// countDeviceSlotAudits counts the operator audit entries of the school
// that record a Geräteplatz change.
func countDeviceSlotAudits(t *testing.T, db *bun.DB, schoolID int64) int {
	t.Helper()
	count, err := db.NewSelect().TableExpr("platform.operator_audit_log").
		Where("action = 'update' AND resource_type = 'school' AND resource_id = ?", schoolID).
		Where("changes->'device_slots' IS NOT NULL").
		Count(testpkg.Ctx(t))
	require.NoError(t, err)
	return int(count)
}
