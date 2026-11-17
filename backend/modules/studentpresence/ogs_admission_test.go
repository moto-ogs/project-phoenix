package studentpresence

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
)

// TestOGSAdmissionRefused refuses a graduate, a child past its last care day
// and a child without an OGS place (#4803); the last one answers as care
// ended so the kiosk's /api/iot/* mapping stays unchanged.
func TestOGSAdmissionRefused(t *testing.T) {
	t.Parallel()
	day := calendar.NewDate(2026, 11, 16)
	ended := calendar.NewDate(2026, 11, 13)
	assert.NoError(t, (&StudentRecord{}).OGSAdmissionRefused(day))
	assert.ErrorIs(t, (&StudentRecord{Lifecycle: StudentLifecycleAlumnus}).OGSAdmissionRefused(day), ErrStudentGraduated)
	assert.ErrorIs(t, (&StudentRecord{EnrolledUntil: &ended}).OGSAdmissionRefused(day), ErrStudentCareEnded)
	assert.ErrorIs(t, (&StudentRecord{WithoutCarePlace: true}).OGSAdmissionRefused(day), ErrStudentCareEnded)
}
