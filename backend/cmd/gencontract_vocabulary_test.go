package cmd

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The guardians' portal states the phase vocabulary of its contract without
// importing Enrollment; this keeps the two from drifting apart.
func TestParentContractNamesEnrollmentsPhaseVocabulary(t *testing.T) {
	t.Parallel()
	doc, err := api.ContractDocument()
	require.NoError(t, err)
	values := map[string][]string{}
	for _, enum := range doc.Enums {
		values[enum.Name] = enum.Values
	}
	assert.ElementsMatch(t, []string{enrollment.PhaseKindSchoolYear, enrollment.PhaseKindHoliday, enrollment.PhaseKindCustom}, values["EnrollmentPhaseKind"])
	assert.ElementsMatch(t, []string{
		enrollment.PhaseAudienceOpen, enrollment.PhaseAudienceNewStudents,
		enrollment.PhaseAudienceExistingStudents, enrollment.PhaseAudienceLinkedParents,
	}, values["EnrollmentPhaseAudience"])
}
