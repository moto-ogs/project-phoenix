package application

import (
	"encoding/json"
	"testing"
	"time"

	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"

	"github.com/stretchr/testify/assert"
)

// The source of a request made for a child of an imported care contract
// (#7760, ADR 0308) at every reader that tells sources apart: the school
// made it, no parent did.
func TestContractImportSourceIsAStaffEnteredSourceWithoutParentEvidence(t *testing.T) {
	t.Parallel()
	source := enrollmentNative.RequestSourceContractImport
	assert.Equal(t, source, enrollmentNative.NormalizedSubmissionSource(" contract_import "), "the source is known, not a public submission")
	assert.True(t, enrollmentNative.StaffEnteredSubmissionSource(source))
	assert.True(t, enrollmentNative.StaffEnteredSubmissionSource(enrollmentNative.RequestSourceAdminManual))
	assert.False(t, enrollmentNative.StaffEnteredSubmissionSource(enrollmentNative.RequestSourceLateInvite))
	assert.False(t, enrollmentNative.StaffEnteredSubmissionSource(enrollmentNative.RequestSourcePublic))

	signed := &enrollmentNative.FormSchema{CoreRequirements: enrollmentNative.CoreRequirements{enrollmentNative.CoreRequirementSignature: true}}
	assert.False(t, signatureRequired(signed, source), "no parent signs it")
	assert.True(t, signatureRequired(signed, enrollmentNative.RequestSourcePublic))
	assert.True(t, isTrustedEnrollmentSource(source), "a later change keeps the exemption of its creation")
	assert.True(t, reEnrollmentSubmitterFor(source, nil, "").AdminManaged, "it has no parent identity whose authority a change would hold")

	// A snapshot that would prove a parent's agreement at a public submission
	// proves nothing here: the contract concluded before moto keeps its own
	// conclusion.
	accepted := time.Date(2026, 11, 22, 10, 0, 0, 0, time.UTC)
	fingerprint := func([]byte) string { return "sum" }
	snapshot, err := json.Marshal([]enrollmentNative.LegalBlocksSnapshotEntry{{
		SnapshotAt: accepted.Add(-time.Hour), FormSchemaID: 3, DisplayedFormSchemaID: 3, ConsentFlags: json.RawMessage(`{"terms":true}`),
		Blocks: []enrollmentNative.LegalBlockSnapshot{{Key: "terms", Kind: enrollmentNative.LegalBlockKindTerms,
			Source: enrollmentNative.LegalBlockSourceCustom, Text: "Bedingungen", TextSHA256: "sum", Required: true}},
	}})
	assert.NoError(t, err)
	assert.Len(t, enrollmentNative.ContractAcceptances(snapshot, enrollmentNative.RequestSourcePublic, &accepted, fingerprint), 1)
	assert.Empty(t, enrollmentNative.ContractAcceptances(snapshot, source, &accepted, fingerprint))
}
