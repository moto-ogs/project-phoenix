package migrations

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestEnrollmentRequestsTakeTheContractImportSource pins 20261122202200
// (#7760): a request names an imported contract as its source without a
// guardian, and an unknown source stays refused.
func TestEnrollmentRequestsTakeTheContractImportSource(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	phase := testpkg.CreateTestEnrollmentPhase(t, db)
	insert := func(source string) error {
		_, err := db.NewRaw(`INSERT INTO enrollment.requests (tenant_id, phase_id, guardian_first_name, guardian_last_name,
				guardian_email, consent_flags, custom_data, submission_source, source_metadata, status_token, submitted_at)
			VALUES (?, ?, '', '', '', '{}'::jsonb, '{}'::jsonb, ?, '{"contract_id": 7}'::jsonb, ?, NOW())`,
			testpkg.Tenant(t), phase.ID, source, fmt.Sprintf("contract-import-source-%d-%s", testpkg.UniqueTestTenantID(t), source)).
			Exec(context.Background())
		return err
	}
	require.NoError(t, insert("contract_import"), "a request from an imported contract names no guardian")
	require.NoError(t, insert("admin_manual"), "the sources of 1.15.153 stay")
	assert.ErrorContains(t, insert("contract_export"), "chk_enrollment_requests_submission_source", "an unknown source stays refused")
}
