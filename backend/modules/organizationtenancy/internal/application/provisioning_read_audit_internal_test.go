package application

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestOperatorReadAuditKeepsTheAffectedResource pins #7212: an operator read
// in front of a write names the object it touches, not only its parent.
func TestOperatorReadAuditKeepsTheAffectedResource(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name         string
		access       organizationtenancy.OperatorReadAccess
		resourceType string
		resourceID   int64
		changes      map[string]any
	}{
		{
			name:         "school access of an account",
			access:       organizationtenancy.OperatorReadAccess{View: organizationtenancy.ReadAccountTenants, AccountID: 84, SchoolID: 42},
			resourceType: domain.AuditResourceAccount,
			resourceID:   84,
			changes:      map[string]any{"view": "account_tenants", "school_id": float64(42)},
		},
		{
			name:         "resolved RFID scan",
			access:       organizationtenancy.OperatorReadAccess{View: organizationtenancy.ReadUnregisteredTagScans, TagScanID: 123},
			resourceType: domain.AuditResourceTagScan,
			resourceID:   123,
			changes:      map[string]any{"view": "unregistered_tag_scans"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			h := newHarness(t)
			tc.access.OperatorID = testOperatorID
			tc.access.ClientIP = operatorIP

			require.NoError(t, h.svc.RecordOperatorRead(context.Background(), tc.access))

			require.Len(t, h.audit.entries, 1)
			entry := h.audit.entries[0]
			assert.Equal(t, domain.AuditActionView, entry.Action)
			assert.Equal(t, tc.resourceType, entry.ResourceType)
			require.NotNil(t, entry.ResourceID)
			assert.Equal(t, tc.resourceID, *entry.ResourceID)
			var changes map[string]any
			require.NoError(t, json.Unmarshal(entry.Changes, &changes))
			assert.Equal(t, tc.changes, changes)
		})
	}
}
