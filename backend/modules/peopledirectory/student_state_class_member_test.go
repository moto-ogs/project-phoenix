package peopledirectory

import (
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
)

// TestClassMembershipOfAChildWithoutCarePlace states the class membership
// rule of a child without an OGS place (#4803): from its enrollment start,
// else the Berlin day it was created; a child that left the school counts
// only up to a dated end.
func TestClassMembershipOfAChildWithoutCarePlace(t *testing.T) {
	t.Parallel()
	start := calendar.Date("2026-08-03")
	// 23:30 UTC on 8 September is already 9 September in Berlin.
	created := time.Date(2026, time.September, 8, 23, 30, 0, 0, time.UTC)

	assert.Equal(t, start, (&StudentState{EnrolledFrom: &start, CreatedAt: created}).ClassMemberFrom())
	assert.Equal(t, calendar.Date("2026-09-09"), (&StudentState{CreatedAt: created}).ClassMemberFrom())

	assert.False(t, (&StudentState{Status: StudentStatusActive}).LeftSchool())
	assert.False(t, (&StudentState{Status: StudentStatusPending}).LeftSchool())
	assert.True(t, (&StudentState{Status: StudentStatusInactive}).LeftSchool())
	assert.True(t, (&StudentState{Status: StudentStatusAlumnus}).LeftSchool())
}
