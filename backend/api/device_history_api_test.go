//go:build testhooks

package api

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/devicefleet"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestOperatorDeviceLifecycleReachesBothSchoolsHistories runs the operator's
// device commands through the production composition (#2321): creating,
// blocking, unblocking and transferring a device each leave one entry. The
// operator reads the whole chain across both schools; the target school
// reads only its own entry, so it learns neither the source school nor the
// source's earlier history.
func TestOperatorDeviceLifecycleReachesBothSchoolsHistories(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	service := buildOperatorProvisioning(t, db)
	operatorID := testpkg.CreateTestOperator(t, db).ID
	ctx := provisioningContext(t, db)

	organizationID, sourceSchoolID := provisionTestSchool(t, db, service, operatorID, "history")
	targetInput := newInput(service.CreateSchool)
	targetInput.OrganizationID = organizationID
	targetInput.Name = fmt.Sprintf("Verlaufsziel %d", sourceSchoolID)
	targetInput.Slug = fmt.Sprintf("verlaufsziel-%d", sourceSchoolID)
	targetInput.Subdomain = fmt.Sprintf("verlaufsziel-%d", sourceSchoolID)
	targetInput.Email = fmt.Sprintf("verlaufsziel-%d@example.test", sourceSchoolID)
	targetInput.FederalState = "DE-NW"
	targetInput.Active = true
	target, err := service.CreateSchool(ctx, targetInput, operatorID, provisioningTestClientIP)
	require.NoError(t, err)

	name := "Terminal Aula"
	created, err := service.CreateDevice(ctx, sourceSchoolID, fmt.Sprintf("history-%d", sourceSchoolID), "rfid_terminal", &name, nil, operatorID, provisioningTestClientIP)
	require.NoError(t, err)
	require.NoError(t, service.DeviceBlocking.SetDeviceBlocked(ctx, created.ID, true, operatorID, provisioningTestClientIP))
	require.NoError(t, service.DeviceBlocking.SetDeviceBlocked(ctx, created.ID, true, operatorID, provisioningTestClientIP), "a repeated block")
	require.NoError(t, service.DeviceBlocking.SetDeviceBlocked(ctx, created.ID, false, operatorID, provisioningTestClientIP))
	transferred, err := service.TransferDevice(ctx, created.ID, target.ID, operatorID, provisioningTestClientIP)
	require.NoError(t, err)

	devices, err := NewDeviceTestModule(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	history := mustDeviceHistory(t, devices.IoT.Fleet())

	var chain []devicefleet.LifecycleEvent
	require.NoError(t, testpkg.WithinAdminContext(t, testpkg.Ctx(t), db, func(adminCtx context.Context) error {
		chain, err = history.ListLifecycleEvents(adminCtx, transferred.ID)
		return err
	}))
	actions := make([]devicefleet.LifecycleAction, 0, len(chain))
	for _, event := range chain {
		actions = append(actions, event.Action)
		assert.Equal(t, devicefleet.LifecycleActorOperator, event.ActorKind)
		assert.Nil(t, event.ActorAccountID)
	}
	require.Equal(t, []devicefleet.LifecycleAction{
		devicefleet.LifecycleTransferredIn, devicefleet.LifecycleTransferredOut,
		devicefleet.LifecycleUnblocked, devicefleet.LifecycleBlocked, devicefleet.LifecycleCreated,
	}, actions, "newest first, across the transfer")
	assert.Equal(t, target.ID, chain[0].TenantID)
	assert.Equal(t, sourceSchoolID, chain[1].TenantID)
	assert.Empty(t, chain[0].Changes, "the target school's entry does not name the source school")
	assert.Empty(t, chain[1].Changes, "the source school's entry does not name the target school")

	var own []devicefleet.LifecycleEvent
	require.NoError(t, testpkg.WithinTenantContext(t, testpkg.ContextForTenant(testpkg.Ctx(t), target.ID), db, target.ID, func(tenantCtx context.Context) error {
		own, err = history.ListLifecycleEvents(tenantCtx, transferred.ID)
		return err
	}))
	require.Len(t, own, 1, "the target school sees only its own entry")
	assert.Equal(t, devicefleet.LifecycleTransferredIn, own[0].Action)
}
