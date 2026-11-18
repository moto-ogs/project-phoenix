package owners

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
)

// TestBulkTimesSkipChildrenWithoutCarePlace keeps a child without an OGS
// place (#4803) out of every bulk arrival and pickup write of its class:
// the arrival plan treats it as a child whose care has ended, the pickup
// plan as not eligible, and both bulk writers skip such children.
func TestBulkTimesSkipChildrenWithoutCarePlace(t *testing.T) {
	t.Parallel()
	day := timezone.Date("2026-09-09")
	withPlace := peopledirectory.StudentRecord{Status: peopledirectory.StudentStatusActive}
	withoutPlace := peopledirectory.StudentRecord{Status: peopledirectory.StudentStatusActive, WithoutCarePlace: true}

	assert.False(t, arrivalPlanStudent(withPlace, day).CareEnded)
	assert.True(t, arrivalPlanStudent(withoutPlace, day).CareEnded)
	assert.True(t, pickupPlanStudent(withPlace, day).Eligible)
	assert.False(t, pickupPlanStudent(withoutPlace, day).Eligible)
}
