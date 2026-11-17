package application

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
)

// TestSplitWithoutCarePlaceKeepsChildrenInTheirClassPeriod lists a child
// without an OGS place (#4803 review) only on days it belongs to its class:
// from its start, up to its enrollment end, a graduate only with a dated end.
func TestSplitWithoutCarePlaceKeepsChildrenInTheirClassPeriod(t *testing.T) {
	t.Parallel()
	until := calendar.Date("2026-09-08")
	students := []*RosterStudent{
		{ID: 1},
		{ID: 2, WithoutCarePlace: true, MemberFrom: "2026-09-09"},
		{ID: 3, WithoutCarePlace: true, MemberFrom: "2026-08-01", MemberUntil: &until},
		{ID: 4, WithoutCarePlace: true, Alumnus: true, MemberFrom: "2026-08-01"},
		{ID: 5, WithoutCarePlace: true, Alumnus: true, MemberFrom: "2026-08-01", MemberUntil: &until},
	}
	ids := func(day calendar.Date) []int64 {
		care, withoutPlace := splitWithoutCarePlace(append([]*RosterStudent(nil), students...), day)
		assert.Len(t, care, 1)
		result := []int64{}
		for _, student := range withoutPlace {
			result = append(result, student.ID)
		}
		return result
	}

	assert.Equal(t, []int64{3, 5}, ids("2026-09-08"), "before the new child, up to the end of the others")
	assert.Equal(t, []int64{2}, ids("2026-09-09"), "the new child from its first day, the others gone")
}
