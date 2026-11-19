package api

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/analytics"
	"github.com/moto-ogs/project-phoenix/modules/schoolsetup"
)

// The usage analytics names a step of the first steps only from its own
// closed list (#7553). A step the checklist gains must join that list, or
// its events would silently stop counting.
func TestStaffFirstStepKeysMatchTheChecklist(t *testing.T) {
	t.Parallel()

	checklist := make([]string, 0, len(schoolsetup.StaffStepKeys))
	for _, step := range schoolsetup.StaffStepKeys {
		checklist = append(checklist, string(step))
	}
	assert.Equal(t, checklist, analytics.StaffFirstStepKeys())
}
